"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
} from "react";
import { VoiceBeam } from "voice-glow";
import type { AssetSuggestion, ChatMessage, DesignState } from "@/lib/design-types";
import { describePatch, patchToActions } from "@/lib/ai-patch";
import { directionConfigs } from "@/lib/design-presets";
import { interpretRequest } from "@/lib/demo-director";
import { askDirector, DirectorError } from "@/lib/director-client";
import { makeId, type StudioAction } from "@/lib/design-state";
import type { PosterEdits } from "@/lib/poster-editor";
import { MicIcon, MicOffIcon, SendIcon } from "./icons";
import { StreamingText } from "./StreamingText";
import { ThinkingState } from "./ThinkingState";
import { useCapabilities } from "./use-capabilities";
import { useVoice } from "./use-voice";
import { VoiceKeyframes } from "./voice-keyframes";

const MAX_MESSAGE = 500;

const SOURCE_LABEL: Record<NonNullable<ChatMessage["source"]>, string> = {
  example: "Example conversation",
  demo: "Curio",
  gemini: "AI direction",
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

type Outcome = {
  reply: string;
  actions: StudioAction[];
  changes: string[];
  source: "gemini" | "demo";
  suggestions?: ChatMessage["suggestions"];
  skipped?: string[];
  notice?: string;
  assets?: AssetSuggestion[];
};

export function CreativeDirector({
  messages,
  design,
  selectedPaletteId,
  posterEdits,
  dispatch,
  initialPrompt,
}: {
  messages: ChatMessage[];
  design: DesignState;
  selectedPaletteId: string | null;
  posterEdits: PosterEdits;
  dispatch: Dispatch<StudioAction>;
  initialPrompt?: string | null;
}) {
  const capabilities = useCapabilities();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [desktopVoiceBeam, setDesktopVoiceBeam] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const initialPromptRef = useRef<string | null>(null);
  const sendRef = useRef<(text: string, spoken?: boolean) => void>(() => undefined);

  const voice = useVoice({
    canListen: capabilities.listen,
    canSpeak: capabilities.speak,
    onTranscript: (text) => {
      sendRef.current(text, true);
    },
  });
  const { speak } = voice;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktopVoiceBeam(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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
      const ai = await askDirector({
        message: content,
        design,
        paletteId: selectedPaletteId,
        posterEdits,
        history: messages,
      });
      return {
        reply: ai.reply,
        actions: patchToActions(ai.patch),
        // Chips list what was actually applied, not what the model claims it did.
        changes: describePatch(ai.patch),
        source: "gemini",
        skipped: ai.skipped,
        assets: ai.assets,
      };
    } catch (failure) {
      const limited = failure instanceof DirectorError && failure.status === 429;
      return {
        ...local(),
        notice: limited
          ? "Curio is using a fallback for this change."
          : "Curio is using a fallback for this change.",
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
            assetSuggestions: outcome.assets,
          },
        ],
      });
      if (spoken || voice.canSpeak) void speak(outcome.reply);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    sendRef.current = (text, spoken) => void send(text, spoken);
  });

  useEffect(() => {
    if (!initialPrompt || initialPromptRef.current === initialPrompt || !capabilities.loaded) return;
    initialPromptRef.current = initialPrompt;
    sendRef.current(initialPrompt);
  }, [capabilities.loaded, initialPrompt]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const lastId = messages[messages.length - 1]?.id;
  const creativeStages = [
    {
      label: "Brief",
      complete: messages.some((message) => message.role === "user"),
    },
    {
      label: "Concept",
      complete: messages.some(
        (message) => message.role === "assistant" && Boolean(message.suggestions?.length),
      ),
    },
    {
      label: "References",
      complete: messages.some((message) => Boolean(message.assetSuggestions?.length)),
    },
    { label: "Compose", current: true },
    { label: "Refine" },
  ];
  const listening = voice.phase === "listening";
  const micDisabled =
    voice.block !== null || pending || voice.phase === "transcribing";

  let micLabel = "Start voice input";
  if (listening) micLabel = "Stop recording and send";
  else if (voice.block) micLabel = "Voice input unavailable";

  const beamProcessing = pending || voice.phase === "transcribing";
  const beamActive = beamProcessing || voice.phase === "listening" || voice.phase === "speaking";
  const beamLevel = beamProcessing || voice.phase === "speaking" ? 0.34 : 0;
  const chatComposer = (
    <form
      onSubmit={onSubmit}
      aria-label="Chat with the creative director"
      data-testid="editor-chat-box"
      className="director-chat-box flex items-center gap-2 rounded-2xl border border-line bg-paper p-1.5"
    >
      <button
        type="button"
        disabled={micDisabled}
        aria-label={micLabel}
        aria-pressed={listening}
        onClick={() => (listening ? voice.stop() : void voice.start())}
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border transition-colors disabled:opacity-50 ${
          listening
            ? "border-ink bg-ink text-paper"
            : "border-line text-ink hover:border-ink"
        }`}
      >
        {voice.block ? (
          <MicOffIcon />
        ) : voice.phase === "speaking" ? (
          <VoiceKeyframes active />
        ) : (
          <MicIcon />
        )}
      </button>
      <input
        type="text"
        value={draft}
        maxLength={MAX_MESSAGE}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Describe a change or a direction"
        aria-label="Message the creative director"
        className="h-10 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        disabled={pending || !draft.trim()}
        aria-label="Send message"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-paper transition-opacity disabled:opacity-30"
      >
        <SendIcon />
      </button>
    </form>
  );

  return (
    <section
      aria-label="Creative director"
      className="flex min-h-0 flex-1 flex-col bg-panel"
    >
      <div className="director-header border-b border-line px-5 py-4">
        <div className="director-heading-row">
          <span className="director-mascot" aria-hidden="true">
            <VoiceKeyframes active={voice.phase === "speaking"} />
          </span>
          <div>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Chatbox area
            </h2>
            <p className="mt-1 text-xs text-muted">
              {!capabilities.loaded
                ? "Checking which services are available..."
                  : capabilities.gemini
                  ? "AI direction is ready. Every change is checked before it touches your poster."
                  : "Direction mode is ready. Changes stay focused on your request."}
            </p>
          </div>
        </div>
        <ol className="creative-process" aria-label="Creative process">
          {creativeStages.map((stage, index) => (
            <li
              key={stage.label}
              className={stage.current ? "is-current" : stage.complete ? "is-complete" : undefined}
              aria-current={stage.current ? "step" : undefined}
            >
              <span className="creative-process-index">{String(index + 1).padStart(2, "0")}</span>
              <span>{stage.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="studio-chat-messages min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5" aria-live="polite">
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
              {message.role === "assistant" && message.id === lastId ? (
                <div className="rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                  <StreamingText text={message.content} className="streaming-text" />
                </div>
              ) : (
                <p
                  className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-ink text-paper"
                      : "border border-line bg-paper text-ink"
                  }`}
                >
                  {message.content}
                </p>
              )}
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
                  Some suggestions were skipped to keep the poster safe.
                </p>
              ) : null}
              {message.assetSuggestions && message.assetSuggestions.length > 0 ? (
                <p className="mt-2 text-[11px] text-muted">
                  Related references: {message.assetSuggestions.map((asset) => asset.name).join(", ")}
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
            Curio is <ThinkingState />
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="studio-chat-footer border-t border-line px-5 pb-5 pt-4">
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

        {desktopVoiceBeam ? (
          <VoiceBeam
            className="editor-voice-beam"
            type="default"
            stream={voice.stream}
            level={beamLevel}
            active={beamActive}
            motion={beamProcessing ? { gather: 0.82, stretch: 0.18, heldLevel: 0.34, cornerFollow: 0.2 } : null}
            theme="dark"
            colorVariant="mono"
            strength={0.6}
            idle={0.05}
          >
            {chatComposer}
          </VoiceBeam>
        ) : (
          chatComposer
        )}

        {voice.error ? <span className="sr-only" role="alert">{voice.error}</span> : null}
      </div>
    </section>
  );
}
