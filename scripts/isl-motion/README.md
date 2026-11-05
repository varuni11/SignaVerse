# ISL motion pipeline (offline)

Turns the 151 reference clips in `source-assets/isl-clips` into bone animation for the one avatar
(`src/assets/isl-human.glb`). Run it only when clips or the avatar change; the app itself just plays
`public/isl-motion/motion.bin`.

| script | what it does |
|---|---|
| `extract_landmarks.py` | MediaPipe Pose + Hands on every frame → raw landmarks (NaN where nothing was detected) |
| `extract_hand_crops.py` | re-runs hand detection on tight, upscaled crops around raised wrists for frames the first pass missed |
| `build_motion.py` | retargets to the avatar: arm IK, palm orientation, every finger joint, head; writes `motion.bin` + `motion-index.json` (per-clip hand-detection coverage) |
| `render_check.py` | renders the real avatar mesh in the solved poses next to the source video (visual QA) |
| `avatar_rig.py` | glTF skeleton / FK / skinning helpers |

Run everything: `npm run isl:motion` (creates a venv under `.motion-work/`).
Quality check: `python render_check.py <glb> <solved_dir> <clips_dir> out.png word1 word2 …`
