/**
 * ISL motion library + timeline.
 *
 * The animation data in /public/isl-motion is produced OFFLINE by
 * scripts/isl-motion/*.py: real signing from the reference clips is captured
 * with MediaPipe and retargeted to the bones of isl-human.glb. At runtime
 * there is no video and no hand-made keyframes: we only play back local bone
 * quaternions for the one avatar, blending between consecutive signs.
 */

export type Confidence = "high" | "medium" | "low";

export interface MotionClip {
  key: string;
  frames: number;
  /** playable duration (seconds) of the window used for playback */
  duration: number;
  /** first frame of the playable window */
  startFrame: number;
  /** frames * bones * 4 quaternions (x,y,z,w) */
  data: Float32Array;
  /** how reliable the captured handshape is (share of frames with a real hand detection) */
  confidence: Confidence;
  handCoverage: number;
  twoHanded: boolean;
}

export interface MotionLibrary {
  fps: number;
  bones: string[];
  rest: Float32Array;
  clips: Record<string, MotionClip>;
}

interface IndexClip {
  dur: number;
  frames: number;
  offset: number;
  hand_detected: { Left: number; Right: number };
  hand_raised: { Left: number; Right: number };
}
interface IndexFile {
  fps: number;
  bones: string[];
  quant: number;
  rest: number[][];
  clips: Record<string, IndexClip>;
}

/** Letter / digit clips raise an open hand first and only form the shape near the end. */
const LETTER_WINDOW_START = 0.7;
/** fingerspelled letters / digits are held at least this long so they stay readable */
const MIN_LETTER_HOLD = 0.5;

export function buildLibrary(index: IndexFile, bin: Int16Array): MotionLibrary {
  const nb = index.bones.length;
  const rest = new Float32Array(nb * 4);
  index.rest.forEach((q, i) => rest.set(q, i * 4));
  const clips: Record<string, MotionClip> = {};
  for (const [key, c] of Object.entries(index.clips)) {
    const n = c.frames * nb * 4;
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = bin[c.offset + i]! / index.quant;
    const single = key.length === 1;
    const startFrame = single ? Math.floor(LETTER_WINDOW_START * (c.frames - 1)) : 0;
    const used = (["Left", "Right"] as const).filter((s) => c.hand_raised[s] >= 0.3);
    const cov = used.length
      ? Math.min(...used.map((s) => Math.min(c.hand_detected[s] / Math.max(c.hand_raised[s], 1e-3), 1)))
      : 1;
    clips[key] = {
      key,
      frames: c.frames,
      startFrame,
      duration: (c.frames - 1 - startFrame) / index.fps,
      data,
      confidence: cov >= 0.6 ? "high" : cov >= 0.35 ? "medium" : "low",
      handCoverage: Math.round(cov * 100) / 100,
      twoHanded: used.length === 2,
    };
  }
  return { fps: index.fps, bones: index.bones, rest, clips };
}

let cache: Promise<MotionLibrary> | null = null;
export function loadMotionLibrary(base = "/isl-motion/"): Promise<MotionLibrary> {
  if (!cache) {
    cache = (async () => {
      const [idx, bin] = await Promise.all([
        fetch(`${base}motion-index.json`).then((r) => {
          if (!r.ok) throw new Error(`motion index: HTTP ${r.status}`);
          return r.json() as Promise<IndexFile>;
        }),
        fetch(`${base}motion.bin`).then((r) => {
          if (!r.ok) throw new Error(`motion data: HTTP ${r.status}`);
          return r.arrayBuffer();
        }),
      ]);
      return buildLibrary(idx, new Int16Array(bin));
    })();
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

// ---------------------------------------------------------------- pose math

export function slerpQuat(a: Float32Array, ai: number, b: Float32Array, bi: number, t: number, out: Float32Array, oi: number) {
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!;
  let bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  let d = ax * bx + ay * by + az * bz + aw * bw;
  if (d < 0) {
    d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  let s0: number, s1: number;
  if (d > 0.9995) {
    s0 = 1 - t; s1 = t;
  } else {
    const th = Math.acos(d), sn = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / sn;
    s1 = Math.sin(t * th) / sn;
  }
  const x = s0 * ax + s1 * bx, y = s0 * ay + s1 * by, z = s0 * az + s1 * bz, w = s0 * aw + s1 * bw;
  const n = Math.hypot(x, y, z, w) || 1;
  out[oi] = x / n; out[oi + 1] = y / n; out[oi + 2] = z / n; out[oi + 3] = w / n;
}

export function slerpPose(a: Float32Array, b: Float32Array, t: number, out: Float32Array) {
  for (let i = 0; i < out.length; i += 4) slerpQuat(a, i, b, i, t, out, i);
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Sample a clip's playable window at `t` seconds (clamped). */
export function sampleClip(clip: MotionClip, nb: number, fps: number, t: number, out: Float32Array) {
  const f = Math.min(Math.max(t * fps, 0), clip.frames - 1 - clip.startFrame) + clip.startFrame;
  const i0 = Math.floor(f), i1 = Math.min(i0 + 1, clip.frames - 1), u = f - i0;
  const stride = nb * 4;
  for (let i = 0; i < stride; i += 4) slerpQuat(clip.data, i0 * stride + i, clip.data, i1 * stride + i, u, out, i);
}

function framePose(clip: MotionClip, nb: number, which: "first" | "last"): Float32Array {
  const stride = nb * 4;
  const f = which === "first" ? clip.startFrame : clip.frames - 1;
  return clip.data.subarray(f * stride, (f + 1) * stride);
}

// ----------------------------------------------------------------- timeline

export interface SignStep {
  key: string;
  caption: string;
  kind: "sign" | "letter" | "digit";
  /** index of the gloss token this step belongs to (for UI highlighting) */
  token: number;
}

export interface Segment {
  stepIndex: number;
  clip: MotionClip;
  blendStart: number;
  playStart: number;
  playEnd: number;
  from: Float32Array;
  to: Float32Array;
}

export interface Timeline {
  segments: Segment[];
  total: number;
  tailEnd: number;
  lastPose: Float32Array;
}

const T_FIRST = 0.3, T_SIGN = 0.2, T_LETTER = 0.1, T_END = 0.35;

export function buildTimeline(steps: SignStep[], lib: MotionLibrary): Timeline {
  const nb = lib.bones.length;
  const segments: Segment[] = [];
  let c = 0;
  let prev: Float32Array = lib.rest;
  let prevKind: SignStep["kind"] | null = null;
  steps.forEach((s, i) => {
    const clip = lib.clips[s.key];
    if (!clip) return;
    const tr = prevKind === null ? T_FIRST : s.kind !== "sign" && prevKind !== "sign" ? T_LETTER : T_SIGN;
    const to = framePose(clip, nb, "first");
    const len = s.kind === "sign" ? clip.duration : Math.max(clip.duration, MIN_LETTER_HOLD);
    segments.push({ stepIndex: i, clip, blendStart: c, playStart: c + tr, playEnd: c + tr + len, from: prev, to });
    c += tr + len;
    prev = framePose(clip, nb, "last");
    prevKind = s.kind;
  });
  return { segments, total: c, tailEnd: c + T_END, lastPose: prev };
}

/** Writes the pose at time `t` into `out`; returns the active step index (or -1 when idle / finished). */
export function samplePose(tl: Timeline, lib: MotionLibrary, t: number, out: Float32Array): number {
  const nb = lib.bones.length;
  if (!tl.segments.length || t >= tl.total) {
    if (tl.segments.length && t < tl.tailEnd) slerpPose(tl.lastPose, lib.rest, smooth((t - tl.total) / T_END), out);
    else out.set(lib.rest);
    return -1;
  }
  let seg = tl.segments[0]!;
  for (const s of tl.segments) {
    if (t >= s.blendStart) seg = s;
    else break;
  }
  if (t < seg.playStart) {
    slerpPose(seg.from, seg.to, smooth((t - seg.blendStart) / (seg.playStart - seg.blendStart)), out);
    return seg.stepIndex;
  }
  sampleClip(seg.clip, nb, lib.fps, t - seg.playStart, out);
  return seg.stepIndex;
}
