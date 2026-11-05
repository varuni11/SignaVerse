import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadTemplateLibrary,
  labelForTemplateId,
  type TemplateLibrary,
} from "./isl-templates";
import {
  buildFrameSample,
  resampleBuffer,
  findBestMatch,
  isConfidentMatch,
  type FrameSample,
  type Point3,
} from "./isl-recognizer";
import { logUnmatchedGesture } from "@/lib/library-request-store";

/**
 * Camera → Text: real-time two-hand ISL recognition.
 *
 * Tracks both hands with MediaPipe's on-device HandLandmarker, buffers a
 * short rolling window of normalised landmarks, and matches it against the
 * template library extracted from the real 151-clip ISL asset set (see
 * isl-templates.ts / scripts/README.md). A match only "types" once it's been
 * the stable best answer for a couple of consecutive checks — this,
 * combined with the confidence-margin check in isl-recognizer.ts, is what
 * keeps false positives down.
 *
 * When a hand shape is held deliberately but never resolves to a confident
 * match, it's reported as unrecognised — never guessed — and logged
 * (anonymously, no image/video) so admins can see recognition-gap demand on
 * the dashboard.
 *
 * Everything runs on-device; no frame is ever uploaded anywhere.
 */

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const KEYFRAMES = 10;
const BUFFER_WINDOW_MS = 2200;
const BUFFER_MAX_SAMPLES = 90;
const RECOGNITION_INTERVAL_MS = 130;
const STABLE_PASSES_REQUIRED = 2;
const EMIT_COOLDOWN_MS = 900;
const IDLE_RESET_MS = 650;
const IDLE_SPACE_MS = 1400;
const UNKNOWN_AFTER_MS = 950;
const UNKNOWN_MIN_USEFUL_FRAMES = 6;
const MIN_USEFUL_FOR_RESAMPLE = 4;

export interface CameraToTextState {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  active: boolean;
  loading: boolean;
  error: string | null;
  isSupported: boolean;
  handsPresent: boolean;
  currentGesture: string | null; // human status caption
  recognized: boolean; // false = actively unmatched (not neutral/idle)
  showUnknownNotice: boolean;
  text: string;
  fps: number;
  start: () => void;
  stop: () => void;
  clearText: () => void;
  dismissUnknownNotice: () => void;
}

type Landmark = { x: number; y: number; z: number };
interface HandLandmarkerLike {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => {
    landmarks?: Landmark[][];
    handedness?: { categoryName: string }[][];
  };
}

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

function drawHand(
  ctx: CanvasRenderingContext2D,
  landmarks: Point3[],
  w: number,
  h: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = landmarks[a]!;
    const pb = landmarks[b]!;
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function useCameraToText(): CameraToTextState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<HandLandmarkerLike | null>(null);
  const libraryRef = useRef<TemplateLibrary | null>(null);
  const rafRef = useRef<number | null>(null);
  const vfcHandleRef = useRef<number | null>(null);

  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [handsPresent, setHandsPresent] = useState(false);
  const [currentGesture, setCurrentGesture] = useState<string | null>(null);
  const [recognized, setRecognized] = useState(true);
  const [showUnknownNotice, setShowUnknownNotice] = useState(false);
  const [text, setText] = useState("");
  const [fps, setFps] = useState(0);

  // --- refs for the hot loop (avoid re-render-per-frame) ---
  const bufferRef = useRef<FrameSample[]>([]);
  const lastHandAtRef = useRef(0);
  const attemptActiveRef = useRef(false);
  const attemptStartAtRef = useRef(0);
  const unknownReportedRef = useRef(false);
  const stableWordRef = useRef<string | null>(null);
  const stableCountRef = useRef(0);
  const lastEmitWordRef = useRef<string | null>(null);
  const lastEmitAtRef = useRef(0);
  const lastRecognitionAtRef = useRef(0);
  const spacedRef = useRef(true);
  const fpsSamplesRef = useRef<number[]>([]);
  // mirrors of state for the hot loop, to avoid stale closures without
  // re-subscribing the loop to React state
  const handsPresentRef = useRef(false);
  const currentGestureRef = useRef<string | null>(null);
  const recognizedRef = useRef(true);

  useEffect(() => {
    setIsSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  const resetAttempt = useCallback(() => {
    bufferRef.current = [];
    attemptActiveRef.current = false;
    unknownReportedRef.current = false;
    stableWordRef.current = null;
    stableCountRef.current = 0;
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const video = videoRef.current as
      | (HTMLVideoElement & {
          cancelVideoFrameCallback?: (handle: number) => void;
        })
      | null;
    if (vfcHandleRef.current !== null && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(vfcHandleRef.current);
    }
    vfcHandleRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    resetAttempt();
    setActive(false);
    setHandsPresent(false);
    handsPresentRef.current = false;
    setCurrentGesture(null);
    currentGestureRef.current = null;
    setRecognized(true);
    recognizedRef.current = true;
    setFps(0);
  }, [resetAttempt]);

  const clearText = useCallback(() => setText(""), []);
  const dismissUnknownNotice = useCallback(
    () => setShowUnknownNotice(false),
    [],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera isn't supported in this browser.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const [{ HandLandmarker, FilesetResolver }, stream, library] =
        await Promise.all([
          import("@mediapipe/tasks-vision"),
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: 640, height: 480 },
            audio: false,
          }),
          loadTemplateLibrary(),
        ]);

      libraryRef.current = library;
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarkerRef.current = (await HandLandmarker.createFromOptions(
          vision,
          {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          },
        )) as unknown as HandLandmarkerLike;
      }

      resetAttempt();
      lastHandAtRef.current = performance.now();
      spacedRef.current = true;
      setActive(true);
      setLoading(false);

      const tick = (now: number) => {
        const video = videoRef.current;
        const landmarker = landmarkerRef.current;
        const lib = libraryRef.current;

        if (video && landmarker && lib && video.readyState >= 2) {
          // FPS tracking
          const samples = fpsSamplesRef.current;
          samples.push(now);
          while (samples.length && now - samples[0]! > 1000) samples.shift();
          if (samples.length > 1) {
            setFps(
              Math.round(((samples.length - 1) * 1000) / (now - samples[0]!)),
            );
          }

          const result = landmarker.detectForVideo(video, now);
          let left: Landmark[] | null = null;
          let right: Landmark[] | null = null;
          if (result.landmarks && result.handedness) {
            for (let i = 0; i < result.landmarks.length; i++) {
              const label = result.handedness[i]?.[0]?.categoryName;
              if (label === "Left") left = result.landmarks[i]!;
              else if (label === "Right") right = result.landmarks[i]!;
            }
          }
          const anyHand = !!left || !!right;

          // Draw overlay (imperative canvas — not React state — so it can
          // update every frame without triggering re-renders)
          const canvas = overlayCanvasRef.current;
          if (canvas && video.videoWidth) {
            if (canvas.width !== video.videoWidth)
              canvas.width = video.videoWidth;
            if (canvas.height !== video.videoHeight)
              canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              if (left)
                drawHand(ctx, left, canvas.width, canvas.height, "#5eead4");
              if (right)
                drawHand(ctx, right, canvas.width, canvas.height, "#f472b6");
            }
          }

          if (!anyHand) {
            if (now - lastHandAtRef.current > IDLE_RESET_MS) {
              const usefulCount = bufferRef.current.filter(
                (f) => f.hasLeft || f.hasRight,
              ).length;
              if (
                attemptActiveRef.current &&
                !unknownReportedRef.current &&
                usefulCount >= UNKNOWN_MIN_USEFUL_FRAMES
              ) {
                unknownReportedRef.current = true;
                logUnmatchedGesture();
                setShowUnknownNotice(true);
              }
              resetAttempt();
              if (handsPresentRef.current) {
                handsPresentRef.current = false;
                setHandsPresent(false);
              }
              if (currentGestureRef.current !== null) {
                currentGestureRef.current = null;
                setCurrentGesture(null);
              }
              if (!recognizedRef.current) {
                recognizedRef.current = true;
                setRecognized(true);
              }
              if (
                !spacedRef.current &&
                now - lastHandAtRef.current > IDLE_SPACE_MS
              ) {
                spacedRef.current = true;
                setText((prev) =>
                  prev.endsWith(" ") || !prev ? prev : `${prev} `,
                );
              }
            }
          } else {
            lastHandAtRef.current = now;
            spacedRef.current = false;
            if (!handsPresentRef.current) {
              handsPresentRef.current = true;
              setHandsPresent(true);
            }
            if (!attemptActiveRef.current) {
              attemptActiveRef.current = true;
              attemptStartAtRef.current = now;
              unknownReportedRef.current = false;
              stableWordRef.current = null;
              stableCountRef.current = 0;
            }

            const sample = buildFrameSample(
              left as Point3[] | null,
              right as Point3[] | null,
              now,
            );
            const buf = bufferRef.current;
            buf.push(sample);
            while (buf.length && now - buf[0]!.t > BUFFER_WINDOW_MS)
              buf.shift();
            if (buf.length > BUFFER_MAX_SAMPLES) buf.shift();

            if (now - lastRecognitionAtRef.current >= RECOGNITION_INTERVAL_MS) {
              lastRecognitionAtRef.current = now;
              const resampled = resampleBuffer(
                buf,
                KEYFRAMES,
                MIN_USEFUL_FOR_RESAMPLE,
              );

              if (!resampled) {
                currentGestureRef.current = "Reading your hand…";
                setCurrentGesture("Reading your hand…");
                recognizedRef.current = true;
                setRecognized(true);
              } else {
                const match = findBestMatch(resampled, lib);
                const confident = !!match && isConfidentMatch(match);

                if (confident && match) {
                  if (stableWordRef.current === match.word) {
                    stableCountRef.current++;
                  } else {
                    stableWordRef.current = match.word;
                    stableCountRef.current = 1;
                  }
                  const label = labelForTemplateId(match.word);
                  currentGestureRef.current = `✓ ${label}`;
                  setCurrentGesture(`✓ ${label}`);
                  recognizedRef.current = true;
                  setRecognized(true);

                  const inCooldown =
                    lastEmitWordRef.current === match.word &&
                    now - lastEmitAtRef.current < EMIT_COOLDOWN_MS;

                  if (
                    stableCountRef.current >= STABLE_PASSES_REQUIRED &&
                    !inCooldown
                  ) {
                    lastEmitWordRef.current = match.word;
                    lastEmitAtRef.current = now;
                    setText((prev) =>
                      prev && !prev.endsWith(" ")
                        ? `${prev} ${label}`
                        : `${prev}${label}`,
                    );
                    bufferRef.current = [];
                    stableWordRef.current = null;
                    stableCountRef.current = 0;
                    attemptStartAtRef.current = now;
                  }
                } else {
                  stableWordRef.current = null;
                  stableCountRef.current = 0;
                  const elapsed = now - attemptStartAtRef.current;
                  if (elapsed > 300) {
                    currentGestureRef.current = "Sign not recognised yet…";
                    setCurrentGesture("Sign not recognised yet…");
                    recognizedRef.current = false;
                    setRecognized(false);
                  } else {
                    currentGestureRef.current = "Reading your hand…";
                    setCurrentGesture("Reading your hand…");
                    recognizedRef.current = true;
                    setRecognized(true);
                  }

                  const usefulCount = buf.filter(
                    (f) => f.hasLeft || f.hasRight,
                  ).length;
                  if (
                    !unknownReportedRef.current &&
                    elapsed >= UNKNOWN_AFTER_MS &&
                    usefulCount >= UNKNOWN_MIN_USEFUL_FRAMES
                  ) {
                    unknownReportedRef.current = true;
                    logUnmatchedGesture(match?.word);
                    setShowUnknownNotice(true);
                  }
                }
              }
            }
          }
        }

        const v = videoRef.current as
          | (HTMLVideoElement & {
              requestVideoFrameCallback?: (cb: (now: number) => void) => number;
            })
          | null;
        if (v?.requestVideoFrameCallback) {
          vfcHandleRef.current = v.requestVideoFrameCallback(() =>
            tick(performance.now()),
          );
        } else {
          rafRef.current = requestAnimationFrame(tick);
        }
      };

      const v0 = videoRef.current as
        | (HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: (now: number) => void) => number;
          })
        | null;
      if (v0?.requestVideoFrameCallback) {
        vfcHandleRef.current = v0.requestVideoFrameCallback(() =>
          tick(performance.now()),
        );
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    } catch (err) {
      setLoading(false);
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera access was denied. Allow camera permission and try again."
          : "Couldn't start camera-to-text recognition on this device.";
      setError(message);
      stop();
    }
  }, [stop, resetAttempt]);

  useEffect(() => stop, [stop]);

  return {
    videoRef,
    overlayCanvasRef,
    active,
    loading,
    error,
    isSupported,
    handsPresent,
    currentGesture,
    recognized,
    showUnknownNotice,
    text,
    fps,
    start,
    stop,
    clearText,
    dismissUnknownNotice,
  };
}
