## ISL avatar & translation (current architecture)

* One avatar only: `src/assets/isl-human.glb`. No video player, no second avatar.
* Text and English speech → `src/components/avatar/isl/english-to-isl.ts` (normalise → tag with `compromise` → ISL gloss order → sign lookup → fingerspelling for unseen words) → `motion.ts` timeline → `IslAvatar.tsx` plays bone rotations.
* Motion data: `public/isl-motion/` is generated offline from the reference clips (`source-assets/isl-clips`) by `scripts/isl-motion` (`npm run isl:motion`).
* Tests: `npm run test:isl` (translation rules + runtime playback checks).
* Honest limits: see `ISL_REPORT.md`.

# SignaAI — Indian Sign Language communication site

A Vite + React 19 + TanStack Router single-page app that translates speech and
text into Indian Sign Language, and shows it two ways:

1. **Realistic signer (default, recommended)** — plays real recorded ISL
   video clips for ~115 common words plus the full A–Z manual alphabet and
   0–9 digits. Anything not in the word list is fingerspelled letter-by-letter
   with real alphabet footage instead of being guessed. This is the accurate,
   production-ready mode.
2. **3D avatar** — a procedurally animated glTF character (`isl-human.glb`)
   driven by hand-authored keyframes for a small, verified sign set
   (`src/components/avatar/isl-signs.ts`). Useful as a preview of a fully
   rigged 3D pipeline, but intentionally limited in vocabulary — it never
   approximates a sign it hasn't been given real articulation data for.

Both modes share the same **meaning-based translator**: function words
(articles, copula "is/am/are", "to") are dropped, WH-question words move to
the end of the sequence (ISL question-word-final grammar), fixed phrases like
"thank you" / "do not" / "cannot" are matched as whole units before
single-word matching, and everything is reordered by meaning, not typed word
order.

**Voice input** uses the browser's built-in Web Speech API
(`SpeechRecognition`) — no server, API key, or network call required. It's
supported in Chrome/Edge; the mic button hides itself automatically in
browsers without support (e.g. Firefox).

## Why this isn't "3D motion-captured from the videos"

The uploaded asset pack (`assets.7z`) contains **151 real ISL video clips**
(words + alphabet + digits), not 3D animation/motion-capture data. Retargeting
real video onto a 3D skeleton accurately requires a pose-estimation and
retargeting ML pipeline — attempting to fake that with hand-tuned inverse
kinematics would produce exactly the "random hand-waving" this project is
explicit about avoiding. Instead, the real footage is used directly (it's
already both realistic *and* accurate), and the 3D avatar is kept for its own
small, verified sign set rather than overstated.

## Project structure

```
src/
  components/
    avatar/
      AvatarStage.tsx           – shared UI: mode toggle, text/voice input, controls
      VideoSignPlayer.tsx       – crossfading video queue player (realistic signer)
      isl-video-library.ts      – generated manifest of /source-assets/isl-clips/*.mp4
      isl-video-translate.ts    – meaning-based translator → video clip queue
      useVoiceInput.ts          – Web Speech API wrapper
      HumanSignAvatar.tsx       – 3D GLB rig renderer (react-three-fiber)
      SignAvatar.tsx            – CSS-only fallback avatar (SSR/no-WebGL safe)
      isl-signs.ts              – 3D rig's curated sign library + translator
  routes/                       – file-based pages (TanStack Router)
public/
  isl-clips/                    – 151 real ISL video clips (words, A-Z, 0-9)
```

## Setup

Requires Node.js 20+.

```bash
npm install
```

## Run (development)

```bash
npm run dev
```

Opens at http://localhost:5173 with hot reload.

## Build for production

```bash
npm run build
npm run preview   # serve the production build locally on http://localhost:4173
```

The build is a static SPA (`dist/`) — deploy it to any static host (Netlify,
Vercel, S3+CloudFront, GitHub Pages, nginx, etc). No server runtime is
required.

## Extending the sign vocabulary

- **New sign**: add `word.mp4` (front-facing signer, upper body visible) to `source-assets/isl-clips/`,
  then run `npm run isl:motion`. The sign appears in the translator, the library chips and the avatar.
  Add synonyms / approximations in `src/components/avatar/isl/lexicon.ts`.

## Notes

- Video files are served as static assets — no bundler transform, so adding
  clips never requires a rebuild step beyond restarting `vite dev`.
- The 3D avatar lazy-loads (`react-three-fiber`/`three`) only when its tab is
  opened, keeping the initial page weight small.
