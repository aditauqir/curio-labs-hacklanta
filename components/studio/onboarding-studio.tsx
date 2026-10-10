"use client";

import { useState, type FormEvent } from "react";
import { VoiceBeam } from "voice-glow";
import { Card } from "@/components/ui/card";
import { MicIcon, SendIcon } from "./icons";
import { useCapabilities } from "./use-capabilities";
import { useVoice } from "./use-voice";
import { VoiceMascot } from "./voice-keyframes";

const STARTER_PROMPTS = [
  "A poster for a late-night jazz set",
  "A warm identity for my small business",
  "Something strange, loud, and editorial",
];

export type StartDestination = "chat" | "editor";

export function OnboardingStudio({
  onStart,
  projectName = "Midnight Jazz",
}: {
  onStart: (prompt?: string, destination?: StartDestination) => void;
  projectName?: string;
}) {
  const capabilities = useCapabilities();
  const [draft, setDraft] = useState("");
  const voice = useVoice({
    canListen: capabilities.listen,
    canSpeak: false,
    onTranscript: (text) => onStart(text, "chat"),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (prompt) onStart(prompt, "chat");
  }

  const listening = voice.phase === "listening";
  const processing = voice.phase === "transcribing";
  const micDisabled = voice.block !== null || voice.phase === "transcribing";
  const micLabel = listening ? "Stop recording and start" : "Start voice input";

  return (
    <main className="onboarding-shell onboarding-wireframe-shell" data-testid="onboarding-screen">
      <div className="onboarding-topbar">
        <div className="brand-lockup">
          <span className="brand-dot" />
          <span>CURIO LABS</span>
        </div>
        <span className="onboarding-kicker">START / 01</span>
      </div>

      <div className="onboarding-content onboarding-wireframe-content">
        <Card className="onboarding-wireframe-card" aria-labelledby="onboarding-title">
          <section className="onboarding-wireframe-hero">
            <div className="mascot-frame">
              <VoiceMascot />
            </div>
            <h1 id="onboarding-title">What are you thinking of?</h1>

            <form onSubmit={submit} className="onboarding-form">
              <VoiceBeam
                type="default"
                stream={voice.stream}
                active={listening || processing}
                motion={processing ? { gather: 0.82, stretch: 0.18, heldLevel: 0.35, cornerFollow: 0.2 } : null}
                theme="light"
                colorVariant="ocean"
                strength={0.8}
                idle={0.14}
                className="voice-beam-field"
              >
                <div className="onboarding-input-row">
                  <input
                    type="text"
                    value={draft}
                    maxLength={500}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Tell me the thing in your head..."
                    aria-label="Describe what you are making"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={micDisabled}
                    aria-label={micLabel}
                    aria-pressed={listening}
                    title={voice.block ? "Voice input is unavailable" : micLabel}
                    onClick={() => (listening ? voice.stop() : void voice.start())}
                    className={`onboarding-icon-button ${listening ? "is-listening" : ""}`}
                  >
                    <MicIcon />
                  </button>
                  <button
                    type="submit"
                    disabled={!draft.trim() || listening || voice.phase === "transcribing"}
                    aria-label="Start with this idea"
                    className="onboarding-submit"
                  >
                    <SendIcon />
                  </button>
                </div>
              </VoiceBeam>
              <p className="onboarding-voice-status" role="status">
                {listening
                  ? "Listening. Press the mic when you are done."
                  : voice.phase === "transcribing"
                    ? "Finding the words..."
                    : voice.block === "insecure"
                      ? "Voice is available over HTTPS or localhost."
                      : "Type it, or use your voice."}
              </p>
              {voice.error ? <p className="onboarding-error" role="alert">{voice.error}</p> : null}
            </form>

            <div className="starter-prompts" aria-label="Starter ideas">
              {STARTER_PROMPTS.map((prompt) => (
                <button key={prompt} type="button" onClick={() => onStart(prompt, "chat")}>
                  {prompt}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-label="Open the full studio"
              className="onboarding-skip"
              onClick={() => onStart(undefined, "editor")}
            >
              Edit and ready <span aria-hidden="true">↗</span>
            </button>
          </section>

          <aside className="onboarding-projects" aria-label="Projects and starting points">
            <div className="onboarding-projects-heading">
              <p className="preview-label">Projects</p>
              <span>03</span>
            </div>
            <button
              type="button"
              className="onboarding-project-card is-current"
              onClick={() => onStart(undefined, "editor")}
            >
              <span className="onboarding-project-index">01</span>
              <span>
                <strong>{projectName || "Midnight Jazz"}</strong>
                <small>Open current workspace</small>
              </span>
              <span aria-hidden="true">↗</span>
            </button>
            <button
              type="button"
              className="onboarding-project-card"
              onClick={() => onStart(STARTER_PROMPTS[1], "chat")}
            >
              <span className="onboarding-project-index">02</span>
              <span>
                <strong>Warm identity</strong>
                <small>Start a new brief</small>
              </span>
              <span aria-hidden="true">+</span>
            </button>
            <button
              type="button"
              className="onboarding-project-card"
              onClick={() => onStart(STARTER_PROMPTS[2], "chat")}
            >
              <span className="onboarding-project-index">03</span>
              <span>
                <strong>Signal / noise</strong>
                <small>Start a new brief</small>
              </span>
              <span aria-hidden="true">+</span>
            </button>
            <button type="button" className="preview-chat-button" onClick={() => onStart(undefined, "chat")}>
              <span>Chat / voice</span>
              <span aria-hidden="true">+</span>
            </button>
          </aside>
        </Card>
      </div>

      <p className="onboarding-canvas-hint">Type a thought, choose a starting point, or use your voice.</p>
    </main>
  );
}
