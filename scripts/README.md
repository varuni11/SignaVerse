# ISL template extraction pipeline

Generates `public/isl-templates.json`, the recognition library that
Camera → Text matches live webcam hand landmarks against. This only needs to
be re-run if clips in `source-assets/isl-clips` are added, replaced, or re-shot —
the generated JSON is committed, so the app itself never runs this at
runtime.

## Requirements

```bash
pip install mediapipe opencv-python-headless numpy
```

You also need `hand_landmarker.task` (MediaPipe's hand-landmark model,
~7.8MB) in this directory. Google publishes it at
`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
— download it from there, or any trusted mirror, and place it at
`scripts/hand_landmarker.task`.

## Run

```bash
cd scripts
python3 extract_raw_landmarks.py   # -> templates.json (verbose, ~2.3MB)
python3 pack_templates.py          # -> isl-templates.json (compact, ~1MB)
cp isl-templates.json ../public/isl-templates.json
```

## What it does

1. `extract_raw_landmarks.py` runs MediaPipe's HandLandmarker (2 hands,
   IMAGE mode) over every frame of every clip in `source-assets/isl-clips`.
   For each detected hand it normalises the 21 landmarks relative to the
   wrist and scales by hand size (distance from wrist to the middle-finger
   knuckle), so the template is invariant to how close/far the signer is
   from the camera. Each clip is then resampled to 10 evenly-spaced
   keyframes (biased toward frames where a hand was actually visible).

2. `pack_templates.py` flattens that into compact numeric arrays (no
   repeated JSON keys) and rounds to 3 decimal places, shrinking the file
   from ~2.3MB to ~1MB.

## Tuning recognition accuracy

The live matching thresholds (`MATCH_DISTANCE_MAX`, `MATCH_MARGIN_RATIO`)
live in `src/components/avatar/isl-recognizer.ts`, not here — adjust those
based on real-world testing, not this extraction step.
