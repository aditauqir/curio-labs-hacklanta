"use client";

import type { ComponentType, ReactNode } from "react";
import GlideSelectImplementation from "./GlideSelect";

export type GlideSelectOption = {
  value: string;
  label: ReactNode;
  tag?: string;
};

export type GlideSelectProps = {
  options?: (string | GlideSelectOption)[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, option: GlideSelectOption) => void;
  placeholder?: string;
  showTags?: boolean;
  accentColor?: string;
  surfaceColor?: string;
  highlightColor?: string;
  textColor?: string;
  size?: "sm" | "md" | "lg";
  radius?: number;
  menuWidth?: number;
  placement?: "top" | "bottom";
  align?: "left" | "right";
  popDuration?: number;
  glideDuration?: number;
  rememberPosition?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

const GlideSelect = GlideSelectImplementation as ComponentType<GlideSelectProps>;

export default GlideSelect;
