#!/usr/bin/env python3
"""
Visual verification helper: renders the *actual* isl-human.glb mesh (linear
blend skinning, numpy + OpenCV) in the poses produced by build_motion.py and
places it next to the matching frame of the reference video.

Usage: python render_check.py <glb> <solved_dir> <clips_dir> <out.png> <clip> [<clip> ...]
Each clip gets a row of 5 evenly spaced frames: video | avatar front | avatar side
"""
import sys, os
import numpy as np, cv2
from scipy.spatial.transform import Rotation as R
from avatar_rig import Rig
from build_motion import BONES

COL = {"Wolf3D_Head": (170, 195, 230), "Wolf3D_Body": (170, 195, 230), "Wolf3D_Outfit_Top": (190, 120, 70),
       "Wolf3D_Outfit_Bottom": (90, 90, 110), "Wolf3D_Outfit_Footwear": (60, 60, 60), "Wolf3D_Hair": (40, 60, 90)}


def render(rig, meshes, local, view="front", size=(300, 340), center=None, span=1.2):
    mats = rig.skin_matrices(local)
    W, H = size
    img = np.full((H, W, 3), 38, np.uint8)
    tris = []
    for m in meshes:
        p = rig.skinned(m, mats)
        a, b, c = p[m["idx"][:, 0]], p[m["idx"][:, 1]], p[m["idx"][:, 2]]
        n = np.cross(b - a, c - a)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        tris.append((a, b, c, n, np.tile(np.array(COL.get(m["name"], (160, 160, 160)), float), (len(a), 1))))
    A = np.concatenate([t[0] for t in tris]); B = np.concatenate([t[1] for t in tris]); C = np.concatenate([t[2] for t in tris])
    N = np.concatenate([t[3] for t in tris]); CL = np.concatenate([t[4] for t in tris])
    if view == "side":
        rot = R.from_euler("y", -90, degrees=True)
        A, B, C, N = [rot.apply(x) for x in (A, B, C, N)]
    # camera looks along -z (viewer at +z); orthographic
    cx, cy, scale = 0.0, 1.38, 0.78 * H / 1.2 / 1.0
    if center is not None:
        cx, cy, scale = center[0], center[1], 0.9 * H / span
    def proj(P):
        return np.stack([W / 2 + (P[:, 0] - cx) * scale * -1 * -1, H / 2 - (P[:, 1] - cy) * scale], axis=1)
    pa, pb, pc = proj(A), proj(B), proj(C)
    depth = (A[:, 2] + B[:, 2] + C[:, 2]) / 3
    light = np.array([0.3, 0.5, 0.8]); light /= np.linalg.norm(light)
    shade = np.clip(N @ light, 0, 1) * 0.65 + 0.35
    order = np.argsort(depth)  # far to near
    facing = N[:, 2] > -0.05
    for i in order:
        if not facing[i]:
            continue
        pts = np.round(np.stack([pa[i], pb[i], pc[i]])).astype(np.int32)
        col = tuple(int(x) for x in CL[i] * shade[i])
        cv2.fillConvexPoly(img, pts, col, lineType=cv2.LINE_8)
    return img


def local_from_quats(q):
    return {bn: R.from_quat(q[i]) for i, bn in enumerate(BONES)}


def closeup(glb, solved, out, names):
    rig = Rig(glb); meshes = rig.load_meshes()
    rows = []
    for nm in names:
        q = np.load(os.path.join(solved, nm + ".npy"))
        n = len(q); picks = np.linspace(n * 0.3, n * 0.7, 4).round().astype(int)
        row = []
        for pi in picks:
            loc = local_from_quats(q[pi])
            pos, _ = rig.fk(loc)
            lw, rw = pos[rig.idx["LeftHand"]], pos[rig.idx["RightHand"]]
            w = lw if lw[1] > rw[1] else rw
            img = render(rig, meshes, loc, "front", (300, 300), center=(w[0], w[1] + 0.03), span=0.5)
            cv2.putText(img, f"{nm} f{pi}", (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            row.append(img)
        rows.append(np.hstack(row))
    cv2.imwrite(out, np.vstack(rows)); print("wrote", out)


def main():
    if sys.argv[1] == "--closeup":
        return closeup(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:])
    glb, solved, clips, out = sys.argv[1:5]
    names = sys.argv[5:]
    rig = Rig(glb)
    meshes = rig.load_meshes()
    rows = []
    for nm in names:
        q = np.load(os.path.join(solved, nm + ".npy"))
        cap = cv2.VideoCapture(os.path.join(clips, nm + ".mp4"))
        frames = []
        while True:
            ok, f = cap.read()
            if not ok:
                break
            frames.append(f)
        n = len(q)
        picks = np.linspace(0, n - 1, 5).round().astype(int)
        row = []
        for pi in picks:
            # map output frame -> source frame approx. (active window starts at src frame given in manifest; use proportional mapping)
            sf = frames[min(int(round(pi / max(n - 1, 1) * (len(frames) - 1))), len(frames) - 1)]
            vid = cv2.resize(sf, (300, 170))
            vid = cv2.copyMakeBorder(vid, 0, 170, 0, 0, cv2.BORDER_CONSTANT, value=(30, 30, 30))
            loc = local_from_quats(q[pi])
            front = render(rig, meshes, loc, "front", (300, 340))
            side = render(rig, meshes, loc, "side", (300, 340))
            col = np.vstack([cv2.resize(vid, (300, 340))[:170], front[:170 * 2 // 2 + 0][:0] if False else front])
            col = np.vstack([vid[:170], front, side])
            cv2.putText(col, f"{nm} f{pi}", (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            row.append(col)
        rows.append(np.hstack(row))
    cv2.imwrite(out, np.vstack(rows))
    print("wrote", out)


if __name__ == "__main__":
    main()
