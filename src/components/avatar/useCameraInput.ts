import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Wraps getUserMedia for a simple on/off camera preview. Entirely
 * client-side — the video stream never leaves the browser. This does not
 * touch or replace the existing voice input (useVoiceInput.ts); it's an
 * additive, independent input source that can be toggled on top of it.
 */
export function useCameraInput() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  // Attach the stream to the <video> element whenever both are available.
  // The video element is only mounted once `active` is true, so we can't
  // rely on attaching it inline inside `start` — this effect re-runs after
  // that render and reliably wires them together.
  useEffect(() => {
    if (active && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [active]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera isn't supported in this browser.");
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera access was denied. Allow camera permission and try again."
          : "Couldn't access the camera on this device.";
      setError(message);
      setActive(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (active) stop();
    else void start();
  }, [active, start, stop]);

  // Always release the camera when the component unmounts.
  useEffect(() => stop, [stop]);

  return { videoRef, active, error, isSupported, start, stop, toggle };
}
