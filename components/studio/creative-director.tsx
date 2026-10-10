"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
} from "react";
import type { ChatMessage, DesignState } from "@/lib/design-types";
import { describePatch, patchToActions } from "@/lib/ai-patch";
import { directionConfigs } from "@/lib/design-presets";
import { interpretRequest } from "@/lib/demo-director";
import { askDirector, DirectorError } from "@/lib/director-client";
import { makeId, type StudioAction } from "@/lib/design-state";
import { MicIcon, MicOffIcon, SendIcon, StopIcon } from "./icons";
import { useCapabilities } from "./use-capabilities";
import { useVoice } from "./use-voice";

const MAX_MESSAGE = 500;

const SOURCE_LABEL: Record<NonNullable<ChatMessage["source"]>, string> = {
  example: "Example conversation",
  demo: "Demo rules",
  gemini: "Gemini",
};

const PROVIDER_LABEL: Record<string, string> = {
  whisper: "Whisper (offline)",
  elevenlabs: "ElevenLabs",
};

const PROMPTS: Record<DesignState["direction"], string[]> = {
  vintage: [
    "Make it more minimal but keep the layout",
    "Use a deep teal accent",
    "Center everything",
  ],
  minimal: [
    "Make it warmer and more vintage, but keep the layout",
    "Use a blue accent",
    "Make it more spacious",
  ],
  experimental: [
    "Make it warmer and more vintage, but keep the layout",
    "Use a pink accent",
    "Align it left",
  ],
};

function formatTime(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

type Outcome = {
  reply: string;
  actions: StudioAction[];
  changes: string[];
  source: "gemini" | "demo";
  suggestions?: ChatMessage["suggestions"];
  skipped?: string[];
  notice?: string;
};

export function CreativeDirector({
  messages,
  design,
  selectedPaletteId,
  dispatch,
}: {
  messages: ChatMessage[];
  design: DesignState;
  selectedPaletteId: string | null;
  dispatch: Dispatch<StudioAction>;
}) {
  const capabilities = useCapabilities();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [heard, setHeard] = useState<{ text: string; provider: string | null } | null>(null);
  const [speakReplies, setSpeakReplies] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const sendRef = useRef<(text: string, spoken?: boolean) => void>(() => undefined);

  const voice = useVoice({
    canListen: capabilities.listen,
    canSpeak: capabilities.speak,
    onTranscript: (text, provider) => {
      setHeard({ text, provider });
      sendRef.current(text, true);
    },
  });
  const { speak } = voice;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  async function interpret(content: string): Promise<Outcome> {
    const local = () => {
      const result = interpretRequest(content, design);
      return {
        reply: result.reply,
        actions: result.actions,
        changes: result.changes,
        source: "demo" as const,
        suggestions: result.suggestions,
      };
    };

    if (!capabilities.gemini) return local();

    try {
      const ai = await askDirector({ message: content, design, paletteId: selectedPaletteId, history: messages });
      return {
        reply: ai.reply,
        actions: patchToActions(ai.patch),
        // Chips list what was actually applied, not what the model claims it did.
        changes: describePatch(ai.patch),
        source: "gemini",
        skipped: ai.skipped,
      };
    } catch (failure) {
      const limited = failure instanceof DirectorError && failure.status === 429;
      return {
        ...local(),
        notice: limited
          ? "Too many requests to Gemini, so this used local demo rules."
          : "Gemini was unavailable, so this used local demo rules.",
      };
    }
  }

  async function send(raw: string, spoken = false) {
    const content = raw.trim().slice(0, MAX_MESSAGE);
    if (!content || pendingRef.current) return;

    pendingRef.current = true;
    setPending(true);
    setDraft("");
    dispatch({
      type: "addMessages",
      messages: [{ id: makeId(), role: "user", content }],
    });

    try {
      const outcome = await interpret(content);
      for (const action of outcome.actions) dispatch(action);
      dispatch({
        type: "addMessages",
        messages: [
          {
            id: makeId(),
            role: "assistant",
            source: outcome.source,
            content: outcome.reply,
            changes: outcome.changes,
            suggestions: outcome.suggestions,
            skipped: outcome.skipped?.length ? outcome.skipped : undefined,
            notice: outcome.notice,
          },
        ],
      });
      if (spoken || speakReplies) void speak(outcome.reply);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    sendRef.current = (text, spoken) => void send(text, spoken);
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const lastId = messages[messages.length - 1]?.id;
  const listening = voice.phase === "listening";
  const micDisabled =
    voice.block !== null || pending || voice.phase === "transcribing";

  let micLabel = "Start voice input";
  if (listening) micLabel = "Stop recording and send";
  else if (voice.block) micLabel = "Voice input unavailable";

  let voiceStatus: string;
  switch (voice.block) {
    case "not-configured":
      voiceStatus = "Voice is off: no speech-to-text service is running on this server. Text mode only.";
      break;
    case "insecure":
      voiceStatus =
        "The browser blocks the microphone on plain HTTP. Open this over HTTPS or on localhost to use voice.";
      break;
    case "unsupported":
      voiceStatus = "This browser does not support microphone recording. Text mode only.";
      break;
    default:
      voiceStatus = "Press the mic, speak, then press it again to send.";
  }

  return (
    <section
      aria-label="Creative director"
      className="flex min-h-0 flex-1 flex-col bg-panel"
    >
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          Creative director
        </h2>
        <p className="mt-1 text-xs text-muted">
          {!capabilities.loaded
            ? "Checking which services are available..."
            : capabilities.gemini
              ? "Powered by Gemini. Every change is validated before it touches your poster."
              : "Demo mode: no Gemini key is configured, so replies come from local rules, not an AI model."}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5" aria-live="polite">
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div className="max-w-[92%]">
              {message.role === "assistant" ? (
                <p className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
                  Curio Labs
                  {message.source ? (
                    <span className="rounded border border-line px-1.5 py-0.5 normal-case tracking-normal">
                      {SOURCE_LABEL[message.source]}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <p
                className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "bg-ink text-paper"
                    : "border border-line bg-paper text-ink"
                }`}
              >
                {message.content}
              </p>
              {message.notice ? (
                <p className="mt-1.5 text-[11px] text-muted">{message.notice}</p>
              ) : null}
              {message.changes && message.changes.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Changes applied">
                  {message.changes.map((change) => (
                    <li
                      key={change}
                      className="rounded border border-line bg-paper px-2 py-1 text-[11px] text-muted"
                    >
                      {change}
                    </li>
                  ))}
                </ul>
              ) : null}
              {message.skipped && message.skipped.length > 0 ? (
                <p className="mt-1.5 text-[11px] text-muted">
                  Skipped invalid suggestions: {message.skipped.join(", ")}
                </p>
              ) : null}
              {message.id === lastId && message.suggestions?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.suggestions.map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      disabled={pending}
                      onClick={() => void send(directionConfigs[direction].label)}
                      className="rounded-full border border-ink px-3 py-1.5 text-xs font-medium transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
                    >
                      {directionConfigs[direction].label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {pending ? (
          <p className="text-xs text-muted" role="status">
            Curio Labs is thinking
            <span className="inline-flex gap-0.5 pl-1" aria-hidden="true">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </span>
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line px-5 pb-5 pt-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PROMPTS[design.direction].map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={pending}
              onClick={() => void send(prompt)}
              className="rounded-md border border-line px-2.5 py-1.5 text-left text-[11px] leading-snug text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
            >
              {prompt}
            </button>
          ))}
        </div>

        {heard ? (
          <p className="mb-2 text-[11px] text-muted" data-testid="transcript">
            <span className="font-medium uppercase tracking-[0.12em]">Heard</span>{" "}
            &ldquo;{heard.text}&rdquo;
            {heard.provider ? (
              <span className="ml-1.5 rounded border border-line px-1 py-0.5">
                {PROVIDER_LABEL[heard.provider] ?? heard.provider}
              </span>
            ) : null}
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <button
            type="button"
            disabled={micDisabled}
            aria-label={micLabel}
            aria-pressed={listening}
            title={voice.block ? voiceStatus : micLabel}
            onClick={() => (listening ? voice.stop() : void voice.start())}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-md border transition-colors disabled:opacity-50 ${
              listening
                ? "border-ink bg-ink text-paper"
                : "border-line text-ink hover:border-ink"
            }`}
          >
            {voice.block ? <MicOffIcon /> : listening ? <StopIcon /> : <MicIcon />}
          </button>
          <input
            type="text"
            value={draft}
            maxLength={MAX_MESSAGE}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Describe a change or a direction"
            aria-label="Message the creative director"
            className="h-10 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-sm text-ink placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            aria-label="Send message"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ink text-paper transition-opacity disabled:opacity-30"
          >
            <SendIcon />
          </button>
        </form>

        <div className="mt-2 flex items-start justify-between gap-3">
          <p className="min-w-0 text-[11px] text-muted" role="status" data-testid="voice-status">
            {listening ? (
              <span className="inline-flex items-center gap-1.5 text-ink">
                <span className="rec-dot" aria-hidden="true" />
                Listening {formatTime(voice.seconds)}. Press the mic to send.
              </span>
            ) : voice.phase === "transcribing" ? (
              "Transcribing..."
            ) : voice.phase === "speaking" ? (
              <span className="inline-flex items-center gap-2 text-ink">
                Speaking...
                <button
                  type="button"
                  onClick={voice.stopSpeaking}
                  className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-ink"
                >
                  Stop
                </button>
              </span>
            ) : (
              voiceStatus
            )}
          </p>

          <label
            className={`flex shrink-0 items-center gap-1.5 text-[11px] ${
              voice.canSpeak ? "text-muted" : "text-muted opacity-50"
            }`}
          >
            <input
              type="checkbox"
              checked={speakReplies}
              disabled={!voice.canSpeak}
              onChange={(event) => setSpeakReplies(event.target.checked)}
            />
            Speak replies
          </label>
        </div>

        {voice.error ? (
          <p role="alert" className="mt-2 text-[11px] text-red-700">
            {voice.error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
