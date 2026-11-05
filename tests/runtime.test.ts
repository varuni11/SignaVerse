import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildLibrary, buildTimeline, samplePose } from "../src/components/avatar/isl/motion";
import { translateEnglishToISL, vocabularyFromKeys } from "../src/components/avatar/isl/english-to-isl";

const idx = JSON.parse(readFileSync("public/isl-motion/motion-index.json", "utf8"));
const bin = readFileSync("public/isl-motion/motion.bin");
const lib = buildLibrary(idx, new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2));
const low = new Set(Object.values(lib.clips).filter((c) => c.confidence === "low").map((c) => c.key));
const V = vocabularyFromKeys(Object.keys(lib.clips), low);

const SENTENCES = [
  "Hello", "Thank you", "How are you", "My name is Rahul", "I can not come", "Where is the college?",
  "I will study tomorrow", "She went to the market", "What did you eat yesterday?", "Are you happy?",
  "Do not go", "I am 25 years old", "I want to learn sign language", "Good morning my friend",
];
const nb = lib.bones.length;
const out: Record<string, unknown> = {};
let fail = 0;
const ang = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i]! * b[i]! + a[i + 1]! * b[i + 1]! + a[i + 2]! * b[i + 2]! + a[i + 3]! * b[i + 3]!);
    m = Math.max(m, 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI);
  }
  return m;
};
console.log("sentence".padEnd(34), "steps", "dur(s)", "maxJump(deg/frame@60fps)", "boundaryJump", "lowConf", "status");
for (const s of SENTENCES) {
  const tr = translateEnglishToISL(s, V);
  const missing = tr.steps.filter((st) => !lib.clips[st.key]);
  const tl = buildTimeline(tr.steps, lib);
  const p = new Float32Array(nb * 4), q = new Float32Array(nb * 4);
  let maxJump = 0, bad = 0, prev: Float32Array | null = null, boundary = 0;
  const bounds = tl.segments.flatMap((sg) => [sg.playStart, sg.playEnd]);
  const poses: number[][] = [];
  for (let t = 0; t <= tl.tailEnd + 0.2; t += 1 / 60) {
    samplePose(tl, lib, t, p);
    for (let i = 0; i < p.length; i += 4) {
      const n = Math.hypot(p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!);
      if (!(Math.abs(n - 1) < 0.01)) bad++;
    }
    if (prev) {
      const j = ang(prev, p);
      maxJump = Math.max(maxJump, j);
      if (bounds.some((b) => Math.abs(t - b) < 1 / 60 + 1e-6)) boundary = Math.max(boundary, j);
    }
    prev = Float32Array.from(p);
    if (Math.round(t * 60) % 8 === 0) poses.push(Array.from(p));
  }
  const lowUsed = tr.tokens.filter((t) => t.lowConfidence).map((t) => t.gloss);
  const ok = !missing.length && !bad && maxJump < 110 && boundary < 40 && tr.steps.length > 0;
  if (!ok) fail++;
  console.log(s.padEnd(34), String(tr.steps.length).padStart(5), tl.total.toFixed(1).padStart(6), maxJump.toFixed(1).padStart(14), boundary.toFixed(1).padStart(10), (lowUsed.join(",") || "-").padEnd(8), ok ? "PASS" : `FAIL missing=${missing.length} badNorm=${bad}`);
  out[s] = { gloss: tr.tokens.map((t) => t.gloss), poses };
}
mkdirSync("/home/claude/work", { recursive: true });
writeFileSync("/home/claude/work/runtime_poses.json", JSON.stringify({ bones: lib.bones, fps: 60 / 8, items: out }));
console.log(fail ? `\n${fail} FAILED` : "\nall runtime checks passed");
process.exit(fail ? 1 : 0);
