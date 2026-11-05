# SignaVerse AI – ISL avatar pipeline: final report

## What changed (existing project modified, not rebuilt)
* **One avatar only:** `src/assets/isl-human.glb`. Removed: `VideoSignPlayer`, the "Realistic signer / 3D avatar" toggle, `isl-video-translate.ts`, the CSS fallback avatar (`SignAvatar`), the old `HumanSignAvatar` and its 1,700-line hand-keyframed `isl-signs.ts`.
* **Video workflow disabled:** the 151 clips moved from `public/isl-clips` to `source-assets/isl-clips` (no longer served or played). They are the *source* for offline motion extraction and for the existing camera-to-text templates.
* **New English → ISL pipeline** (`src/components/avatar/isl/english-to-isl.ts`) used by typed text and English speech (Web Speech API, `en-IN`): normalise → tag (`compromise`, MIT) → ISL gloss order → lexicon/lemma/synonym lookup → fingerspelling for unseen words → report.
* **New avatar animation** (`isl/motion.ts`, `isl/IslAvatar.tsx`): plays bone rotations for the same GLB, blends between signs, shows the current sign/letter.
* **Preserved:** layout, play/pause/replay, speed, Speak (mic), camera preview, avatar-speaks (TTS), usage tracking, "Request this sign", sign library chips, camera-to-text, admin/profile pages. Marketing copy that described video/keyframes was corrected.

## How the animation is produced (nothing hand-faked)
Offline (`npm run isl:motion`): MediaPipe Pose+Hands on all 151 clips → retarget to the real skeleton of `isl-human.glb`: arm IK (hand lands where the signer's hand is, face-contact corrected), palm orientation, **every finger joint**, head/neck. Output `public/isl-motion/motion.bin` (1.6 MB, 38 bones, 24 fps) + `motion-index.json` (per-sign hand-tracking coverage). At runtime the avatar only plays these rotations.

## Setup
```bash
npm install
npm run dev            # http://localhost:3000 (or the port Vite prints) -> /demo or /dashboard
npm run build          # static SPA in dist/
npm run test:isl       # translation + runtime playback tests
# only if clips/avatar change (needs Python 3.10-3.12, ~10 min on 1 CPU):
npm run isl:motion
```

## Actual test results
Run: `npm run test:isl` (exit code 0).
```
PASS  "Hello"                                        -> HELLO
PASS  "Thank you"                                    -> THANK-YOU
PASS  "How are you"                                  -> YOU HOW
PASS  "My name is Rahul"                             -> MY NAME R-A-H-U-L
PASS  "I can not come"                               -> ME COME CANNOT
PASS  "Where is the college?"                        -> COLLEGE WHERE
PASS  "What is your name?"                           -> YOUR NAME WHAT
PASS  "Who are you?"                                 -> YOU WHO
PASS  "Are you happy?"                               -> YOU HAPPY
PASS  "Do not go"                                    -> GO DO-NOT
PASS  "I do not eat"                                 -> ME EAT NOT
PASS  "I have eaten"                                 -> ME EAT FINISH
PASS  "I am going to study"                          -> ME STUDY WILL
PASS  "I want to learn sign language"                -> ME SIGN LANGUAGE LEARN W-A-N-T
PASS  "She went to the market"                       -> THAT~ M-A-R-K-E-T GO FINISH
PASS  "I will study tomorrow"                        -> T-O-M-O-R-R-O-W ME STUDY
PASS  "Can you help me?"                             -> YOU ME HELP CAN
PASS  "hi my name is priya i am from chennai"        -> HELLO MY NAME P-R-I-Y-A ME FROM C-H-E-N-N-A-I
PASS  "I am twenty five"                             -> ME 25
PASS  ""                                             -> 
PASS  "the"                                          -> 
PASS  unseen word fingerspelled + reported -> R-E-F-R-I-G-E-R-A-T-O-R O-P-E-N
PASS  non-English text reported as unsupported -> HELLO | unsupported=नमस्ते
all pipeline checks passed
sentence                           steps dur(s) maxJump(deg/frame@60fps) boundaryJump lowConf status
Hello                                  1    1.5           11.4        2.1 -        PASS
Thank you                              1    1.6           12.5        0.9 -        PASS
How are you                            2    2.5           22.3        5.5 -        PASS
My name is Rahul                       7    5.9           67.0       14.5 MY       PASS
I can not come                         3    4.2           18.8        5.6 -        PASS
Where is the college?                  2    3.4           59.3        6.0 -        PASS
I will study tomorrow                 10    7.5           67.0       23.6 -        PASS
She went to the market                 9    7.6           67.0       15.5 -        PASS
What did you eat yesterday?           12    9.6           67.0       27.7 EAT      PASS
Are you happy?                         2    2.7           22.3        8.0 -        PASS
Do not go                              2    2.3           54.8        9.9 -        PASS
I am 25 years old                     11    7.3           67.0       17.5 -        PASS
I want to learn sign language          8    9.2           71.6       21.4 -        PASS
Good morning my friend                15   10.7           71.6       26.1 MY       PASS
all runtime checks passed
```
Also verified: `tsc --noEmit` clean (strict), `vite build` succeeds; the JS timeline's sampled poses were rendered onto the real GLB mesh offline (`preview_*.png`).

Motion-data quality (all 151 clips solved, 0 failures):
* Hand-tracking confidence per sign: **98 high, 32 medium, 21 low** (share of frames where a real hand detection backs the handshape; outlier detections are rejected, not trusted).
* Low-confidence signs (handshape partly held/interpolated; arm path still tracked): age, best, better, day, eat, engineer, fight, god, help, home, keep, my, out, sad, they, time, type, wash, way, without, world. They are marked ⚠ in the gloss. Letter M is medium; all other letters and all digits are high.
* Visually checked on the avatar mesh against the source video: hello, good, eat, my, day, type, sad, at, digit 2, letters A B C L V. Arms/face contact/handshapes matched; the other ~140 signs were NOT individually reviewed.

## Honest limitations
1. **Not validated by an ISL signer.** Gloss order (time first, SOV, negation/WH last, FINISH for past, WILL for future, "to/the/is" dropped) is a rule-based approximation. The expected outputs in the tests were taken from the pipeline's own output, so they guard against regressions; they do **not** prove linguistic correctness. Please have a fluent ISL signer review rules and signs.
2. **No facial grammar.** The avatar has no eyebrow/mouth controls; questions only get a small head tilt. The UI says so.
3. **Retargeting from single-camera video is approximate** (depth, fast finger changes, hands touching/occluding each other). Hands that cross (e.g. "type", "at") look right but are not precise.
4. **Vocabulary is the 115 words + A–Z + 0–9 provided.** Missing everyday words (he, she, have, yes, no, want, like, friend, morning, tomorrow, …) are fingerspelled, or shown with a clearly marked **approximate** sign (dashed chip, listed in the panel): he/she/him→THAT, no/never→NOT, could→CAN, would→WILL, fine/nice→GOOD, house→HOME, look/watch→SEE, etc. Names are fingerspelled. Numbers above 9 are signed digit by digit.
5. Fingerspelling uses the provided single-letter clips (only the formed-letter portion is played). Readability of every letter at normal speed has not been tested with real viewers.
6. **Not tested in a real browser:** no browser was available in my environment. WebGL rendering, the mic/speech flow, TTS, camera preview and camera-to-text were not exercised end to end; only compilation, the build, the translator, and the playback maths (plus offline mesh renders of the same poses) were. Please smoke-test `/demo` and `/dashboard` once.
7. Admin "custom clip URL" entries cannot animate the avatar until motion data is generated for that clip (re-run `npm run isl:motion` with the clip added).
8. Possessive 's is dropped, plurals are not marked, English only (non-English words are reported as unsupported).

## Files
`src/components/avatar/isl/{motion.ts,IslAvatar.tsx,english-to-isl.ts,lexicon.ts}`, `AvatarStage.tsx` (rewired), `scripts/isl-motion/*`, `public/isl-motion/*`, `tests/*`, `source-assets/isl-clips/*`.
