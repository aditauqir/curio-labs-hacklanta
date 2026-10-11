"use client";

import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

type FloatingButtonItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  shortcut?: string;
  reserveLabels?: string[];
};

type FloatingButtonSeparator = { type: "separator"; id?: string };

export type FloatingButtonGroupItem = FloatingButtonItem | FloatingButtonSeparator;

type Highlight = { x: number; y: number; width: number; height: number } | null;

function isAction(item: FloatingButtonGroupItem): item is FloatingButtonItem {
  return !("type" in item);
}

export function FloatingButtonGroup({
  items,
  label,
  variant = "muted",
  size = "md",
  orientation = "horizontal",
  iconOnly = false,
  showHighlight = true,
  tooltipSide,
  onAction,
  className,
  style,
}: {
  items: FloatingButtonGroupItem[];
  label: string;
  variant?: "muted" | "floating";
  size?: "sm" | "md";
  orientation?: "horizontal" | "vertical";
  iconOnly?: boolean;
  showHighlight?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  onAction?: (id: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const trayRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const actionItems = useMemo(() => items.filter(isAction), [items]);
  const [rovingId, setRovingId] = useState(actionItems[0]?.id ?? "");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const activeRovingId = actionItems.some((item) => item.id === rovingId && !item.disabled)
    ? rovingId
    : actionItems.find((item) => !item.disabled)?.id ?? "";
  const pressedId = actionItems.find((item) => item.pressed && !item.disabled)?.id ?? null;
  const defaultHighlightId = pressedId ?? activeRovingId;

  const measure = useCallback((id: string) => {
    const tray = trayRef.current;
    const button = buttonRefs.current[id];
    if (!tray || !button) return;
    const trayRect = tray.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    setHighlightedId(id);
    setHighlight({
      x: buttonRect.left - trayRect.left,
      y: buttonRect.top - trayRect.top,
      width: buttonRect.width,
      height: buttonRect.height,
    });
  }, []);

  useEffect(() => {
    if (!showHighlight || !defaultHighlightId) return;
    measure(defaultHighlightId);
  }, [defaultHighlightId, measure, showHighlight]);

  useEffect(() => {
    if (!showHighlight || !defaultHighlightId) return;
    const tray = trayRef.current;
    if (!tray) return;
    const observer = new ResizeObserver(() => {
      const targetId = highlightedId ?? defaultHighlightId;
      if (targetId) measure(targetId);
    });
    observer.observe(tray);
    return () => observer.disconnect();
  }, [defaultHighlightId, highlightedId, measure, showHighlight]);

  function moveFocus(currentId: string, direction: -1 | 1) {
    const enabled = actionItems.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.id === currentId);
    if (index < 0 || enabled.length === 0) return;
    const next = enabled[(index + direction + enabled.length) % enabled.length];
    setRovingId(next.id);
    buttonRefs.current[next.id]?.focus();
    if (showHighlight) measure(next.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const previous = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (event.key === previous) {
      event.preventDefault();
      moveFocus(id, -1);
    } else if (event.key === next) {
      event.preventDefault();
      moveFocus(id, 1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const enabled = actionItems.filter((item) => !item.disabled);
      const target = event.key === "Home" ? enabled[0] : enabled.at(-1);
      if (target) {
        setRovingId(target.id);
        buttonRefs.current[target.id]?.focus();
        if (showHighlight) measure(target.id);
      }
    }
  }

  const side = tooltipSide ?? (orientation === "vertical" ? "right" : "top");

  return (
    <TooltipProvider delayDuration={420}>
      <div
        ref={trayRef}
        role="toolbar"
        aria-label={label}
        aria-orientation={orientation}
        className={cn(
          "floating-button-group",
          `floating-button-group-${variant}`,
          `floating-button-group-${size}`,
          `floating-button-group-${orientation}`,
          showHighlight && "has-highlight",
          className,
        )}
        style={style}
        onPointerLeave={() => {
          if (pressedId) {
            measure(pressedId);
          } else {
            setHighlightedId(null);
            setHighlight(null);
          }
        }}
      >
        {showHighlight && highlight ? (
          <motion.span
            aria-hidden="true"
            className="floating-button-group-highlight"
            animate={highlight}
            transition={{ type: "spring", stiffness: 500, damping: 36, mass: 0.35 }}
          />
        ) : null}
        {items.map((item, index) => {
          if (!isAction(item)) {
            return <span key={item.id ?? `separator-${index}`} role="separator" className="floating-button-group-separator" />;
          }

          const displayIconOnly = iconOnly || item.iconOnly === true;
          const button = (
            <button
              ref={(node) => {
                buttonRefs.current[item.id] = node;
              }}
              type="button"
              disabled={item.disabled}
              aria-label={item.label}
              aria-pressed={item.pressed}
              tabIndex={activeRovingId === item.id ? 0 : -1}
              className={cn(
                "floating-button-group-button",
                displayIconOnly && "is-icon-only",
                item.pressed && "is-pressed",
              )}
              onPointerEnter={() => {
                if (showHighlight) measure(item.id);
              }}
              onFocus={() => {
                setRovingId(item.id);
                if (showHighlight) measure(item.id);
              }}
              onKeyDown={(event) => handleKeyDown(event, item.id)}
              onClick={() => {
                setRovingId(item.id);
                if (showHighlight) measure(item.id);
                item.onSelect?.();
                onAction?.(item.id);
              }}
            >
              {item.icon ? <span className="floating-button-group-icon">{item.icon}</span> : null}
              <span className={displayIconOnly ? "sr-only" : undefined}>{item.label}</span>
              {!displayIconOnly && item.reserveLabels?.length ? (
                <span className="sr-only">{item.reserveLabels.join(" ")}</span>
              ) : null}
            </button>
          );

          return displayIconOnly || item.shortcut ? (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side={side} sideOffset={8}>
                {item.label}
                {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span key={item.id} className="floating-button-group-item">
              {button}
            </span>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
