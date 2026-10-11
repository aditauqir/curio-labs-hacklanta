import type { DesignDirection, DesignState } from "./design-types";
import { directionConfigs, directionOrder } from "./design-presets";
import type { StudioAction } from "./design-state";
import { wantsLayoutKept } from "./ai-patch";

export type DirectorResult = {
  reply: string;
  actions: StudioAction[];
  changes: string[];
  suggestions?: DesignDirection[];
};

const ACCENT_COLORS: Record<string, string> = {
  orange: "#CC5500",
  red: "#B8322A",
  blue: "#2F5D9E",
  green: "#3F7D58",
  yellow: "#E0A800",
  pink: "#D6577E",
  purple: "#6A4C93",
  lime: "#C9F05D",
  black: "#171717",
};

const VINTAGE = /\b(warm|warmer|vintage|retro|cozy|1970s|70s|smoky)\b/;
const MINIMAL = /\b(minimal|minimalist|swiss|clean|cleaner|simple|modern|contemporary|sleek)\b/;
const EXPERIMENTAL = /\b(experimental|bold|bolder|dark|edgy|loud|electric|night)\b/;

function breakHeadline(value: string) {
  const words = value.trim().split(/\s+/);
  if (words.length < 2 || value.length <= 10) return value.trim();
  const middle = Math.ceil(words.length / 2);
  return `${words.slice(0, middle).join(" ")}\n${words.slice(middle).join(" ")}`;
}

/**
 * Local rule-based interpreter used when no AI provider is configured.
 * It is deliberately simple and only touches the properties a request names.
 */
export function interpretRequest(input: string, design: DesignState): DirectorResult {
  const text = input.toLowerCase();
  const keepLayout = wantsLayoutKept(input);
  const actions: StudioAction[] = [];
  const changes: string[] = [];

  const family = VINTAGE.test(text)
    ? "vintage"
    : EXPERIMENTAL.test(text)
      ? "experimental"
      : MINIMAL.test(text)
        ? "minimal"
        : null;

  if (family && keepLayout) {
    const config = directionConfigs[family];
    actions.push({ type: "setPalette", id: config.paletteId });
    actions.push({ type: "setFontPair", id: config.fontPairId });
    changes.push(`Colors: ${config.paletteId.replace("-", " ")}`, "Typography updated");
  } else if (family) {
    actions.push({ type: "setDirection", direction: family });
    changes.push(`Direction: ${directionConfigs[family].label}`);
  }

  const colorWord = Object.keys(ACCENT_COLORS).find((word) => text.includes(word));
  if (colorWord) {
    actions.push({ type: "setColor", key: "accent", value: ACCENT_COLORS[colorWord] });
    changes.push(`Accent: ${colorWord}`);
  }

  if (!keepLayout) {
    if (/\b(center|centre|centered|centred)\b/.test(text)) {
      actions.push({ type: "setAlignment", value: "center" });
      changes.push("Alignment: centered");
    } else if (/\bright[- ]align/.test(text) || /align (it )?right/.test(text)) {
      actions.push({ type: "setAlignment", value: "right" });
      changes.push("Alignment: right");
    } else if (/\bleft[- ]align/.test(text) || /align (it )?left/.test(text)) {
      actions.push({ type: "setAlignment", value: "left" });
      changes.push("Alignment: left");
    }

    if (/\b(spacious|airy|more space|breathe)\b/.test(text)) {
      actions.push({ type: "setSpacing", value: "spacious" });
      changes.push("Spacing: spacious");
    } else if (/\b(compact|tight|tighter)\b/.test(text)) {
      actions.push({ type: "setSpacing", value: "compact" });
      changes.push("Spacing: compact");
    }
  }

  const headlineMatch = input.match(/(?:headline|title)\s*(?:to|as|:)?\s*["“']?([^"”'\n]{2,60})["”']?\s*$/i);
  if (headlineMatch) {
    actions.push({ type: "setCopy", key: "headline", value: breakHeadline(headlineMatch[1]) });
    changes.push(`Headline: ${headlineMatch[1].trim()}`);
  }

  if (actions.length === 0) {
    return {
      reply: `I can't tell which direction you want from that yet. Pick one of these, or describe a change like "warmer", "centered", "orange accent", or "headline: Late Night Sessions". Currently using ${design.styleLabel}.`,
      actions,
      changes,
      suggestions: [...directionOrder],
    };
  }

  const scope = keepLayout ? " The layout was kept as it was." : " Everything else is unchanged.";
  return {
    reply: `Applied ${changes.length} ${changes.length === 1 ? "change" : "changes"}.${scope}`,
    actions,
    changes,
  };
}
