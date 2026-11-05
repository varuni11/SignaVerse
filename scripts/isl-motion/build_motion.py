#!/usr/bin/env python3
"""
Step 2 of the ISL motion pipeline: landmarks -> avatar bone rotations.

For every reference clip this solves, per frame, the local rotation of the
bones of isl-human.glb that reproduce the captured signing:

  * arms        two-bone IK: the wrist is placed at the signer's wrist position
                (relative to the signer's shoulder, scaled by arm length), the
                elbow follows the signer's elbow direction.
  * hands       full palm orientation (wrist roll + flex) from the hand's
                wrist / index-knuckle / middle-knuckle / pinky-knuckle frame.
  * fingers     every phalanx is aimed along the captured direction expressed
                in the palm frame, so handshape is reproduced joint by joint
                (thumb included) instead of being classified into presets.
  * head/neck   rotation delta (nod / turn / tilt) relative to the clip's first
                frames, clamped.

Frames where MediaPipe lost a hand are NOT invented: the palm falls back to the
lower-detail pose-model hand points, finger directions are held/interpolated
from the nearest real detection, and the per-clip coverage is written to the
manifest so the UI can say so.

Usage: python build_motion.py <landmarks_dir> <glb> <out_dir> [name ...]
Output: <out_dir>/motion.bin (int16 quaternions) + motion-index.json
"""
import sys, os, json, glob
import numpy as np
from scipy.spatial.transform import Rotation as R, Slerp
from scipy.ndimage import gaussian_filter1d
from avatar_rig import Rig

OUT_FPS = 24.0
YFLIP = np.array([1.0, -1.0, -1.0])  # MediaPipe (x right, y down, z away) -> avatar (x left, y up, z toward viewer)

# pose landmark ids
NOSE, L_EAR, R_EAR = 0, 7, 8
SH = {"Left": 11, "Right": 12}
EL = {"Left": 13, "Right": 14}
WR = {"Left": 15, "Right": 16}
PK = {"Left": 17, "Right": 18}
IX = {"Left": 19, "Right": 20}
TH = {"Left": 21, "Right": 22}
HIP = {"Left": 23, "Right": 24}

FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"]
# hand-landmark (start,end) per segment; segment j drives bone {Finger}{j+1}
SEGS = {
    "Thumb": [(1, 2), (2, 3), (3, 4)],
    "Index": [(5, 6), (6, 7), (7, 8)],
    "Middle": [(9, 10), (10, 11), (11, 12)],
    "Ring": [(13, 14), (14, 15), (15, 16)],
    "Pinky": [(17, 18), (18, 19), (19, 20)],
}
SEG_LIST = [(f, j) for f in FINGERS for j in range(3)]  # 15 segments


def bones_for_side(side):
    b = [f"{side}Arm", f"{side}ForeArm", f"{side}Hand"]
    for f, j in SEG_LIST:
        b.append(f"{side}Hand{f}{j + 1}")
    return b


BONES = bones_for_side("Left") + bones_for_side("Right") + ["Neck", "Head"]


# ---------- small math helpers ----------
def unit(v, eps=1e-9):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, eps)


def fill_nan(a):
    """Linear-interpolate NaNs along axis 0 (edge hold). Returns (filled, valid_mask_over_time)."""
    a = np.array(a, float)
    T = a.shape[0]
    flat = a.reshape(T, -1)
    valid = ~np.isnan(flat).any(axis=1)
    if valid.all():
        return a, valid
    if not valid.any():
        return None, valid
    t = np.arange(T)
    out = flat.copy()
    for c in range(flat.shape[1]):
        out[:, c] = np.interp(t, t[valid], flat[valid, c])
    return out.reshape(a.shape), valid


def smooth(a, sigma):
    return gaussian_filter1d(a, sigma, axis=0, mode="nearest") if sigma > 0 else a


def ortho_frame(f, s0):
    f = unit(f)
    s = s0 - np.sum(s0 * f, -1, keepdims=True) * f
    s = unit(s)
    n = np.cross(f, s)
    return np.stack([f, s, n], axis=-1)  # columns f,s,n  (…,3,3)


def shortest_arc(a, b):
    a, b = unit(a), unit(b)
    c = np.cross(a, b)
    d = float(np.dot(a, b))
    if d < -0.999999:
        ax = np.cross(a, [1, 0, 0])
        if np.linalg.norm(ax) < 1e-6:
            ax = np.cross(a, [0, 1, 0])
        return R.from_rotvec(unit(ax) * np.pi)
    # quaternion from two vectors
    q = np.array([c[0], c[1], c[2], 1.0 + d])
    return R.from_quat(q / np.linalg.norm(q))


def aim_child(parent_posed, parent_bind, bind_rot, bind_dir, target_dir_world):
    """World rotation of a child bone whose axis must point along `target_dir_world`.

    The swing is solved in the PARENT's frame (parent_posed * parent_bind^-1), so the
    child inherits the parent's motion and only adds its own bend. Solving it against the
    world bind pose instead makes the child's roll flip whenever the parent rotates a lot.
    """
    D = parent_posed * parent_bind.inv()
    return D * shortest_arc(bind_dir, D.inv().apply(target_dir_world)) * bind_rot


def twist_about(rot, axis):
    """Twist part of `rot` about unit `axis` (swing-twist decomposition)."""
    q = rot.as_quat()
    proj = axis * np.dot(q[:3], axis)
    tq = np.array([proj[0], proj[1], proj[2], q[3]])
    nrm = np.linalg.norm(tq)
    if nrm < 1e-9:
        return R.identity()
    return R.from_quat(tq / nrm)


def scale_rot(rot, k):
    return R.from_rotvec(rot.as_rotvec() * k)


# ---------- avatar constants ----------
class AvatarInfo:
    def __init__(self, rig):
        P, W = rig.bind_pos, rig.bind_rot
        ix = rig.idx
        self.rig = rig
        self.bindW = {nm: W[i] for nm, i in ix.items()}
        self.bindP = {nm: P[i] for nm, i in ix.items()}
        self.side = {}
        for s in ("Left", "Right"):
            arm, fore, hand = P[ix[f"{s}Arm"]], P[ix[f"{s}ForeArm"]], P[ix[f"{s}Hand"]]
            fb = unit(P[ix[f"{s}HandMiddle1"]] - hand)
            s0 = P[ix[f"{s}HandPinky1"]] - P[ix[f"{s}HandIndex1"]]
            self.side[s] = dict(
                shoulder=arm,
                l1=np.linalg.norm(fore - arm),
                l2=np.linalg.norm(hand - fore),
                dir_upper=unit(fore - arm),
                dir_fore=unit(hand - fore),
                Fb=ortho_frame(fb, s0),
            )

    def child_dir(self, bone):
        """Bind-pose world direction from `bone` to its first bone child."""
        rig = self.rig
        i = rig.idx[bone]
        for c in range(rig.n):
            if rig.parent[c] == i and rig.names[c] in self.bindP and (
                "Hand" in rig.names[c] or "Arm" in rig.names[c] or rig.names[c] in ("Head", "Neck")
            ):
                return unit(rig.bind_pos[c] - rig.bind_pos[i])
        raise KeyError(bone)


# ---------- per-clip solve ----------
def solve_clip(name, lm, av, log):
    pose_img = lm["pose"]
    T = len(pose_img)
    fps = float(lm["fps"])
    info = {"frames_src": T, "fps_src": fps}

    pw, _ = fill_nan(lm["pose_world"])
    if pw is None:
        raise RuntimeError("no pose detected in any frame")
    pimg, _ = fill_nan(pose_img)
    pw = smooth(pw * YFLIP, 0.9)

    # signer must be facing the camera, un-mirrored
    lx, rx = np.nanmedian(pimg[:, SH["Left"], 0]), np.nanmedian(pimg[:, SH["Right"], 0])
    info["mirrored_input"] = bool(lx < rx)
    if lx < rx:
        raise RuntimeError("left shoulder is left of right shoulder in image: unexpected orientation")

    # canonical yaw (shoulder line along +X)
    sv = np.median(pw[:, SH["Left"]] - pw[:, SH["Right"]], axis=0)
    yaw = R.from_euler("y", np.arctan2(sv[2], sv[0]))
    pw = yaw.apply(pw.reshape(-1, 3)).reshape(pw.shape)

    # arm-length scale signer -> avatar
    arm_len = []
    for s in ("Left", "Right"):
        arm_len.append(np.linalg.norm(pw[:, SH[s]] - pw[:, EL[s]], axis=1) + np.linalg.norm(pw[:, EL[s]] - pw[:, WR[s]], axis=1))
    k = (av.side["Left"]["l1"] + av.side["Left"]["l2"]) / np.median(np.concatenate(arm_len))
    info["scale"] = float(k)

    # hands: assign detected hands to arms by proximity to the pose wrist
    hands_w = lm["hands_world"]  # (T,2,21,3)
    hands_i = lm["hands"]  # (T,2,21,3) normalised image coords
    assigned = {s: np.full((T,), -1) for s in ("Left", "Right")}
    for t in range(T):
        cand = []
        for s in ("Left", "Right"):
            for h in range(2):
                if np.isnan(hands_i[t, h, 0, 0]):
                    continue
                d = np.hypot((hands_i[t, h, 0, 0] - pimg[t, WR[s], 0]) * 16 / 9, hands_i[t, h, 0, 1] - pimg[t, WR[s], 1])
                cand.append((d, s, h))
        used_h, used_s = set(), set()
        for d, s, h in sorted(cand):
            if d < 0.10 and h not in used_h and s not in used_s:
                assigned[s][t] = h
                used_h.add(h)
                used_s.add(s)

    sides = {}
    for s in ("Left", "Right"):
        Sj = pw[:, SH[s]]
        Wj = pw[:, WR[s]]
        Ej = pw[:, EL[s]]

        side_i = 0 if s == "Left" else 1
        crop_w = lm.get("crop_world")
        has_crop = np.zeros(T, bool)
        if crop_w is not None:
            has_crop = ~np.isnan(crop_w[:, side_i, 0, 0]) & (assigned[s] < 0)
        det = (assigned[s] >= 0) | has_crop
        F_pose = ortho_frame(
            (pw[:, IX[s]] + pw[:, PK[s]]) / 2 - Wj,
            pw[:, PK[s]] - pw[:, IX[s]],
        )
        F = F_pose.copy()
        vloc = np.full((T, 15, 3), np.nan)
        for t in np.where(det)[0]:
            raw = hands_w[t, assigned[s][t]] if assigned[s][t] >= 0 else crop_w[t, side_i]
            hw = yaw.apply(raw * YFLIP)  # (21,3)
            Fh = ortho_frame(hw[9] - hw[0], hw[17] - hw[5])
            # reject hand-model frames that disagree wildly with the pose model's hand direction
            if np.dot(Fh[:, 0], F_pose[t][:, 0]) < -0.2:
                det[t] = False
                continue
            F[t] = Fh
            for si, (f, j) in enumerate(SEG_LIST):
                a, b = SEGS[f][j]
                vloc[t, si] = Fh.T @ unit(hw[b] - hw[a])
        # temporal outlier rejection: a detection that disagrees strongly with its neighbours
        # (flipped palm, impossible curl) is discarded and re-filled from them
        for _ in range(3):
            idxs = np.where(det)[0]
            drop = []
            for t in idxs:
                nb_ = [u for u in idxs if u != t and abs(u - t) <= 3]
                if len(nb_) < 2:
                    continue
                med_n = unit(np.median(F[nb_, :, 2], axis=0))
                med_f = unit(np.median(F[nb_, :, 0], axis=0))
                a_n = np.degrees(np.arccos(np.clip(np.dot(unit(F[t][:, 2]), med_n), -1, 1)))
                a_f = np.degrees(np.arccos(np.clip(np.dot(unit(F[t][:, 0]), med_f), -1, 1)))
                med_v = unit(np.median(vloc[nb_], axis=0))
                a_v = np.degrees(np.arccos(np.clip(np.sum(unit(vloc[t]) * med_v, axis=1), -1, 1))).mean()
                if a_n > 65 or a_f > 55 or a_v > 40:
                    drop.append(t)
            if not drop:
                break
            for t in drop:
                det[t] = False
                vloc[t] = np.nan
                F[t] = F_pose[t]
        # smooth palm frame columns
        Fs = np.stack([smooth(F[:, :, c], 0.9) for c in range(3)], axis=-1)
        Fs = ortho_frame(Fs[:, :, 0], Fs[:, :, 1])
        # fingers: interpolate/hold from real detections only
        vfill, vvalid = fill_nan(vloc)
        if vfill is None:
            # never detected: keep avatar's relaxed bind handshape
            vfill = np.zeros((T, 15, 3))
            Fb = av.side[s]["Fb"]
            for si, (f, j) in enumerate(SEG_LIST):
                bone = f"{s}Hand{f}{j + 1}"
                child = f"{s}Hand{f}{j + 2}"
                d = unit(av.bindP[child] - av.bindP[bone])
                vfill[:, si] = Fb.T @ d
        else:
            from scipy.ndimage import median_filter
            vfill = median_filter(vfill, size=(3, 1, 1), mode="nearest")
            vfill = unit(smooth(vfill, 1.2))
        sides[s] = dict(S=Sj, W=Wj, E=Ej, F=Fs, vloc=vfill, det=det)

    # face reference point (mid-eyes) in signer space and on the avatar, used to
    # keep face-contact signs (forehead, chin, cheek...) landing on the avatar's face
    eyes_s = (pw[:, 2] + pw[:, 5]) / 2
    eyes_av = (av.bindP["LeftEye"] + av.bindP["RightEye"]) / 2

    # head frames
    a = unit(pw[:, L_EAR] - pw[:, R_EAR])
    fwd0 = pw[:, NOSE] - (pw[:, L_EAR] + pw[:, R_EAR]) / 2
    z = unit(fwd0 - np.sum(fwd0 * a, -1, keepdims=True) * a)
    x = unit(a - np.sum(a * z, -1, keepdims=True) * z)
    y = np.cross(z, x)
    FH = np.stack([x, y, z], axis=-1)
    FH = smooth(FH, 1.0)
    u, _, vt = np.linalg.svd(np.mean(FH[:3], axis=0))
    FH_ref = u @ vt

    # ---------- activity window ----------
    hip_y = (pw[:, HIP["Left"], 1] + pw[:, HIP["Right"], 1]) / 2
    sh_y = (pw[:, SH["Left"], 1] + pw[:, SH["Right"], 1]) / 2
    torso = np.median(sh_y - hip_y)
    act = np.zeros(T, bool)
    for s in ("Left", "Right"):
        wy = (sides[s]["W"][:, 1] - hip_y) / torso
        speed = np.r_[0, np.linalg.norm(np.diff(sides[s]["W"], axis=0), axis=1)] * fps / torso
        act |= (wy > 0.18) | (speed > 0.8)
    if act.any():
        i0 = max(int(np.argmax(act)) - 3, 0)
        i1 = min(T - 1 - int(np.argmax(act[::-1])) + 3, T - 1)
    else:
        i0, i1 = 0, T - 1
    info["active_src"] = [i0, i1]

    # ---------- solve every frame ----------
    quats = np.zeros((T, len(BONES), 4))
    reach_clamped = 0
    ik_err = []
    head_max = 0.0
    shoulder_bind = {s: av.bindW[f"{s}Shoulder"] for s in ("Left", "Right")}
    for t in range(T):
        local = {}
        Ws = {}
        for s in ("Left", "Right"):
            sd, sa = sides[s], av.side[s]
            Sv, Wv, Ev = sd["S"][t], sd["W"][t], sd["E"][t]
            Tgt = sa["shoulder"] + k * (Wv - Sv)
            # near the face: shift by the difference between the avatar's face position and the scaled signer face
            near = float(np.exp(-((np.linalg.norm(Wv - eyes_s[t]) / 0.22) ** 2)))
            Tgt = Tgt + near * ((eyes_av - sa["shoulder"]) - k * (eyes_s[t] - Sv))
            v = Tgt - sa["shoulder"]
            d = np.linalg.norm(v)
            u_ = v / max(d, 1e-9)
            dmax, dmin = (sa["l1"] + sa["l2"]) * 0.995, abs(sa["l1"] - sa["l2"]) + 0.01
            if d > dmax:
                reach_clamped += 1
            dc = float(np.clip(d, dmin, dmax))
            Tc = sa["shoulder"] + u_ * dc
            # elbow pole from signer, regularised toward a natural default
            sw = Wv - Sv
            swn = unit(sw)
            pole_mp = (Ev - Sv) - swn * np.dot(Ev - Sv, swn)
            straight = np.linalg.norm(sw) / (np.linalg.norm(Ev - Sv) + np.linalg.norm(Wv - Ev) + 1e-9)
            w_mp = float(np.clip((1.0 - straight) * 7.0, 0.0, 1.0))
            default = unit(np.array([0.45 if s == "Left" else -0.45, -1.0, -0.45]))
            pole = (unit(pole_mp) * w_mp if np.linalg.norm(pole_mp) > 1e-6 else 0) + default * (0.35 + 0.65 * (1 - w_mp))
            pole = pole - u_ * np.dot(pole, u_)
            pole = unit(pole)
            aa = (sa["l1"] ** 2 - sa["l2"] ** 2 + dc ** 2) / (2 * dc)
            hh = np.sqrt(max(sa["l1"] ** 2 - aa ** 2, 0.0))
            Epos = sa["shoulder"] + u_ * aa + pole * hh
            up_dir, fo_dir = unit(Epos - sa["shoulder"]), unit(Tc - Epos)
            ik_err.append(float(np.linalg.norm(Tc - Tgt)))

            Wu = shortest_arc(sa["dir_upper"], up_dir) * av.bindW[f"{s}Arm"]
            Wf = aim_child(Wu, av.bindW[f"{s}Arm"], av.bindW[f"{s}ForeArm"], sa["dir_fore"], fo_dir)
            Wh = R.from_matrix(sd["F"][t] @ sa["Fb"].T) * av.bindW[f"{s}Hand"]
            # move 50% of the palm roll onto the forearm so the wrist does not candy-wrap
            fore_axis_local = av.bindW[f"{s}ForeArm"].inv().apply(sa["dir_fore"])
            rel = Wf.inv() * Wh
            tw = twist_about(rel, fore_axis_local)
            Wf2 = Wf * scale_rot(tw, 0.5)

            local[f"{s}Arm"] = shoulder_bind[s].inv() * Wu
            local[f"{s}ForeArm"] = Wu.inv() * Wf2
            local[f"{s}Hand"] = Wf2.inv() * Wh
            Ws[f"{s}Hand"] = Wh
            # fingers
            Fm = sd["F"][t]
            for si, (f, j) in enumerate(SEG_LIST):
                bone = f"{s}Hand{f}{j + 1}"
                child = f"{s}Hand{f}{j + 2}"
                dirw = Fm @ sd["vloc"][t, si]
                bind_dir = unit(av.bindP[child] - av.bindP[bone])
                pname = f"{s}Hand" if j == 0 else f"{s}Hand{f}{j}"
                parent = Wh if j == 0 else Ws[pname]
                Wb = aim_child(parent, av.bindW[pname], av.bindW[bone], bind_dir, dirw)
                local[bone] = parent.inv() * Wb
                Ws[bone] = Wb
        # head
        dH = R.from_matrix(FH[t] @ FH_ref.T)
        ang = np.linalg.norm(dH.as_rotvec())
        maxa = np.deg2rad(32)
        if ang > maxa:
            dH = scale_rot(dH, maxa / ang)
        head_max = max(head_max, float(np.rad2deg(np.linalg.norm(dH.as_rotvec()))))
        Wn = scale_rot(dH, 0.35) * av.bindW["Neck"]
        Whd = dH * av.bindW["Head"]
        local["Neck"] = av.bindW["Spine2"].inv() * Wn
        local["Head"] = Wn.inv() * Whd
        for bi, bn in enumerate(BONES):
            quats[t, bi] = local[bn].as_quat()

    # hemisphere continuity (relative to bind, then frame-to-frame)
    rig = av.rig
    for bi, bn in enumerate(BONES):
        bq = np.array(rig.q[rig.idx[bn]])
        if np.dot(quats[0, bi], bq) < 0:
            quats[0, bi] *= -1
        for t in range(1, T):
            if np.dot(quats[t, bi], quats[t - 1, bi]) < 0:
                quats[t, bi] *= -1

    # trim to the active window and resample to OUT_FPS
    sl = slice(i0, i1 + 1)
    times = np.arange(i0, i1 + 1) / fps
    times -= times[0]
    dur = float(times[-1]) if len(times) > 1 else 1.0 / fps
    n_out = max(int(round(dur * OUT_FPS)) + 1, 2)
    tn = np.linspace(0, dur, n_out)
    out = np.zeros((n_out, len(BONES), 4))
    for bi in range(len(BONES)):
        q = quats[sl, bi]
        if len(q) < 2:
            out[:, bi] = q[0]
        else:
            out[:, bi] = Slerp(times, R.from_quat(q))(tn).as_quat()
        for t in range(1, n_out):
            if np.dot(out[t, bi], out[t - 1, bi]) < 0:
                out[t, bi] *= -1

    cov = {}
    for s in ("Left", "Right"):
        d = sides[s]["det"][sl]
        cov[s] = float(np.mean(d)) if len(d) else 0.0
    # how much the side is actually used (is the hand raised?) so unused-hand coverage is not misreported
    used = {}
    for s in ("Left", "Right"):
        wy = (sides[s]["W"][sl, 1] - hip_y[sl]) / torso
        used[s] = float(np.mean(wy > 0.18))
    extent = {}
    for s in ("Left", "Right"):
        Wr = (sides[s]["W"][sl] - sides[s]["S"][sl])
        extent[s] = float(np.max(np.linalg.norm(Wr - np.median(Wr, axis=0), axis=1)) / torso)
    info["_pre"] = quats[: max(i0, 1)].copy()
    info["_extent"] = extent
    info.update(
        dur=dur,
        frames=int(n_out),
        hand_detected={s: round(cov[s], 2) for s in cov},
        hand_raised={s: round(used[s], 2) for s in used},
        reach_clamped_frac=round(reach_clamped / (2 * T), 3),
        ik_wrist_err_mean_cm=round(float(np.mean(ik_err)) * 100, 2),
        head_max_deg=round(head_max, 1),
    )
    return out, info


def main():
    lm_dir, glb, out_dir = sys.argv[1:4]
    only = set(sys.argv[4:])
    os.makedirs(out_dir, exist_ok=True)
    rig = Rig(glb)
    av = AvatarInfo(rig)
    names = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(lm_dir, "*.npz")))
    if only:
        names = [n for n in names if n in only]
    solved_dir = os.path.join(os.path.dirname(out_dir.rstrip("/")), "solved")
    os.makedirs(solved_dir, exist_ok=True)
    failures = []
    solved = {}
    for nm in names:
        lm = dict(np.load(os.path.join(lm_dir, nm + ".npz")))
        try:
            solved[nm] = solve_clip(nm, lm, av, print)
        except Exception as e:  # noqa
            failures.append((nm, str(e)))
            print(f"{nm:14s} FAILED: {e}")

    # ---- pass 2: neutral rest pose + freeze arms that never really sign ----
    pre = np.concatenate([inf["_pre"] for _, inf in solved.values()])
    rest = np.zeros((len(BONES), 4))
    for bi in range(len(BONES)):
        qs = pre[:, bi].copy()
        ref = qs[0]
        qs[np.sum(qs * ref, axis=1) < 0] *= -1
        rest[bi] = R.from_quat(qs).mean().as_quat()
    side_idx = {s: [i for i, b in enumerate(BONES) if b.startswith(s)] for s in ("Left", "Right")}
    blob, index, offset = [], {}, 0
    for nm, (q, info) in solved.items():
        frozen = []
        for s in ("Left", "Right"):
            if info["hand_raised"][s] < 0.05 and info["_extent"][s] < 0.18:
                q[:, side_idx[s]] = rest[side_idx[s]][None]
                frozen.append(s)
        info["rest_arm"] = frozen
        info.pop("_pre"); info.pop("_extent")
        np.save(os.path.join(solved_dir, nm + ".npy"), q)
        qi = np.round(q * 32767).astype(np.int16)
        blob.append(qi.reshape(-1))
        info["offset"] = offset
        offset += qi.size
        index[nm] = info
        print(f"{nm:14s} dur={info['dur']:.2f}s frames={info['frames']:3d} hands={info['hand_detected']} "
              f"raised={info['hand_raised']} clamp={info['reach_clamped_frac']} head={info['head_max_deg']} rest={frozen}")
    if not only:
        data = np.concatenate(blob).astype("<i2")
        data.tofile(os.path.join(out_dir, "motion.bin"))
        manifest = dict(fps=OUT_FPS, bones=BONES, quant=32767, rest=np.round(rest, 5).tolist(), clips=index,
                        source="MediaPipe Pose+Hands retargeted onto isl-human.glb", failures=failures)
        json.dump(manifest, open(os.path.join(out_dir, "motion-index.json"), "w"), separators=(",", ":"))
        print(f"wrote {len(index)} clips, {data.nbytes / 1e6:.2f} MB; failures: {failures}")


if __name__ == "__main__":
    main()
