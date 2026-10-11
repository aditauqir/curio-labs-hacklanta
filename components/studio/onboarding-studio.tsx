"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { VoiceBeam } from "voice-glow";
import { Card } from "@/components/ui/card";
import type { ImportedReference } from "@/lib/image-import-client";
import { ImageImportControl } from "./image-import";
import { MicIcon, SendIcon } from "./icons";
import { useCapabilities } from "./use-capabilities";
import { useVoice } from "./use-voice";
import { VoiceMascot } from "./voice-keyframes";

const FALLBACK_STARTER_PROMPTS = [
  "Start a poster brief for a neighborhood restaurant",
  "Build a visual identity for a Sunday market",
  "Make an editorial launch poster for a new album",
];

const PROJECT_EXAMPLES = [
  {
    title: "Kebab After Dark",
    description: "Start a late-night food poster",
    prompt:
      "Create a bold, late-night poster for Kebab After Dark, a neighborhood kebab shop opening on Friday. Use a subject-specific visual direction with a memorable food-led gesture, clear opening details, and an editable type-and-shape composition.",
  },
  {
    title: "Lantern Field",
    description: "Start a music festival poster",
    prompt:
      "Create an expressive poster for Lantern Field, an open-air music festival at dusk. Use a different visual grammar from a restaurant poster: kinetic rhythm, an event-scale headline, atmospheric color contrast, and an editable type-and-shape composition.",
  },
];

function useVoiceLevel(stream: MediaStream | null, active: boolean) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || !active) {
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;

    const context = new AudioContextConstructor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.72;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;

    const sample = () => {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / samples.length);
      const nextLevel = Math.min(1, Math.max(0, (rms - 0.015) * 8));
      setLevel((previous) => (Math.abs(previous - nextLevel) < 0.015 ? previous : nextLevel));
      frame = window.requestAnimationFrame(sample);
    };

    void context.resume();
    frame = window.requestAnimationFrame(sample);

    return () => {
      window.cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      void context.close();
    };
  }, [active, stream]);

  return level;
}

function VoiceActivityOrb({ active, level, processing }: { active: boolean; level: number; processing: boolean }) {
  const style = {
    "--voice-level": level,
    "--voice-scale": active ? 0.92 + level * 0.14 : 0.7,
    "--voice-border-color": `rgba(36, 36, 36, ${active ? 0.16 + level * 0.42 : 0.16})`,
    "--voice-shadow-size": `${active ? 0.65 + level * 0.9 : 0}rem`,
    "--voice-shadow-color": `rgba(36, 36, 36, ${active ? 0.08 + level * 0.12 : 0})`,
  } as CSSProperties;

  return (
    <span className={`voice-activity-orb ${active ? "is-active" : ""} ${processing ? "is-processing" : ""}`} style={style}>
    </span>
  );
}

export function OnboardingStudio({
  onStart,
  onImportImage,
  importedReference,
  projectName = "Cedar & Salt",
}: {
  onStart: (prompt?: string) => void;
  onImportImage: (file: File) => Promise<ImportedReference>;
  importedReference: ImportedReference | null;
  projectName?: string;
}) {
  const capabilities = useCapabilities();
  const [draft, setDraft] = useState("");
  const [starterPrompts, setStarterPrompts] = useState(FALLBACK_STARTER_PROMPTS);
  const voice = useVoice({
    canListen: capabilities.listen,
    canSpeak: false,
    onTranscript: (text) => onStart(text),
  });
  const voiceLevel = useVoiceLevel(voice.stream, voice.phase === "listening");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/onboarding-suggestions", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("suggestions"))))
      .then((json: { suggestions?: unknown }) => {
        const suggestions = Array.isArray(json.suggestions)
          ? json.suggestions.filter((item): item is string => typeof item === "string").slice(0, 3)
          : [];
        if (suggestions.length === 3) {
          setStarterPrompts(suggestions);
        }
      })
      .catch(() => {
        // Static prompts remain available when Gemini is unavailable.
      });

    return () => controller.abort();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (prompt) onStart(prompt);
  }

  const listening = voice.phase === "listening";
  const processing = voice.phase === "transcribing";
  const voiceActive = listening || processing;
  const micDisabled = voice.block !== null || voice.phase === "transcribing";
  const micLabel = listening ? "Stop recording and start" : "Start voice input";

  return (
    <main className="onboarding-shell onboarding-wireframe-shell" data-testid="onboarding-screen">
      <div className="onboarding-topbar">
        <div className="brand-lockup">
          <span>CURIO LABS</span>
        </div>
      </div>

      <div className="onboarding-content onboarding-wireframe-content">
        <Card className="onboarding-wireframe-card" aria-labelledby="onboarding-title">
          <section className="onboarding-wireframe-hero">
            <div className="mascot-frame">
              <VoiceMascot />
            </div>
            <h1 id="onboarding-title">Start with an idea</h1>
            <p className="onboarding-voice-status">Describe a poster, identity, or brief and Curio will open a fresh canvas for it.</p>

            <ImageImportControl
              onImport={onImportImage}
              result={importedReference}
              showSuggestions
              onUseSuggestion={onStart}
            />

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
                  <span className={`onboarding-mic-control ${voiceActive ? "is-active" : ""}`}>
                    <VoiceActivityOrb active={voiceActive} level={listening ? voiceLevel : 0} processing={processing} />
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
                  </span>
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
              {starterPrompts.map((prompt) => (
              <button key={prompt} type="button" onClick={() => onStart(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>

          </section>

          <aside className="onboarding-projects" aria-label="Recent projects">
            <div className="onboarding-projects-heading">
              <p className="preview-label">Recent projects</p>
            </div>
            <button
              type="button"
              className="onboarding-project-card is-current"
              onClick={() => onStart()}
            >
              <span>
                <strong>{projectName || PROJECT_EXAMPLES[0].title}</strong>
                <small>Continue your current workspace</small>
              </span>
              <span aria-hidden="true">↗</span>
            </button>
            {PROJECT_EXAMPLES.map((example) => (
              <button
                key={example.title}
                type="button"
                className="onboarding-project-card"
                onClick={() => onStart(example.prompt)}
              >
                <span>
                  <strong>{example.title}</strong>
                  <small>{example.description}</small>
                </span>
                <span aria-hidden="true">+</span>
              </button>
            ))}
          </aside>
        </Card>
      </div>

      <p className="onboarding-canvas-hint">Describe a visual, choose a reference, then ask Curio to refine the canvas.</p>
    </main>
  );
}
