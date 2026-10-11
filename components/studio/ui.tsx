"use client";

import type { ReactNode } from "react";

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  tone = "default",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  tone?: "default" | "dark";
}) {
  const dark = tone === "dark";

  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex rounded-md border p-0.5 ${
        dark ? "border-white/15 bg-white/10" : "border-line bg-panel"
      }`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded px-3 py-2 text-xs font-medium transition-colors ${
              active
                ? dark
                  ? "bg-white text-ink"
                  : "bg-ink text-paper"
                : dark
                  ? "text-white/60 hover:text-white"
                  : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-line bg-paper p-0.5"
        />
        <span className="font-mono text-xs uppercase text-muted">{value}</span>
      </span>
    </Field>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-paper px-2.5 py-2 text-sm text-ink placeholder:text-muted";
