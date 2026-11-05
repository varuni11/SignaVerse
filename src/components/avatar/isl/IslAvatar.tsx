import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import avatarModelUrl from "@/assets/isl-human.glb?url";
import {
  buildTimeline, loadMotionLibrary, samplePose,
  type MotionLibrary, type SignStep, type Timeline,
} from "./motion";
import type { SentenceType } from "./english-to-isl";

/** The ONE avatar used by the whole site. */
const MODEL_URL = avatarModelUrl;

interface Shared {
  lib: MotionLibrary;
  timeline: Timeline;
  playing: boolean;
  speed: number;
  nonManual: SentenceType;
  resetToken: number;
  onStep: (i: number) => void;
  onEnd: () => void;
}

function Rig({ shared }: { shared: React.MutableRefObject<Shared> }) {
  const { scene } = useGLTF(MODEL_URL);
  const root = useMemo(() => cloneSkeleton(scene), [scene]);
  const bones = useRef<(THREE.Object3D | undefined)[]>([]);
  const headBone = useRef<THREE.Object3D | null>(null);
  const spine = useRef<THREE.Object3D | null>(null);
  const pose = useRef<Float32Array>(new Float32Array(0));
  const clock = useRef({ t: 0, step: -2, ended: false, reset: -1 });
  const [fit, setFit] = useState({ scale: 1, y: -1.38 });
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const nod = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);

  useEffect(() => {
    const by: Record<string, THREE.Object3D> = {};
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) by[o.name] = o;
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
    });
    const lib = shared.current.lib;
    bones.current = lib.bones.map((n) => by[n]);
    const missing = lib.bones.filter((n) => !by[n]);
    if (missing.length) console.warn("[ISL] bones missing in GLB:", missing.join(", "));
    headBone.current = by["Head"] ?? null;
    spine.current = by["Spine2"] ?? null;
    pose.current = new Float32Array(lib.bones.length * 4);
    root.updateWorldMatrix(true, true);
    const head = by["Head"];
    const headY = head ? root.worldToLocal(head.getWorldPosition(new THREE.Vector3())).y : 1.64;
    setFit({ scale: 1.64 / Math.max(headY, 0.001), y: -1.38 });
  }, [root, shared]);

  useFrame((state, dt) => {
    const s = shared.current, c = clock.current, p = pose.current;
    if (!p.length) return;
    if (c.reset !== s.resetToken) { c.reset = s.resetToken; c.t = 0; c.step = -2; c.ended = false; }
    if (s.playing && !c.ended) c.t += Math.min(dt, 0.05) * s.speed;
    const step = samplePose(s.timeline, s.lib, c.t, p);
    if (step !== c.step) { c.step = step; s.onStep(step); }
    if (!c.ended && s.timeline.segments.length && c.t >= s.timeline.tailEnd) { c.ended = true; s.onEnd(); }
    const bs = bones.current;
    for (let i = 0; i < bs.length; i++) if (bs[i]) bs[i]!.quaternion.set(p[i * 4]!, p[i * 4 + 1]!, p[i * 4 + 2]!, p[i * 4 + 3]!);
    // non-manual marker for questions (head only — this avatar has no eyebrow control)
    if (headBone.current && s.nonManual !== "statement" && s.nonManual !== "imperative" && s.timeline.segments.length) {
      const k = THREE.MathUtils.smoothstep(c.t, s.timeline.total * 0.55, s.timeline.total) * (1 - THREE.MathUtils.smoothstep(c.t, s.timeline.total, s.timeline.tailEnd));
      euler.set(s.nonManual === "yes-no" ? -0.14 * k : 0.05 * k, 0, s.nonManual === "wh" ? 0.1 * k : 0);
      nod.setFromEuler(euler);
      headBone.current.quaternion.multiply(nod);
    }
    // subtle breathing so the avatar is not frozen between signs
    if (spine.current) {
      const a = Math.sin(state.clock.elapsedTime * 1.6) * 0.012;
      tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
      spine.current.quaternion.multiply(tmpQ);
    }
  });

  return <primitive object={root} scale={fit.scale} position={[0, fit.y, 0]} />;
}

export interface IslAvatarProps {
  steps: SignStep[];
  playing: boolean;
  speed: number;
  nonManual?: SentenceType | undefined;
  /** change to restart playback from the beginning */
  replayToken?: number;
  onStepChange?: ((i: number) => void) | undefined;
  onQueueEnd?: (() => void) | undefined;
}

export function IslAvatar({ steps, playing, speed, nonManual = "statement", replayToken = 0, onStepChange, onQueueEnd }: IslAvatarProps) {
  const [lib, setLib] = useState<MotionLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadMotionLibrary(`${import.meta.env.BASE_URL}isl-motion/`).then(setLib).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const timeline = useMemo(() => (lib ? buildTimeline(steps, lib) : null), [lib, steps]);
  const shared = useRef<Shared | null>(null);
  const [resetToken, setResetToken] = useState(0);
  useEffect(() => { setResetToken((n) => n + 1); }, [steps, replayToken]);
  const [stepIdx, setStepIdx] = useState(-1);

  if (lib && timeline) {
    shared.current = {
      lib, timeline, playing, speed, nonManual, resetToken,
      onStep: (i) => { setStepIdx(i); onStepChange?.(i); },
      onEnd: () => onQueueEnd?.(),
    };
  }
  const cur = stepIdx >= 0 ? steps[stepIdx] : null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} camera={{ position: [0, 0.3, 2.0], fov: 32 }}>
        <color attach="background" args={["#0b1220"]} />
        <fog attach="fog" args={["#0b1220", 3.2, 8]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[2.5, 3, 2.5]} intensity={2} castShadow />
        <directionalLight position={[-3, 1.5, -2]} intensity={1.1} color="#3ec9c0" />
        <pointLight position={[0, 0.6, 2]} intensity={5} distance={7} color="#7cc4ff" />
        <Suspense fallback={null}>
          {lib && timeline ? <Rig shared={shared as React.MutableRefObject<Shared>} /> : null}
          <Environment preset="city" />
        </Suspense>
      </Canvas>
      {!lib && !error ? (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">Loading ISL motion data…</span>
      ) : null}
      {error ? (
        <span className="absolute inset-x-4 top-4 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Could not load ISL motion data ({error}). Run the motion pipeline or check /isl-motion/.
        </span>
      ) : null}
      {cur ? (
        <>
          <span className="pointer-events-none absolute left-4 top-4 rounded-full glass-panel px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            {cur.kind === "sign" ? cur.caption : cur.kind === "digit" ? `digit ${cur.caption}` : "fingerspelling"}
          </span>
          {cur.kind !== "sign" ? (
            <span className="pointer-events-none absolute right-4 top-4 rounded-2xl glass-panel px-4 py-2 text-2xl font-semibold tracking-[0.2em] text-primary">{cur.caption}</span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

useGLTF.preload(MODEL_URL);
export default IslAvatar;
