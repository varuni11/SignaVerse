import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Wraps the browser's built-in SpeechSynthesis so the avatar can speak the
 * sentence it is signing out loud, entirely client-side. This is additive
 * and independent of useVoiceInput.ts (speech-to-text) — this hook is
 * text-to-speech, the other direction.
 */
export function useSpeechOutput() {
  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    const supported =
      typeof window !== "undefined" && "speechSynthesis" in window;
    setIsSupported(supported);
    if (!supported) return;

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      voiceRef.current =
        voices.find((v) => v.lang === "en-IN") ??
        voices.find((v) => v.lang?.startsWith("en")) ??
        voices[0] ??
        null;
    };

    pickVoice();
    window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", pickVoice);
  }, []);

  const cancel = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!isSupported || !enabled) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(trimmed);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current?.lang ?? "en-IN";
      utterance.rate = 0.95;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [enabled, isSupported],
  );

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      if (prev) cancel();
      return !prev;
    });
  }, [cancel]);

  // Stop any speech when the component unmounts.
  useEffect(() => cancel, [cancel]);

  return { enabled, speaking, isSupported, speak, cancel, toggleEnabled };
}
