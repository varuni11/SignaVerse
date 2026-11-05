import os, sys, json, math
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

CLIPS_DIR = "/home/claude/signaverse/build/source-assets/isl-clips"
MODEL_PATH = "/home/claude/hand_landmarker.task"
OUT_PATH = "/home/claude/extract/templates.json"
T = 10  # fixed keyframe count per template

base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
options = vision.HandLandmarkerOptions(
    base_options=base_options,
    num_hands=2,
    running_mode=vision.RunningMode.IMAGE,
    min_hand_detection_confidence=0.3,
    min_hand_presence_confidence=0.3,
)
_detector = vision.HandLandmarker.create_from_options(options)

def normalize_hand(lm):
    # lm: list of 21 (x,y,z) in image-normalized coords
    wrist = np.array(lm[0])
    mcp = np.array(lm[9])
    scale = np.linalg.norm(mcp[:2] - wrist[:2])
    if scale < 1e-6:
        scale = 1e-6
    out = []
    for p in lm:
        v = (np.array(p) - wrist) / scale
        out.append([float(v[0]), float(v[1]), float(v[2])])
    return out, [float(wrist[0]), float(wrist[1])]

def process_clip(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        try:
            result = _detector.detect(mp_image)
        except Exception:
            result = None
        left = None
        right = None
        if result and result.hand_landmarks:
            for hand_lm, handedness in zip(result.hand_landmarks, result.handedness):
                label = handedness[0].category_name  # 'Left' or 'Right'
                pts = [[p.x, p.y, p.z] for p in hand_lm]
                norm, wristpos = normalize_hand(pts)
                entry = {"norm": norm, "wrist": wristpos}
                if label == "Left":
                    left = entry
                else:
                    right = entry
        frames.append({"left": left, "right": right})
        idx += 1
    cap.release()
    return frames

def resample(frames, T):
    n = len(frames)
    if n == 0:
        return None
    if n == 1:
        idxs = [0] * T
    else:
        idxs = [round(i * (n - 1) / (T - 1)) for i in range(T)]
    return [frames[i] for i in idxs]

def main():
    files = sorted(f for f in os.listdir(CLIPS_DIR) if f.endswith(".mp4"))
    templates = {}
    for i, fname in enumerate(files):
        word = fname[:-4]
        path = os.path.join(CLIPS_DIR, fname)
        frames = process_clip(path)
        # keep only frames where at least one hand detected, for resampling base
        useful = [f for f in frames if f["left"] or f["right"]]
        basis = useful if len(useful) >= 3 else frames
        sampled = resample(basis, T)
        if sampled is None:
            print(f"[WARN] no frames at all for {word}", file=sys.stderr)
            continue
        left_frac = sum(1 for f in basis if f["left"]) / max(1, len(basis))
        right_frac = sum(1 for f in basis if f["right"]) / max(1, len(basis))
        templates[word] = {
            "frames": sampled,
            "hands": {
                "left": left_frac > 0.3,
                "right": right_frac > 0.3,
            },
            "nSourceFrames": len(frames),
            "nUsefulFrames": len(useful),
        }
        print(f"[{i+1}/{len(files)}] {word}: total={len(frames)} useful={len(useful)} L={left_frac:.2f} R={right_frac:.2f}")

    with open(OUT_PATH, "w") as f:
        json.dump(templates, f)
    print("Wrote", OUT_PATH, "with", len(templates), "templates")

if __name__ == "__main__":
    main()
