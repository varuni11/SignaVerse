import { useState } from "react";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  RotateCcw,
  Sparkles,
  Activity,
  Hand,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCameraToText } from "./useCameraToText";
import { getCurrentUser } from "@/lib/auth-store";
import { submitSignRequest } from "@/lib/library-request-store";

export function CameraToTextPanel() {
  const cam = useCameraToText();
  const [labelInput, setLabelInput] = useState("");
  const [labelSent, setLabelSent] = useState(false);

  if (!cam.isSupported) {
    return (
      <div className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground shadow-elevate">
        Camera access isn't supported in this browser.
      </div>
    );
  }

  const submitLabel = (e: React.FormEvent) => {
    e.preventDefault();
    const word = labelInput.trim();
    if (!word) return;
    const user = getCurrentUser();
    submitSignRequest(word, user?.email ?? "camera-to-text (anonymous)");
    setLabelSent(true);
    setLabelInput("");
    window.setTimeout(() => {
      setLabelSent(false);
      cam.dismissUnknownNotice();
    }, 1400);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="relative overflow-hidden rounded-3xl border bg-ink shadow-glow">
        <div className="relative aspect-[4/3] w-full [transform:scaleX(-1)]">
          <video
            ref={cam.videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 size-full object-cover"
          />
          <canvas
            ref={cam.overlayCanvasRef}
            className="pointer-events-none absolute inset-0 size-full object-cover"
          />
        </div>

        {!cam.active ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/80 p-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-hero text-primary-foreground shadow-elevate">
              <Camera className="size-6" />
            </span>
            <p className="text-sm text-primary-foreground/90">
              Show a clear ISL sign to the camera with one or both hands and
              hold it steady for a moment — words, letters and digits are all
              recognised.
            </p>
            <Button variant="hero" onClick={cam.start} disabled={cam.loading}>
              {cam.loading ? "Starting…" : "Start camera"}
            </Button>
          </div>
        ) : (
          <>
            <button
              onClick={cam.stop}
              className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur"
            >
              <CameraOff className="size-3.5" /> Stop
            </button>

            <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
              <span className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
                <Activity className="size-3" /> {cam.fps || "–"} FPS
              </span>
              <span
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur ${
                  cam.handsPresent
                    ? "bg-teal/80 text-teal-foreground"
                    : "bg-black/60 text-white/70"
                }`}
              >
                <Hand className="size-3" />
                {cam.handsPresent ? "Hands tracked" : "No hands"}
              </span>
            </div>

            <div className="absolute bottom-3 left-3 right-3 z-10 rounded-2xl bg-black/60 px-3 py-2 text-xs text-white backdrop-blur">
              {cam.currentGesture ? (
                <span
                  className={cam.recognized ? "text-teal" : "text-amber-300"}
                >
                  {cam.currentGesture}
                </span>
              ) : (
                <span className="text-white/70">Show a sign…</span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="rounded-3xl border bg-card p-6 shadow-elevate">
        <h3 className="text-lg font-semibold">Camera → Text</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Live ISL recognition, matched against the real 151-sign clip library —
          words, the A–Z alphabet and 0–9. Runs fully on-device; nothing is ever
          uploaded.
        </p>

        <div className="mt-4 min-h-24 rounded-2xl border bg-background p-4 text-lg font-medium tracking-wide">
          {cam.text || (
            <span className="text-sm font-normal text-muted-foreground">
              Recognised signs will build up here…
            </span>
          )}
        </div>

        {cam.showUnknownNotice ? (
          <div className="mt-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              That sign isn't in our ISL library yet. We've automatically logged
              it for the team — optionally tell us what word it was meant to be,
              so it gets added faster.
            </p>
            {labelSent ? (
              <p className="mt-2 font-medium text-teal-foreground">
                Thanks — added to the request queue.
              </p>
            ) : (
              <form
                className="mt-2 flex items-center gap-2"
                onSubmit={submitLabel}
              >
                <Input
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder="e.g. hospital"
                  className="h-8 bg-white text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  className="h-8 shrink-0 px-2.5"
                  disabled={!labelInput.trim()}
                >
                  <Send className="size-3.5" />
                </Button>
                <button
                  type="button"
                  onClick={cam.dismissUnknownNotice}
                  className="shrink-0 text-[11px] text-amber-900/70 underline underline-offset-2"
                >
                  Skip
                </button>
              </form>
            )}
          </div>
        ) : null}

        {cam.error ? (
          <p className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {cam.error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!cam.text}
            onClick={cam.clearText}
          >
            <RotateCcw className="size-4" /> Clear
          </Button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-accent-foreground">
            <Sparkles className="size-3 text-primary" /> On-device, two-hand
            recognition
          </span>
        </div>
      </div>
    </div>
  );
}
