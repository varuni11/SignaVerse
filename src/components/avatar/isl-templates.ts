/**
 * Loads the ISL recognition template library: /public/isl-templates.json.
 *
 * That file is NOT hand-authored. It was generated once, offline, by running
 * Google's MediaPipe HandLandmarker model over every clip in
 * /source-assets/isl-clips (the same 151 real ISL assets — words, the A–Z manual
 * alphabet, and 0–9 — that the text→ISL avatar plays back). For each clip we
 * extracted per-frame hand landmarks, normalised them (translated to the
 * wrist, scaled by hand size so it's camera-distance invariant), and
 * resampled every clip down to a fixed 10 keyframes. That gives every sign a
 * compact, comparable "motion fingerprint".
 *
 * Camera→Text recognition (see isl-recognizer.ts) works by extracting the
 * same kind of fingerprint from the live webcam feed and finding the closest
 * template — i.e. it genuinely compares against the real asset library
 * rather than a hand-coded ruleset. See scripts/extract-isl-templates.py for
 * the extraction pipeline (re-run it if isl-clips ever changes).
 */

export interface HandTemplateFrame {
  /** Flat feature vector: [presence(0|1), 21×(x,y,z) normalised, wristX, wristY]. */
  left: number[];
  right: number[];
}

export interface SignTemplate {
  /** Which hand(s) this sign predominantly uses. */
  hands: [left: boolean, right: boolean];
  /** `keyframes` resampled frames, each a flattened [left(66) + right(66)] vector. */
  frames: number[][];
}

export interface TemplateLibrary {
  version: number;
  featuresPerHand: number;
  keyframes: number;
  signs: Record<string, SignTemplate>;
}

import {
  ISL_WORD_CLIPS,
  ISL_LETTER_CLIPS,
  ISL_DIGIT_CLIPS,
} from "./isl-video-library";

/**
 * Template ids are clip filenames (e.g. "thank-you", "do-not"), because
 * that's what the extraction script iterates over on disk. The library's
 * *display* labels use spaces ("thank you"). This builds the id → label
 * lookup once from the existing clip maps, so there's one source of truth.
 */
let labelMap: Map<string, string> | null = null;

function stemFromUrl(url: string): string {
  const file = url.split("/").pop() ?? url;
  return file.replace(/\.mp4$/i, "");
}

function getLabelMap(): Map<string, string> {
  if (!labelMap) {
    labelMap = new Map();
    for (const [label, url] of [
      ...Object.entries(ISL_WORD_CLIPS),
      ...Object.entries(ISL_LETTER_CLIPS),
      ...Object.entries(ISL_DIGIT_CLIPS),
    ]) {
      labelMap.set(stemFromUrl(url), label);
    }
  }
  return labelMap;
}

/** Converts a template id ("thank-you") to its display label ("thank you"). */
export function labelForTemplateId(id: string): string {
  return getLabelMap().get(id) ?? id.replace(/-/g, " ");
}

/** True for single-character templates (a–z, 0–9) — used to render fingerspelling tighter than word signs. */
export function isLetterOrDigit(label: string): boolean {
  return label.length === 1;
}

let cached: Promise<TemplateLibrary> | null = null;

/** Fetches + caches /isl-templates.json (served from /public, ~1MB). */
export function loadTemplateLibrary(): Promise<TemplateLibrary> {
  if (!cached) {
    cached = fetch("/isl-templates.json")
      .then((res) => {
        if (!res.ok) throw new Error(`isl-templates.json ${res.status}`);
        return res.json() as Promise<TemplateLibrary>;
      })
      .catch((err) => {
        cached = null; // allow retry on next call
        throw err;
      });
  }
  return cached;
}
