import { useCallback, useState } from "react";
import { Copy, Mic, MicOff, RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceInput } from "./useVoiceInput";

/** Pure speech-to-text transcription — no avatar involved, just live captions. */
export function VoiceToTextPanel() {
  const [transcript, setTranscript] = useState("");
  const [copied, setCopied] = useState(false);

  const onFinal = useCallback((finalText: string) => {
    setTranscript((prev) => (prev ? `${prev} ${finalText}` : finalText));
  }, []);

  const voice = useVoiceInput(onFinal);

  if (!voice.isSupported) {
    return (
      <div className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground shadow-elevate">
        Voice-to-text isn't supported in this browser. Try Chrome or Edge on
        desktop or Android.
      </div>
    );
  }

  return (
    <div className="rounded-3xl border bg-card p-6 shadow-elevate">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Voice → Text</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Speak naturally — your words are transcribed live, entirely in your
            browser.
          </p>
        </div>
        <Button
          variant={voice.listening ? "hero" : "outline"}
          onClick={voice.toggle}
        >
          {voice.listening ? (
            <Mic className="size-4 animate-pulse" />
          ) : (
            <MicOff className="size-4" />
          )}
          {voice.listening ? "Listening…" : "Start speaking"}
        </Button>
      </div>

      <div className="mt-4 min-h-32 rounded-2xl border bg-background p-4 text-sm leading-relaxed">
        {transcript ? (
          <span>{transcript}</span>
        ) : (
          <span className="text-muted-foreground">
            Your transcript will appear here…
          </span>
        )}
        {voice.interim ? (
          <span className="text-muted-foreground italic"> {voice.interim}</span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!transcript}
          onClick={() => {
            void navigator.clipboard.writeText(transcript);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy text"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!transcript}
          onClick={() => setTranscript("")}
        >
          <RotateCcw className="size-4" /> Clear
        </Button>
      </div>
    </div>
  );
}
