"use client";

import { DotsThree, ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import { useState } from "react";
import WarmTooltip from "./warm-tooltip";

type Feedback = "like" | "dislike" | null;

export function MessageActions({ onStartFromHere }: { onStartFromHere: () => void }) {
  const [feedback, setFeedback] = useState<Feedback>(null);

  function chooseFeedback(next: Exclude<Feedback, null>) {
    setFeedback((current) => (current === next ? null : next));
  }

  return (
    <div className="director-message-actions" aria-label="Response actions">
      <WarmTooltip content="Like" side="bottom" size="sm">
        <button
          type="button"
          className={feedback === "like" ? "is-selected" : undefined}
          aria-label="Like response"
          aria-pressed={feedback === "like"}
          onClick={() => chooseFeedback("like")}
        >
          <ThumbsUp size={14} weight="regular" aria-hidden="true" />
        </button>
      </WarmTooltip>
      <WarmTooltip content="Dislike" side="bottom" size="sm">
        <button
          type="button"
          className={feedback === "dislike" ? "is-selected" : undefined}
          aria-label="Dislike response"
          aria-pressed={feedback === "dislike"}
          onClick={() => chooseFeedback("dislike")}
        >
          <ThumbsDown size={14} weight="regular" aria-hidden="true" />
        </button>
      </WarmTooltip>
      <WarmTooltip content="Start from here" side="bottom" size="sm">
        <button type="button" aria-label="Start from here" onClick={onStartFromHere}>
          <DotsThree size={16} weight="regular" aria-hidden="true" />
        </button>
      </WarmTooltip>
    </div>
  );
}
