#!/usr/bin/env python3
"""
Optional step 1b: second-chance hand detection on tight crops.

The full-frame hand detector misses small / partly occluded hands (hand in front
of the chest or face, crossing hands). For clips where it lost many frames, this
crops a window around each *raised* wrist (located by the pose model), upscales
it and re-runs the hand model in static-image mode. Results are stored in the
same .npz as `crop_img` / `crop_world` (T, 2[Left,Right], 21, 3) and are only
used by build_motion.py for frames that have no regular detection.

Usage: python extract_hand_crops.py <clips_dir> <landmarks_dir> name [name ...]
"""
import sys, os
import numpy as np, cv2
import mediapipe as mp

clips_dir, lm_dir = sys.argv[1], sys.argv[2]
names = sys.argv[3:]
hands = mp.solutions.hands.Hands(static_image_mode=True, max_num_hands=2, model_complexity=1,
                                 min_detection_confidence=0.15)
WR = {0: 15, 1: 16}
IDX = {0: 19, 1: 20}
PK = {0: 17, 1: 18}

for nm in names:
    d = dict(np.load(os.path.join(lm_dir, nm + ".npz")))
    cap = cv2.VideoCapture(os.path.join(clips_dir, nm + ".mp4"))
    T = len(d["pose"])
    crop_img = np.full((T, 2, 21, 3), np.nan)
    crop_world = np.full((T, 2, 21, 3), np.nan)
    found = 0
    for t in range(T):
        ok, frame = cap.read()
        if not ok:
            break
        H, W = frame.shape[:2]
        P = d["pose"][t]
        if np.isnan(P).any():
            continue
        sw = np.hypot((P[11, 0] - P[12, 0]) * W, (P[11, 1] - P[12, 1]) * H)
        hip_y = (P[23, 1] + P[24, 1]) / 2
        for s in (0, 1):
            wy = P[WR[s], 1]
            if wy > hip_y - 0.02:  # wrist not raised above the hip line -> skip
                continue
            c = (P[WR[s], :2] * 0.5 + (P[IDX[s], :2] + P[PK[s], :2]) / 2 * 0.5) * [W, H]
            half = int(max(sw * 0.62, 120))
            x0, y0 = int(c[0] - half), int(c[1] - half)
            pad = cv2.copyMakeBorder(frame, half, half, half, half, cv2.BORDER_CONSTANT, value=(60, 60, 60))
            crop = pad[y0 + half:y0 + 3 * half, x0 + half:x0 + 3 * half]
            crop = cv2.resize(crop, (448, 448), interpolation=cv2.INTER_CUBIC)
            r = hands.process(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            if not r.multi_hand_landmarks:
                continue
            best, bd = None, 1e9
            wcrop = ((P[WR[s], :2] * [W, H]) - [x0, y0]) / (2 * half)  # expected wrist in crop-normalised coords
            for hl, hw in zip(r.multi_hand_landmarks, r.multi_hand_world_landmarks):
                dist = np.hypot(hl.landmark[0].x - wcrop[0], hl.landmark[0].y - wcrop[1])
                if dist < bd:
                    bd, best = dist, (hl, hw)
            if best is None or bd > 0.22:
                continue
            hl, hw = best
            # map crop-normalised coords back to full-image normalised coords
            crop_img[t, s] = [[(x0 + l.x * 2 * half) / W, (y0 + l.y * 2 * half) / H, l.z] for l in hl.landmark]
            crop_world[t, s] = [[l.x, l.y, l.z] for l in hw.landmark]
            found += 1
    cap.release()
    d["crop_img"], d["crop_world"] = crop_img, crop_world
    np.savez_compressed(os.path.join(lm_dir, nm + ".npz"), **d)
    print(f"{nm:12s} crop detections: {found}", flush=True)
