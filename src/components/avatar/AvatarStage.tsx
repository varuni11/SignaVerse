import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Info,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { loadMotionLibrary, type MotionLibrary } from "./isl/motion";
import {
  translateEnglishToISL,
  vocabularyFromKeys,
  type IslTranslation,
} from "./isl/english-to-isl";
import { useVoiceInput } from "./useVoiceInput";
import { useCameraInput } from "./useCameraInput";
import { useSpeechOutput } from "./useSpeechOutput";
import { recordSignedWords } from "@/lib/usage-tracker";
import { submitSignRequest } from "@/lib/library-request-store";
import { Button } from "@/components/ui/button";

/** The single 3D avatar (isl-human.glb). WebGL is browser-only so it loads after hydration. */
const IslAvatar = lazy(() => import("./isl/IslAvatar"));

const EXAMPLES = [
  "Hello",
  "Thank you",
  "How are you",
  "My name is Rahul",
  "I can not come",
  "Where is the college",
];

/**
 * AvatarStage owns playback state and the demo UI.
 *
 * Text and English speech input go through ONE pipeline:
 *   English → normalise/tag → ISL gloss (rule based) → motion clips → the one
 *   3D avatar (isl-human.glb). There is no video player and no second avatar.
 */
export function AvatarStage({
  compact = false,
  requesterEmail,
}: {
  compact?: boolean;
  /** When set, unknown-word "Request this sign" notifies the admin dashboard as this user. */
  requesterEmail?: string;
}) {
  const [lib, setLib] = useState<MotionLibrary | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [result, setResult] = useState<IslTranslation | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [replayToken, setReplayToken] = useState(0);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState("");
  const pending = useRef<string | null>(null);

  const speech = useSpeechOutput();
  const camera = useCameraInput();

  useEffect(() => {
    loadMotionLibrary(`${import.meta.env.BASE_URL}isl-motion/`)
      .then(setLib)
      .catch((e) => setLibError(String(e?.message ?? e)));
  }, []);

  const vocab = useMemo(
    () =>
      lib
        ? vocabularyFromKeys(
            Object.keys(lib.clips),
            new Set(Object.values(lib.clips).filter((c) => c.confidence === "low").map((c) => c.key)),
          )
        : null,
    [lib],
  );
  const wordKeys = useMemo(() => (vocab ? [...vocab.words].sort() : []), [vocab]);

  const run = useCallback(
    (input: string, v: NonNullable<typeof vocab>) => {
      const translation = translateEnglishToISL(input, v);
      setResult(translation);
      setStepIndex(-1);
      setReplayToken((n) => n + 1);
      setPlaying(true);
      return translation;
    },
    [],
  );

  const translate = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      if (!vocab) {
        pending.current = trimmed;
        return;
      }
      run(trimmed, vocab);
      // Speak the sentence back out loud while the avatar signs it (toggleable below).
      speech.speak(trimmed);
      // Track the signed words for the profile page's live tracking and history.
      recordSignedWords(trimmed.split(/\s+/).filter(Boolean));
    },
    [vocab, run, speech],
  );

  useEffect(() => {
    if (vocab && pending.current) {
      const p = pending.current;
      pending.current = null;
      translate(p);
    }
  }, [vocab, translate]);

  const activeToken = stepIndex >= 0 ? (result?.steps[stepIndex]?.token ?? -1) : -1;

  const voice = useVoiceInput(
    useCallback(
      (finalText: string) => {
        setText((prev) => (prev ? `${prev} ${finalText}` : finalText));
        translate(finalText);
      },
      [translate],
    ),
  );

  const suggestions = useMemo(
    () => wordKeys.slice(0, compact ? 8 : wordKeys.length),
    [wordKeys, compact],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
      <div className="relative overflow-hidden rounded-3xl border bg-soft p-4 shadow-glow">
        <div className="absolute inset-0 grid-bg opacity-50" />
        <div className="relative flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inset-0 rounded-full bg-teal"
                style={{ animation: "pulse-ring 1.8s ease-out infinite" }}
              />
              <span className="relative h-2 w-2 rounded-full bg-teal" />
            </span>
            ISL signer · live
          </span>

          <span className="rounded-full border bg-card/70 px-3 py-1 text-[11px] text-muted-foreground">
            3D avatar · English → ISL
          </span>
        </div>

        <div className="relative h-[420px] rounded-2xl">
          <ClientOnly
            fallback={
              <div className="grid h-full place-items-center rounded-2xl bg-[#0b1220] text-sm text-muted-foreground">
                Loading avatar…
              </div>
            }
          >
            <Suspense
              fallback={
                <div className="grid h-full place-items-center rounded-2xl bg-[#0b1220] text-sm text-muted-foreground">
                  Loading avatar…
                </div>
              }
            >
              <IslAvatar
                steps={result?.steps ?? []}
                playing={playing}
                speed={speed}
                nonManual={result?.nonManual}
                replayToken={replayToken}
                onStepChange={setStepIndex}
              />
            </Suspense>
          </ClientOnly>

          {camera.active ? (
            <div className="absolute bottom-3 right-3 z-10 w-32 overflow-hidden rounded-xl border-2 border-primary/60 bg-black shadow-elevate sm:w-40">
              <video
                ref={camera.videoRef}
                autoPlay
                playsInline
                muted
                className="aspect-[3/4] w-full object-cover [transform:scaleX(-1)]"
              />
              <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                <span className="size-1.5 rounded-full bg-red-500" />
                You
              </span>
            </div>
          ) : null}
        </div>

        <div className="relative mt-2 flex flex-wrap items-center gap-2 rounded-2xl bg-card/70 p-2 backdrop-blur">
          <Button
            size="sm"
            variant="hero"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setReplayToken((n) => n + 1);
              setPlaying(true);
            }}
          >
            <RotateCcw className="size-4" /> Replay
          </Button>

          {voice.isSupported ? (
            <Button
              size="sm"
              variant={voice.listening ? "hero" : "ghost"}
              onClick={voice.toggle}
              title="Voice to sign"
            >
              {voice.listening ? (
                <Mic className="size-4 animate-pulse" />
              ) : (
                <MicOff className="size-4" />
              )}
              {voice.listening ? "Listening…" : "Speak"}
            </Button>
          ) : null}

          {camera.isSupported ? (
            <Button
              size="sm"
              variant={camera.active ? "hero" : "ghost"}
              onClick={camera.toggle}
              title="Camera preview"
            >
              {camera.active ? (
                <Camera className="size-4" />
              ) : (
                <CameraOff className="size-4" />
              )}
              {camera.active ? "Camera on" : "Camera"}
            </Button>
          ) : null}

          {speech.isSupported ? (
            <Button
              size="sm"
              variant={speech.enabled ? "hero" : "ghost"}
              onClick={speech.toggleEnabled}
              title="Avatar speaking"
            >
              {speech.enabled ? (
                <Volume2
                  className={`size-4 ${speech.speaking ? "animate-pulse" : ""}`}
                />
              ) : (
                <VolumeX className="size-4" />
              )}
              {speech.enabled ? "Avatar speaks" : "Muted"}
            </Button>
          ) : null}

          <div className="ml-auto flex items-center gap-1 pr-1 text-xs text-muted-foreground">
            speed
            {[0.5, 1, 1.5].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded-full px-2.5 py-1 transition-colors ${
                  speed === s
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {voice.interim ? (
          <p className="relative mt-2 truncate rounded-xl bg-card/60 px-3 py-1.5 text-xs italic text-muted-foreground">
            “{voice.interim}”
          </p>
        ) : null}

        {camera.error ? (
          <p className="relative mt-2 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {camera.error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-5">
        <div className="rounded-3xl border bg-card p-5 shadow-elevate">
          <h3 className="text-lg font-semibold">
            Speak or type, watch it signed
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your sentence is translated into ISL sign order — function words
            are dropped, question words move to the end — and one 3D avatar
            signs it using motion captured from real ISL clips. Words with no
            sign are fingerspelled, never guessed.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && translate(text)}
              placeholder="e.g. Where is the college?"
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/40"
            />
            <Button variant="hero" onClick={() => translate(text)}>
              <Sparkles className="size-4" /> Sign it
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setText(ex);
                  translate(ex);
                }}
                className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>

          {libError ? (
            <p className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              ISL motion data failed to load ({libError}).
            </p>
          ) : null}

          {result ? (
            <div className="mt-4 space-y-3">
              {result.tokens.length ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    ISL gloss
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {result.tokens.map((t, i) => (
                      <span
                        key={`${t.gloss}-${i}`}
                        title={
                          t.note ??
                          (t.kind === "spell"
                            ? "fingerspelled"
                            : t.lowConfidence
                              ? "handshape tracking for this sign is low-confidence"
                              : undefined)
                        }
                        className={`rounded-full px-2.5 py-1 ${
                          i === activeToken
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        } ${t.approx ? "border border-dashed border-amber-500" : ""} ${
                          t.kind === "spell" ? "font-mono" : ""
                        }`}
                      >
                        {t.gloss}
                        {t.approx ? " ~" : ""}
                        {t.lowConfidence ? " ⚠" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Nothing to sign yet — try a sentence with at least one
                  English word.
                </p>
              )}

              {result.fingerspelled.length ? (
                <div className="rounded-2xl border border-primary/25 bg-accent/40 p-3">
                  <p className="flex items-start gap-2 text-xs text-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <span>
                      <b>{result.fingerspelled.join(", ")}</b>{" "}
                      {result.fingerspelled.length === 1 ? "has" : "have"} no
                      sign in the ISL library yet — fingerspelled
                      letter-by-letter instead of guessed.
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {result.fingerspelled.map((w) => (
                      <button
                        key={w}
                        onClick={() => {
                          submitSignRequest(w, requesterEmail ?? "anonymous");
                          setRequested((prev) => new Set(prev).add(w));
                        }}
                        disabled={requested.has(w)}
                        className="rounded-full border border-primary/40 bg-card px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-default disabled:border-teal/40 disabled:bg-teal/10 disabled:text-teal-foreground disabled:hover:bg-teal/10 disabled:hover:text-teal-foreground"
                      >
                        {requested.has(w)
                          ? `✓ "${w}" requested`
                          : `Request "${w}"`}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {result.approximations.length ? (
                <p className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Approximate (dashed): {" "}
                    {result.approximations
                      .map((a) => `${a.word} → ${a.used}`)
                      .join(", ")}
                    . These are the closest signs in the library, not exact
                    equivalents.
                  </span>
                </p>
              ) : null}

              {result.unsupported.length ? (
                <p className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Could not sign: <b>{result.unsupported.join(", ")}</b>.
                  </span>
                </p>
              ) : null}

              <details className="rounded-2xl border bg-background/60 p-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground">
                  How this was translated
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {result.sentences.map((s, i) => (
                    <li key={i}>
                      <b>{s.type}</b>: “{s.text}” → {s.gloss.join(" ") || "—"}
                    </li>
                  ))}
                  {result.dropped.length ? (
                    <li>
                      Dropped (no sign in ISL grammar):{" "}
                      {result.dropped.map((d) => d.word).join(", ")}
                    </li>
                  ) : null}
                  {result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                  <li>
                    Order rules are a simplified, rule-based approximation of
                    ISL and have not been reviewed by a fluent signer. Facial
                    grammar (eyebrows, mouth) is not shown by this avatar.
                  </li>
                </ul>
              </details>
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl border bg-card p-5 shadow-elevate">
          <h3 className="text-lg font-semibold">ISL sign library</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((k) => (
              <button
                key={k}
                onClick={() => {
                  setText(k.replace(/-/g, " "));
                  translate(k.replace(/-/g, " "));
                }}
                className="rounded-full border bg-background px-3.5 py-1.5 text-sm transition-all hover:-translate-y-0.5 hover:border-primary/50"
              >
                {k.replace(/-/g, " ")}
              </button>
            ))}
            {!lib && !libError ? (
              <span className="text-xs text-muted-foreground">Loading…</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
