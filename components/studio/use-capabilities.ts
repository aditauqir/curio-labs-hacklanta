"use client";

import { useEffect, useState } from "react";

export type Capabilities = {
  loaded: boolean;
  /** True when the server has a Gemini key, so the director uses the real model. */
  gemini: boolean;
  /** True when the server has a speech-to-text provider, so the microphone can work. */
  listen: boolean;
  /** Which provider will transcribe speech first. */
  transcriber: "whisper" | "elevenlabs" | null;
  /** True when the server can speak replies aloud (ElevenLabs). */
  speak: boolean;
};

const OFF: Capabilities = {
  loaded: true,
  gemini: false,
  listen: false,
  transcriber: null,
  speak: false,
};

/** Asks the server which integrations are configured. It never receives key values. */
export function useCapabilities(): Capabilities {
  const [capabilities, setCapabilities] = useState<Capabilities>({ ...OFF, loaded: false });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/status", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("status"))))
      .then(
        (json: {
          director?: { provider?: string };
          voice?: { listen?: boolean; transcriber?: string | null; speak?: boolean };
        }) => {
          const transcriber = json.voice?.transcriber;
          setCapabilities({
            loaded: true,
            gemini: json.director?.provider === "gemini",
            listen: json.voice?.listen === true,
            transcriber: transcriber === "whisper" || transcriber === "elevenlabs" ? transcriber : null,
            speak: json.voice?.speak === true,
          });
        },
      )
      .catch(() => {
        if (!controller.signal.aborted) setCapabilities(OFF);
      });

    return () => controller.abort();
  }, []);

  return capabilities;
}
