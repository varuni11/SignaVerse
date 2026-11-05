/**
 * Live ISL sign recognition engine.
 *
 * Turns MediaPipe hand landmarks from the webcam into the same kind of
 * normalised "motion fingerprint" used to build the offline template
 * library (see isl-templates.ts), then finds the closest matching sign by
 * comparing resampled sequences.
 *
 * This is deliberately conservative: if the best match isn't clearly better
 * than the runner-up, or the distance is too high, we report "no match"
 * rather than guess. False negatives (missed signs) are an acceptable cost;
 * false positives (wrong word typed) are not.
 *
 * NOTE: the distance thresholds below are reasonable starting points based
 * on the geometry of the normalisation (wrist-relative, hand-scale
 * invariant coordinates, so unit values roughly span -2..2). They have not
 * been empirically tuned against real webcam footage across lighting/skin
 * tone/camera variation — that calibration pass should happen against real
 * users before this ships as the sole gate on production accuracy. Treat
 * MATCH_DISTANCE / MATCH_MARGIN as the first thing to adjust if the demo is
 * too strict (misses valid signs) or too loose (false-positives).
 */

import type { TemplateLibrary } from "./isl-templates";

export type Point3 = { x: number; y: number; z: number };

const NUM_LANDMARKS = 21;
const FEATURES_PER_HAND = 1 + NUM_LANDMARKS * 3 + 2; // 66

/** Normalises one hand's 21 landmarks: wrist-relative, scaled by hand size. */
function normaliseHand(landmarks: Point3[]): number[] {
  const wrist = landmarks[0]!;
  const mcp = landmarks[9]!; // middle-finger MCP knuckle
  const scale = Math.max(1e-6, Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y));
  const flat: number[] = [1]; // presence bit
  for (const p of landmarks) {
    flat.push(
      (p.x - wrist.x) / scale,
      (p.y - wrist.y) / scale,
      (p.z - wrist.z) / scale,
    );
  }
  flat.push(wrist.x, wrist.y);
  return flat;
}

const EMPTY_HAND: number[] = new Array(FEATURES_PER_HAND).fill(0);

function handToFlat(landmarks: Point3[] | null): number[] {
  return landmarks ? normaliseHand(landmarks) : EMPTY_HAND;
}

/** One sampled instant from the webcam: both hands' flat feature vectors. */
export interface FrameSample {
  vec: number[]; // length 132: [left(66), right(66)]
  hasLeft: boolean;
  hasRight: boolean;
  t: number; // performance.now() timestamp
}

export function buildFrameSample(
  left: Point3[] | null,
  right: Point3[] | null,
  t: number,
): FrameSample {
  return {
    vec: [...handToFlat(left), ...handToFlat(right)],
    hasLeft: !!left,
    hasRight: !!right,
    t,
  };
}

/**
 * Resamples a rolling buffer down to `T` frames, mirroring how templates
 * were built: prefer frames where at least one hand was visible, uniformly
 * sampled across that useful span. Returns null if there isn't enough
 * gesture data yet (too few useful frames = user just raised their hand).
 */
export function resampleBuffer(
  buffer: FrameSample[],
  T: number,
  minUsefulFrames = 4,
): number[][] | null {
  const useful = buffer.filter((f) => f.hasLeft || f.hasRight);
  const basis = useful.length >= minUsefulFrames ? useful : null;
  if (!basis) return null;
  const n = basis.length;
  const out: number[][] = [];
  for (let i = 0; i < T; i++) {
    const idx = n === 1 ? 0 : Math.round((i * (n - 1)) / (T - 1));
    out.push(basis[idx]!.vec);
  }
  return out;
}

function sequenceDistance(a: number[][], b: number[][]): number {
  let sumSq = 0;
  let count = 0;
  for (let f = 0; f < a.length; f++) {
    const af = a[f]!;
    const bf = b[f]!;
    for (let i = 0; i < af.length; i++) {
      const d = af[i]! - bf[i]!;
      sumSq += d * d;
      count++;
    }
  }
  return Math.sqrt(sumSq / Math.max(1, count));
}

export interface MatchResult {
  word: string;
  distance: number;
  runnerUp: number; // distance of the 2nd-best match, for margin checks
}

/** Compares a resampled live sequence against every template; returns the best. */
export function findBestMatch(
  sample: number[][],
  library: TemplateLibrary,
): MatchResult | null {
  let best: { word: string; distance: number } | null = null;
  let second = Infinity;

  for (const [word, tpl] of Object.entries(library.signs)) {
    const d = sequenceDistance(sample, tpl.frames);
    if (!best || d < best.distance) {
      second = best ? best.distance : second;
      best = { word, distance: d };
    } else if (d < second) {
      second = d;
    }
  }
  if (!best) return null;
  return { word: best.word, distance: best.distance, runnerUp: second };
}

/** Distance thresholds — see file header caveat about tuning against real users. */
export const MATCH_DISTANCE_MAX = 0.62;
/** Best match must be at least this much better than the runner-up (ratio). */
export const MATCH_MARGIN_RATIO = 0.82;

export function isConfidentMatch(m: MatchResult): boolean {
  return (
    m.distance <= MATCH_DISTANCE_MAX &&
    m.distance <= m.runnerUp * MATCH_MARGIN_RATIO
  );
}
