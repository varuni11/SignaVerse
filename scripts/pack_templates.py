import json

T = 10
NUM_LM = 21

src = json.load(open('/home/claude/extract/templates.json'))

def r(x, nd=3):
    return round(x, nd)

def hand_to_flat(entry):
    # entry: {"norm": [[x,y,z]*21], "wrist":[x,y]} or None
    if entry is None:
        return [0] + [0.0] * (NUM_LM * 3) + [0.0, 0.0]
    flat = [1]
    for p in entry["norm"]:
        flat.extend([r(p[0]), r(p[1]), r(p[2])])
    flat.extend([r(entry["wrist"][0]), r(entry["wrist"][1])])
    return flat

out = {}
for word, tpl in src.items():
    frames_flat = []
    for fr in tpl["frames"]:
        row = hand_to_flat(fr["left"]) + hand_to_flat(fr["right"])
        frames_flat.append(row)
    out[word] = {
        "hands": [1 if tpl["hands"]["left"] else 0, 1 if tpl["hands"]["right"] else 0],
        "frames": frames_flat,
    }

with open('/home/claude/extract/isl-templates.json', 'w') as f:
    json.dump({"version": 1, "featuresPerHand": 1 + NUM_LM * 3 + 2, "keyframes": T, "signs": out}, f, separators=(',', ':'))

import os
print("size KB:", os.path.getsize('/home/claude/extract/isl-templates.json') / 1024)
