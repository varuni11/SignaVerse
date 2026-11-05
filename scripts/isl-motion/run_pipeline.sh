#!/usr/bin/env bash
# Rebuild public/isl-motion/ from the reference clips in source-assets/isl-clips.
# Usage:  bash scripts/isl-motion/run_pipeline.sh            (from the project root)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-$ROOT/.motion-work}"
PY="${PYTHON:-python3}"
if [ ! -d "$WORK/venv" ]; then
  "$PY" -m venv "$WORK/venv"
  "$WORK/venv/bin/pip" install -q -r "$ROOT/scripts/isl-motion/requirements.txt"
fi
V="$WORK/venv/bin/python"
cd "$ROOT/scripts/isl-motion"
# 1. raw landmarks (pose + hands), ~3 s per clip on one CPU core
"$V" extract_landmarks.py "$ROOT/source-assets/isl-clips" "$WORK/lm"
# 1b. second-chance hand detection on crops (only for clips with weak hand coverage; optional but recommended)
"$V" extract_hand_crops.py "$ROOT/source-assets/isl-clips" "$WORK/lm" $(ls "$WORK/lm" | sed 's/\.npz//')
# 2. solve bone rotations for isl-human.glb and pack  -> public/isl-motion/{motion.bin,motion-index.json}
"$V" build_motion.py "$WORK/lm" "$ROOT/src/assets/isl-human.glb" "$ROOT/public/isl-motion"
echo "done: public/isl-motion updated"
