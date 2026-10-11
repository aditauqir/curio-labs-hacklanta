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
  tooltipSide?: "top" | "bottom" | "left" | "right";
  onAction?: (id: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const trayRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const actionItems = useMemo(() => items.filter(isAction), [items]);
  const [rovingId, setRovingId] = useState(actionItems[0]?.id ?? "");
  const [highlight, setHighlight] = useState<Highlight>(null);
  const activeRovingId = actionItems.some((item) => item.id === rovingId && !item.disabled)
    ? rovingId
    : actionItems.find((item) => !item.disabled)?.id ?? "";

  const measure = useCallback((id: string) => {
    const tray = trayRef.current;
    const button = buttonRefs.current[id];
    if (!tray || !button) return;
    const trayRect = tray.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    setHighlight({
      x: buttonRect.left - trayRect.left,
      y: buttonRect.top - trayRect.top,
      width: buttonRect.width,
      height: buttonRect.height,
    });
  }, []);

  useEffect(() => {
    const tray = trayRef.current;
    if (!tray) return;
    const observer = new ResizeObserver(() => {
      if (rovingId) measure(rovingId);
    });
    observer.observe(tray);
    return () => observer.disconnect();
  }, [measure, rovingId]);

  function moveFocus(currentId: string, direction: -1 | 1) {
    const enabled = actionItems.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.id === currentId);
    if (index < 0 || enabled.length === 0) return;
    const next = enabled[(index + direction + enabled.length) % enabled.length];
    setRovingId(next.id);
    buttonRefs.current[next.id]?.focus();
    measure(next.id);
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
        measure(target.id);
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
          className,
        )}
        style={style}
        onPointerLeave={() => setHighlight(null)}
      >
        {highlight ? (
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
              onPointerEnter={() => measure(item.id)}
              onFocus={() => {
                setRovingId(item.id);
                measure(item.id);
              }}
              onKeyDown={(event) => handleKeyDown(event, item.id)}
              onClick={() => {
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
