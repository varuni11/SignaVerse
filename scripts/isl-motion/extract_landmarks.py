#!/usr/bin/env python3
"""
Step 1 of the ISL motion pipeline.

Runs MediaPipe Pose (world landmarks) + Hands over every frame of every
reference clip and stores the raw, per-frame landmarks as .npz files.
Nothing is invented here: frames where a hand/pose is not detected are stored
as NaN and handled (interpolated or reported) in step 2.

Usage:  python extract_landmarks.py <clips_dir> <out_dir> [name ...]
Needs:  pip install mediapipe==0.10.14 opencv-python-headless "numpy<2"
        (0.10.14 bundles the pose/hand .tflite models inside the wheel, so no
        separate model download is required.)
"""
import sys, os, glob, json
import numpy as np, cv2
import mediapipe as mp

clips_dir, out_dir = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
os.makedirs(out_dir, exist_ok=True)

mp_pose = mp.solutions.pose
mp_hands = mp.solutions.hands


def run_clip(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    pose = mp_pose.Pose(static_image_mode=False, model_complexity=1,
                        smooth_landmarks=True, min_detection_confidence=0.5,
                        min_tracking_confidence=0.5)
    hands = mp_hands.Hands(static_image_mode=False, max_num_hands=2,
                           model_complexity=1, min_detection_confidence=0.4,
                           min_tracking_confidence=0.4)
    P, PW, PV, H, HW, HS = [], [], [], [], [], []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pr = pose.process(rgb)
        hr = hands.process(rgb)
        if pr.pose_landmarks:
            P.append([[l.x, l.y, l.z] for l in pr.pose_landmarks.landmark])
            PW.append([[l.x, l.y, l.z] for l in pr.pose_world_landmarks.landmark])
            PV.append([l.visibility for l in pr.pose_landmarks.landmark])
        else:
            P.append(np.full((33, 3), np.nan)); PW.append(np.full((33, 3), np.nan)); PV.append(np.zeros(33))
        # up to 2 hands: store image + world landmarks and wrist for assignment later
        hs = np.full((2, 21, 3), np.nan); hw = np.full((2, 21, 3), np.nan); sc = np.zeros(2)
        if hr.multi_hand_landmarks:
            for i, (hl, hwl, hd) in enumerate(zip(hr.multi_hand_landmarks,
                                                    hr.multi_hand_world_landmarks,
                                                    hr.multi_handedness)):
                if i > 1: break
                hs[i] = [[l.x, l.y, l.z] for l in hl.landmark]
                hw[i] = [[l.x, l.y, l.z] for l in hwl.landmark]
                sc[i] = hd.classification[0].score
        H.append(hs); HW.append(hw); HS.append(sc)
    cap.release(); pose.close(); hands.close()
    h_px = None
    return dict(fps=fps, pose=np.array(P), pose_world=np.array(PW), pose_vis=np.array(PV),
                hands=np.array(H), hands_world=np.array(HW), hand_score=np.array(HS))


files = sorted(glob.glob(os.path.join(clips_dir, '*.mp4')))
for f in files:
    name = os.path.splitext(os.path.basename(f))[0]
    if only and name not in only:
        continue
    out = os.path.join(out_dir, name + '.npz')
    if os.path.exists(out) and not only:
        continue
    d = run_clip(f)
    np.savez_compressed(out, **d)
    n = len(d['pose'])
    hd = np.mean(~np.isnan(d['hands'][:, :, 0, 0]).all(axis=1) if False else (~np.isnan(d['hands'][:, :, 0, 0])).sum(axis=1))
    print(f"{name:14s} frames={n:3d} fps={d['fps']:.1f} avg_hands_detected={hd:.2f}", flush=True)
