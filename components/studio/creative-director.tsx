"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
} from "react";
import { Wave } from "loading-dev";
import type { AssetSuggestion, ChatMessage, DesignState, ReferenceTreatment } from "@/lib/design-types";
import { describePatch, patchToActions } from "@/lib/ai-patch";
import { directionConfigs } from "@/lib/design-presets";
import { interpretRequest } from "@/lib/demo-director";
import { askDirector, DirectorError } from "@/lib/director-client";
import {
  generateStudioPipeline,
  pipelineAssetSuggestions,
  pipelineChangeLabels,
  pipelineFollowUps,
  pipelineResultToActions,
} from "@/lib/studio-pipeline-client";
import {
  createDefaultState,
  makeId,
  studioReducer,
  type StudioAction,
  type StudioState,
} from "@/lib/design-state";
import type { PosterEdits } from "@/lib/poster-editor";
import { ArrowBendDownRightIcon, MicIcon, MicOffIcon, SendIcon, StopIcon } from "./icons";
import { StreamingText } from "./StreamingText";
import { useCapabilities } from "./use-capabilities";
import { useVoice } from "./use-voice";
import { VoiceKeyframes } from "./voice-keyframes";
import { MessageActions } from "./message-actions";

const MAX_MESSAGE = 500;

function isBriefShapedRequest(content: string) {
  const words = content.trim().split(/\s+/).filter(Boolean);
  return (
    words.length >= 8 ||
    (words.length >= 3 &&
      /\b(poster|identity|brief|restaurant|market|festival|launch|editorial|packaging|campaign|menu)\b/i.test(content))
  );
}

const SOURCE_LABEL: Record<NonNullable<ChatMessage["source"]>, string> = {
  example: "Example conversation",
  demo: "Curio",
  gemini: "AI direction",
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
  followUps?: string[];
  groundingSources?: ChatMessage["groundingSources"];
};

export function CreativeDirector({
  messages,
  design,
  selectedPaletteId,
  posterEdits,
  layerOrder,
  referenceTreatment,
  dispatch,
  dispatchBatch,
  initialPrompt,
}: {
  messages: ChatMessage[];
  design: DesignState;
  selectedPaletteId: string | null;
  posterEdits: PosterEdits;
  layerOrder: string[];
  referenceTreatment: ReferenceTreatment;
  dispatch: Dispatch<StudioAction>;
  dispatchBatch: (actions: StudioAction[]) => void;
  initialPrompt?: string | null;
}) {
  const capabilities = useCapabilities();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [startFromHereId, setStartFromHereId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
  const { speak, unlockAudio } = voice;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  async function interpret(content: string): Promise<Outcome> {
    const anchorIndex = startFromHereId
      ? messages.findIndex((message) => message.id === startFromHereId)
      : -1;
    const history = anchorIndex >= 0 ? messages.slice(0, anchorIndex + 1) : messages;
    const local = () => {
      const result = interpretRequest(content, design);
      return {
        reply: result.reply,
        actions: result.actions,
        changes: result.changes,
        source: "demo" as const,
        suggestions: result.suggestions,
        notice: "Gemini was not used for this message. Curio applied its small offline safety fallback.",
      };
    };

    const isFreshBrief =
      messages.length === 0 &&
      (!initialPrompt || initialPrompt === content) &&
      isBriefShapedRequest(content);
    if (isFreshBrief && capabilities.gemini) {
      try {
        const pipeline = await generateStudioPipeline(content);
        const actions = pipelineResultToActions(pipeline);
        const providerIsGemini = pipeline.provider === "gemini";
        return {
          reply: pipeline.canvasAsset
            ? `I translated this into ${pipeline.selectedConcept.title} and attached the generated output so you can refine it.`
            : `I translated this into ${pipeline.selectedConcept.title}. I used the Curio library for direction only, so the canvas stays editable with type and shapes until you choose an image.`,
          actions,
          changes: pipelineChangeLabels(pipeline),
          source: providerIsGemini ? "gemini" : "demo",
          assets: pipelineAssetSuggestions(pipeline),
          followUps: pipelineFollowUps(pipeline),
          notice: pipeline.python.available
            ? "Gemini set the direction and the Python raster engine returned the visual output."
            : "Gemini used TigerData reference metadata for direction only. No library image was placed; the Python raster renderer is not configured on this local server yet.",
        };
      } catch {
        // The existing director/fallback path remains the safe recovery path
        // if the staged generation request is unavailable.
      }
    }

    if (!capabilities.gemini) return local();

    try {
      const ai = await askDirector({
        message: content,
        design,
        paletteId: selectedPaletteId,
        posterEdits,
        referenceTreatment,
        history,
      });
      const actions = patchToActions(ai.patch);
      const fallback = local();
      const startsBrief = fallback.actions.some(
        (action) => action.type === "setCopy" && action.key === "projectName",
      );
      const modelSetsProjectName = actions.some(
        (action) => action.type === "setCopy" && action.key === "projectName",
      );
      if (startsBrief && !modelSetsProjectName) {
        const modelCopyKeys = new Set(
          actions
            .filter((action) => action.type === "setCopy")
            .map((action) => action.key),
        );
        const starterActions = fallback.actions.filter(
          (action) => action.type !== "setCopy" || !modelCopyKeys.has(action.key),
        );
        return {
          reply: ai.reply,
          actions: [...actions, ...starterActions],
          changes: [...describePatch(ai.patch), ...fallback.changes],
          source: "gemini",
          skipped: ai.skipped,
          assets: ai.assets,
          notice: "Curio completed the starter brief fields so the new idea has a usable canvas.",
        };
      }
      // Gemini can occasionally answer correctly in prose but omit the
      // structured patch. Keep the interaction honest, but still make a
      // recognizable request such as "make it more modern" change the poster.
      if (actions.length === 0 && fallback.actions.length > 0) {
        return {
          ...fallback,
          notice: "Curio is using a fallback for this change.",
        };
      }
      return {
        reply: ai.reply,
        actions,
        // Chips list what was actually applied, not what the model claims it did.
        changes: describePatch(ai.patch),
        source: "gemini",
        skipped: ai.skipped,
        assets: ai.assets,
        followUps: ai.followUps,
        groundingSources: ai.groundingSources,
      };
    } catch (failure) {
      const limited = failure instanceof DirectorError && failure.status === 429;
      return {
        ...local(),
        notice:
          failure instanceof DirectorError && failure.code === "grounding_unavailable"
            ? "Gemini Search grounding is unavailable for this API key or model, so no web research was used."
            : limited
              ? "Curio is using a fallback for this change."
              : "Curio is using a fallback for this change.",
      };
    }
  }

  async function send(raw: string, spoken = false) {
    const content = raw.trim().slice(0, MAX_MESSAGE);
    if (!content || pendingRef.current) return;

    unlockAudio();
    pendingRef.current = true;
    setPending(true);
    setDraft("");
    dispatch({
      type: "addMessages",
      messages: [{ id: makeId(), role: "user", content }],
    });

    try {
      const outcome = await interpret(content);
      const reply = outcome.reply.trim();
      const appliedState = outcome.actions.reduce<StudioState>(
        (next, action) => studioReducer(next, action),
        { design, messages, selectedPaletteId, posterEdits, layerOrder, referenceTreatment },
      );
      dispatchBatch(outcome.actions);
      dispatch({
        type: "addMessages",
        messages: [
          {
            id: makeId(),
            role: "assistant",
            source: outcome.source,
            content: reply,
            changes: outcome.changes,
            suggestions: outcome.suggestions,
            skipped: outcome.skipped?.length ? outcome.skipped : undefined,
            notice: outcome.notice,
            assetSuggestions: outcome.assets,
            followUps: outcome.followUps,
            groundingSources: outcome.groundingSources,
            checkpoint: {
              design: appliedState.design,
              selectedPaletteId: appliedState.selectedPaletteId,
              posterEdits: appliedState.posterEdits,
              layerOrder: appliedState.layerOrder,
              referenceTreatment: appliedState.referenceTreatment,
            },
          },
        ],
      });
      if (spoken || voice.canSpeak) void speak(reply);
    } finally {
      pendingRef.current = false;
      setPending(false);
      setStartFromHereId(null);
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

  function rewindTo(messageId: string) {
    if (pendingRef.current) return;

    const messageIndex = messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) return;

    const message = messages[messageIndex];
    const fallback = createDefaultState();
    const checkpoint =
      message.checkpoint ??
      (messageIndex === messages.length - 1
        ? { design, selectedPaletteId, posterEdits, layerOrder, referenceTreatment }
        : {
            design: fallback.design,
            selectedPaletteId: fallback.selectedPaletteId,
            posterEdits: fallback.posterEdits,
            layerOrder: fallback.layerOrder,
            referenceTreatment: fallback.referenceTreatment,
          });

    dispatch({
      type: "restoreState",
      state: {
        design: checkpoint.design,
        messages: messages.slice(0, messageIndex + 1),
        selectedPaletteId: checkpoint.selectedPaletteId,
        posterEdits: checkpoint.posterEdits,
        layerOrder: checkpoint.layerOrder,
        referenceTreatment: checkpoint.referenceTreatment,
      },
    });
    setStartFromHereId(messageId);
    requestAnimationFrame(() => inputRef.current?.focus());
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

  const micTitle = voice.error
    ? voice.error
    : voice.block === "not-configured"
      ? "Speech-to-text is not configured"
      : voice.block === "insecure"
        ? "Open this app on localhost or HTTPS to use voice input"
        : voice.block === "unsupported"
          ? "This browser does not provide microphone recording"
          : listening
            ? "Stop recording and transcribe"
            : "Record a spoken design request";

  const chatComposer = (
    <form
      onSubmit={onSubmit}
      aria-label="Chat workspace"
      data-testid="editor-chat-box"
      className="director-chat-box flex items-center gap-2 rounded-2xl border border-line bg-paper p-1.5"
    >
      <button
        type="button"
        disabled={micDisabled}
        aria-label={micLabel}
        aria-pressed={listening}
        title={micTitle}
        onClick={() => (listening ? voice.stop() : void voice.start())}
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border transition-colors disabled:opacity-50 ${
          listening
            ? "border-white bg-white text-black"
            : "border-line text-ink hover:border-ink"
        }`}
        style={
          listening
            ? { borderColor: "#fff", background: "#fff", color: "#050505" }
            : undefined
        }
      >
        {voice.block ? (
          <MicOffIcon />
        ) : voice.phase === "speaking" ? (
          <Wave size={20} />
        ) : (
          <MicIcon />
        )}
      </button>
      {listening ? (
        <button
          type="button"
          aria-label="Cancel voice recording"
          title="Cancel voice recording"
          onClick={voice.cancel}
          className="director-voice-cancel grid shrink-0 place-items-center rounded-full border transition-colors"
          style={{
            borderColor: "rgba(240, 117, 102, 0.46)",
            background: "rgba(240, 117, 102, 0.12)",
            color: "#f08a79",
          }}
        >
          <StopIcon />
        </button>
      ) : null}
      {pending ? (
        <span className="director-composer-status" role="status" aria-label="Curio is thinking">
          <Wave size={20} />
        </span>
      ) : null}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        maxLength={MAX_MESSAGE}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Describe a change or a direction"
        aria-label="Describe a change"
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
      aria-label="Chat workspace"
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

      <div className="studio-chat-messages min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`director-message-row ${message.role === "user" ? "is-user" : "is-assistant"}`}
          >
            <div className="director-message">
              {message.role === "assistant" ? (
                <p className="director-message-kicker mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
                  Curio Labs
                  {message.source ? (
                    <span className="rounded border border-line px-1.5 py-0.5 normal-case tracking-normal">
                      {SOURCE_LABEL[message.source]}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {message.role === "assistant" && message.id === lastId ? (
                <div className="director-message-bubble">
                  <StreamingText text={message.content} className="streaming-text" />
                </div>
              ) : (
                <p className="director-message-bubble">
                  {message.content}
                </p>
              )}
              {message.role === "assistant" ? (
                <MessageActions
                  onStartFromHere={() => rewindTo(message.id)}
                />
              ) : null}
              {message.notice ? (
                <p className="mt-1.5 text-[11px] text-muted">{message.notice}</p>
              ) : null}
              {message.changes && message.changes.length > 0 ? (
                <ul className="studio-chip-row mt-2 flex flex-wrap gap-1.5" aria-label="Changes applied">
                  {message.changes.map((change) => (
                    <li
                      key={change}
                      className="studio-change-chip"
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
                  Related assets: {message.assetSuggestions.map((asset) => asset.name).join(", ")}
                </p>
              ) : null}
              {message.groundingSources && message.groundingSources.length > 0 ? (
                <p className="mt-2 text-[11px] text-muted">
                  Web research: {message.groundingSources.slice(0, 4).map((source, index) => (
                    <span key={source.url}>
                      {index > 0 ? ", " : ""}
                      <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                        {source.title || "source"}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
              {message.id === lastId && message.followUps && message.followUps.length > 0 ? (
                <div className="studio-chip-row mt-3 flex flex-wrap gap-2" aria-label="Suggested next moves">
                  {message.followUps.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={pending}
                      onClick={() => void send(prompt)}
                      className="studio-prompt-chip rounded-md border border-line px-2.5 py-1.5 text-left text-[11px] leading-snug text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
                    >
                      <ArrowBendDownRightIcon className="studio-prompt-chip-icon" />
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}
              {message.id === lastId && message.suggestions?.length ? (
                <div className="studio-chip-row mt-3 flex flex-wrap gap-2">
                  {message.suggestions.slice(0, 1).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      disabled={pending}
                      onClick={() => void send(directionConfigs[direction].label)}
                      className="studio-suggestion-chip rounded-full border border-ink px-3 py-1.5 text-xs font-medium transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
                    >
                      {directionConfigs[direction].label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}

        <div ref={endRef} />
      </div>

      <div className="studio-chat-footer border-t border-line px-5 pb-5 pt-4">
        <div className="director-composer-shell">
          {chatComposer}
        </div>

        {voice.error ? <span className="sr-only" role="alert">{voice.error}</span> : null}
        {startFromHereId ? (
          <span className="sr-only" role="status">
            The next request will start from this response.
          </span>
        ) : null}
      </div>
    </section>
  );
}
