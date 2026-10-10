"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
} from "react";
import type { ChatMessage, DesignState } from "@/lib/design-types";
import { directionConfigs } from "@/lib/design-presets";
import { interpretRequest } from "@/lib/demo-director";
import { makeId, type StudioAction } from "@/lib/design-state";
import { MicOffIcon, SendIcon } from "./icons";

const PROMPTS: Record<DesignState["direction"], string[]> = {
  vintage: [
    "Make it more minimal but keep the layout",
    "Use a burnt orange accent",
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

export function CreativeDirector({
  messages,
  design,
  dispatch,
}: {
  messages: ChatMessage[];
  design: DesignState;
  dispatch: Dispatch<StudioAction>;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  function send(raw: string) {
    const content = raw.trim();
    if (!content || pending) return;

    dispatch({
      type: "addMessages",
      messages: [{ id: makeId(), role: "user", content }],
    });
    setDraft("");
    setPending(true);

    const snapshot = design;
    timer.current = window.setTimeout(() => {
      const result = interpretRequest(content, snapshot);
      for (const action of result.actions) dispatch(action);
      dispatch({
        type: "addMessages",
        messages: [
          {
            id: makeId(),
            role: "assistant",
            source: "demo",
            content: result.reply,
            changes: result.changes,
            suggestions: result.suggestions,
          },
        ],
      });
      setPending(false);
    }, 450);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(draft);
  }

  const lastId = messages[messages.length - 1]?.id;

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
          Demo mode: replies come from local rules, not an AI model.
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
                      {message.source === "example" ? "Example conversation" : "Demo rules"}
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
              {message.changes && message.changes.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
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
              {message.id === lastId && message.suggestions?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.suggestions.map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      disabled={pending}
                      onClick={() => send(directionConfigs[direction].label)}
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
              onClick={() => send(prompt)}
              className="rounded-md border border-line px-2.5 py-1.5 text-left text-[11px] leading-snug text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
            >
              {prompt}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <button
            type="button"
            disabled
            aria-label="Voice input unavailable"
            title="Voice needs an ElevenLabs integration, which is not configured yet"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-line text-muted opacity-60"
          >
            <MicOffIcon />
          </button>
          <input
            type="text"
            value={draft}
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
        <p className="mt-2 text-[11px] text-muted">Voice is off. Text mode only.</p>
      </div>
    </section>
  );
}
