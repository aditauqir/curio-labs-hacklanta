"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recordingToWav } from "@/lib/audio-capture";

export type VoicePhase = "idle" | "listening" | "transcribing" | "speaking";

/** Why the microphone cannot be used right now, or null when it can. */
export type MicBlock = "not-configured" | "insecure" | "unsupported" | null;

const MAX_RECORD_SECONDS = 30;
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function micErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow it in your browser's site settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found on this device.";
  }
  if (name === "NotReadableError") {
    return "The microphone is in use by another app.";
  }
  if (name === "NotSupportedError") {
    return "This browser or device cannot use a microphone here.";
  }
  return "Could not start the microphone.";
}

export function useVoice({
  canListen,
  canSpeak,
  onTranscript,
}: {
  /** Whether the server has a speech-to-text provider. */
  canListen: boolean;
  /** Whether the server can speak replies aloud. */
  canSpeak: boolean;
  onTranscript: (text: string, provider: string | null) => void;
}) {
  const [phase, setPhaseState] = useState<VoicePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const phaseRef = useRef<VoicePhase>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const unmountedRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  const setPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  // Browsers only expose the microphone on HTTPS or localhost. Reporting the
  // real reason avoids a mic button that silently does nothing on plain HTTP.
  let block: MicBlock = null;
  if (!canListen) block = "not-configured";
  else if (typeof window !== "undefined") {
    if (!window.isSecureContext) block = "insecure";
    else if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      block = "unsupported";
    }
  }

  const releaseMic = useCallback(() => {
    window.clearInterval(timerRef.current);
    timerRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    speakAbortRef.current?.abort();
    speakAbortRef.current = null;
    releaseAudio();
    if (phaseRef.current === "speaking") setPhase("idle");
  }, [releaseAudio, setPhase]);

  const upload = useCallback(
    async (recording: Blob, type: string) => {
      if (recording.size < 800) {
        setPhase("idle");
        setError("I didn't catch any audio. Try again.");
        return;
      }

      setPhase("transcribing");
      try {
        // Whisper needs 16 kHz mono WAV, and converting here keeps the server
        // from having to decode untrusted media. If the browser cannot decode its
        // own recording, send it as-is and let the server's backup handle it.
        let body: Blob = recording;
        let filename = `speech.${extensionFor(type)}`;
        try {
          const converted = await recordingToWav(recording);
          if (converted.silent) {
            setPhase("idle");
            setError("I didn't hear anything. Check your microphone and try again.");
            return;
          }
          body = converted.wav;
          filename = "speech.wav";
        } catch {
          // fall through with the original recording
        }

        const form = new FormData();
        form.append("audio", body, filename);
        const response = await fetch("/api/voice/transcribe", { method: "POST", body: form });

        if (response.status === 429) {
          setPhase("idle");
          setError("Too many voice requests. Wait a moment and try again.");
          return;
        }
        if (!response.ok) throw new Error("transcribe failed");

        const json = (await response.json()) as { text?: unknown; provider?: unknown };
        const text = typeof json.text === "string" ? json.text.trim() : "";
        const provider = typeof json.provider === "string" ? json.provider : null;
        setPhase("idle");

        if (!text) {
          setError("I didn't catch that. Try speaking closer to the microphone.");
          return;
        }
        if (!unmountedRef.current) onTranscriptRef.current(text, provider);
      } catch {
        setPhase("idle");
        setError("Transcription failed. You can still type your request.");
      }
    },
    [setPhase],
  );

  const start = useCallback(async () => {
    if (block !== null) return;
    if (phaseRef.current === "listening" || phaseRef.current === "transcribing") return;

    stopPlayback(); // never record the assistant's own voice
    setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (failure) {
      setError(micErrorMessage(failure));
      return;
    }

    if (unmountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setError("This browser could not start recording.");
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMic();
      recorderRef.current = null;
      if (unmountedRef.current) return;
      const type = recorder.mimeType || mimeType || "audio/webm";
      void upload(new Blob(chunks, { type }), type);
    };

    recorderRef.current = recorder;
    streamRef.current = stream;
    recorder.start();
    setSeconds(0);
    setPhase("listening");

    let elapsed = 0;
    timerRef.current = window.setInterval(() => {
      elapsed += 1;
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORD_SECONDS && recorder.state === "recording") recorder.stop();
    }, 1000);
  }, [block, releaseMic, setPhase, stopPlayback, upload]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (phaseRef.current === "listening" && recorder && recorder.state === "recording") {
      window.clearInterval(timerRef.current);
      recorder.stop();
    }
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!canSpeak) return;
      if (phaseRef.current === "listening" || phaseRef.current === "transcribing") return;

      stopPlayback();
      const controller = new AbortController();
      speakAbortRef.current = controller;
      setError(null);
      setPhase("speaking");

      try {
        const response = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("speak failed");

        const blob = await response.blob();
        if (controller.signal.aborted) return;

        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;

        const finish = () => {
          if (audioRef.current !== audio) return;
          releaseAudio();
          setPhase("idle");
        };
        audio.onended = finish;
        audio.onerror = () => {
          finish();
          setError("Couldn't play the spoken reply. The text reply is still shown.");
        };

        await audio.play();
      } catch (failure) {
        if (controller.signal.aborted) return;
        releaseAudio();
        setPhase("idle");
        setError(
          failure instanceof DOMException && failure.name === "NotAllowedError"
            ? "Your browser blocked audio playback. Click the page, then try again."
            : "Couldn't speak the reply. The text reply is still shown.",
        );
      }
    },
    [canSpeak, releaseAudio, setPhase, stopPlayback],
  );

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state === "recording") recorder.stop();
      releaseMic();
      speakAbortRef.current?.abort();
      releaseAudio();
    };
  }, [releaseAudio, releaseMic]);

  return {
    phase,
    error,
    seconds,
    block,
    /** Playback does not need a secure context, so replies can be spoken on plain HTTP. */
    canSpeak,
    start,
    stop,
    speak,
    stopSpeaking: stopPlayback,
    clearError: () => setError(null),
  };
}
