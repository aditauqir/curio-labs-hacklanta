"use client";

import type {
  ComponentType,
  ForwardRefExoticComponent,
  ReactElement,
  ReactNode,
  RefAttributes,
} from "react";
import WarmTooltipImplementation, {
  WarmTooltipGroup as WarmTooltipGroupImplementation,
} from "./WarmTooltip";

export type WarmTooltipSide = "top" | "bottom" | "left" | "right";

export type WarmTooltipProps = {
  content: ReactNode;
  shortcut?: ReactNode;
  children: ReactElement;
  side?: WarmTooltipSide;
  delay?: number;
  warmWindow?: number;
  surfaceColor?: string;
  inkColor?: string;
  size?: "sm" | "md" | "lg";
  radius?: number;
  gap?: number;
  arrow?: boolean;
  popDuration?: number;
  popScale?: number;
  popBlur?: number;
  showFuse?: boolean;
  longPress?: number;
  disabled?: boolean;
  className?: string;
};

export type WarmTooltipGroupProps = {
  delay?: number;
  warmWindow?: number;
  travel?: number;
  lean?: number;
  onWarmChange?: (warm: boolean) => void;
  children: ReactNode;
};

export type WarmTooltipGroupHandle = { reset: () => void };

const WarmTooltip = WarmTooltipImplementation as ComponentType<WarmTooltipProps>;

export const WarmTooltipGroup = WarmTooltipGroupImplementation as ForwardRefExoticComponent<
  WarmTooltipGroupProps & RefAttributes<WarmTooltipGroupHandle>
>;

export default WarmTooltip;
