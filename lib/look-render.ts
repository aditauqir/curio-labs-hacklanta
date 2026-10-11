// Browser-only. Renders a reference look's tonal plate and texture finish onto canvases.
// This is a port of the consumption helpers in curio/assets/tools/apply_demo.py
// (halftone_apply, gradient_map, blend) so the web poster follows the same recipe
// numbers as the raster engine's example renders.
import type { DesignState } from "./design-types";
import { POSTER_HEIGHT, POSTER_WIDTH } from "./poster-layout";
import {
  getReferenceLook,
  lookAssetUrl,
  type LookBlend,
  type LookColor,
  type ReferenceLook,
  visibleLookTextures,
} from "./reference-looks";

/** The parts of a design the plate depends on. A full DesignState satisfies it. */
export type PlateDesign = {
  lookId: string;
  colors: Pick<DesignState["colors"], "background" | "foreground" | "accent">;
  layout: Pick<DesignState["layout"], "alignment">;
};

const W = POSTER_WIDTH;
const H = POSTER_HEIGHT;

const images = new Map<string, Promise<HTMLImageElement>>();
const thresholdMaps = new Map<string, Promise<Uint8Array>>();

export function loadLookImage(assetId: string) {
  let pending = images.get(assetId);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load look asset ${assetId}`));
      image.src = lookAssetUrl(assetId);
    });
    // A failed load should be retried next time rather than cached.
    pending.catch(() => images.delete(assetId));
    images.set(assetId, pending);
  }
  return pending;
}

function createCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  return canvas;
}

async function loadThresholdMap(assetId: string) {
  let pending = thresholdMaps.get(assetId);
  if (!pending) {
    pending = loadLookImage(assetId).then((image) => {
      const canvas = createCanvas();
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is not supported in this browser.");
      context.drawImage(image, 0, 0, W, H);
      const rgba = context.getImageData(0, 0, W, H).data;
      const map = new Uint8Array(W * H);
      for (let i = 0; i < map.length; i += 1) map[i] = rgba[i * 4];
      return map;
    });
    pending.catch(() => thresholdMaps.delete(assetId));
    thresholdMaps.set(assetId, pending);
  }
  return pending;
}

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
}

function resolveColor(color: LookColor, colors: PlateDesign["colors"]) {
  if (color === "background" || color === "foreground" || color === "accent") return colors[color];
  return color;
}

/** 256-entry gradient map, the same piecewise-linear interpolation as apply_demo.gradient_map. */
function gradientLut(look: ReferenceLook, colors: PlateDesign["colors"]) {
  const stops = look.plate.stops.map((stop) => ({ at: stop.at, rgb: hexToRgb(resolveColor(stop.color, colors)) }));
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let upper = stops.findIndex((stop) => stop.at >= t);
    if (upper <= 0) upper = upper === 0 ? 0 : stops.length - 1;
    const lower = Math.max(upper - 1, 0);
    const a = stops[lower];
    const b = stops[upper];
    const span = b.at - a.at;
    const k = span > 0 ? Math.min(Math.max((t - a.at) / span, 0), 1) : 0;
    for (let c = 0; c < 3; c += 1) lut[i * 3 + c] = a.rgb[c] + (b.rgb[c] - a.rgb[c]) * k;
  }
  return lut;
}

/** The orb sits on the side opposite the type so the headline stays on a quiet field. */
export function lookOrb(design: PlateDesign) {
  const { alignment } = design.layout;
  if (alignment === "center") return { cx: W / 2, cy: 1010, r: 270 };
  return { cx: alignment === "left" ? 820 : W - 820, cy: 930, r: 300 };
}

export function lookPlateKey(design: PlateDesign) {
  const { background, foreground, accent } = design.colors;
  return [design.lookId, background, foreground, accent, design.layout.alignment].join("|");
}

/**
 * Renders the screened plate at the 1080 x 1350 reference size, or null when the design has
 * no reference look. Larger exports scale this plate, as the engine scales its assets.
 */
export async function renderLookPlate(design: PlateDesign): Promise<HTMLCanvasElement | null> {
  const look = getReferenceLook(design.lookId);
  if (!look) return null;

  const map = look.screen ? await loadThresholdMap(look.screen.asset) : null;
  const softness = look.screen?.softness ?? 1;
  const lut = gradientLut(look, design.colors);
  const { field, orbLight, orbDark } = look.plate;
  const { cx, cy, r } = lookOrb(design);

  const canvas = createCanvas();
  const context = canvas.getContext("2d");
  if (!context) return null;
  const output = context.createImageData(W, H);
  const pixels = output.data;

  for (let y = 0; y < H; y += 1) {
    // A slight top-to-bottom falloff keeps the flat field from reading as a fill.
    const base = field + (0.5 - y / H) * 0.06;
    const dy = (y - cy) / r;
    for (let x = 0; x < W; x += 1) {
      let lum = base;
      const dx = (x - cx) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1.02) {
        // Lambert-shaded sphere lit from the upper left: the stand-in subject.
        const nz = Math.sqrt(Math.max(0, 1 - d2));
        const shade = Math.max(0, -0.45 * dx - 0.55 * dy + 0.7 * nz);
        const orb = orbDark + (orbLight - orbDark) * Math.min(shade, 1);
        const edge = Math.min(Math.max(((1 - Math.sqrt(d2)) * r) / 1.5, 0), 1);
        lum = lum * (1 - edge) + orb * edge;
      }
      const i = y * W + x;
      const value = Math.min(Math.max(lum, 0), 1) * 255;
      // halftone_apply: light where luminance is above the threshold map, with a soft edge.
      const t = map ? Math.min(Math.max((value - map[i]) / softness + 0.5, 0), 1) : value / 255;
      const index = Math.round(t * 255) * 3;
      const o = i * 4;
      pixels[o] = lut[index];
      pixels[o + 1] = lut[index + 1];
      pixels[o + 2] = lut[index + 2];
      pixels[o + 3] = 255;
    }
  }

  context.putImageData(output, 0, 0);
  return canvas;
}

export type LookFinishLayer = {
  image: HTMLImageElement;
  blend: LookBlend;
  opacity: number;
  label: string;
};

export async function loadLookFinish(
  design: Pick<DesignState, "lookId" | "hiddenTextures">,
): Promise<LookFinishLayer[]> {
  const look = getReferenceLook(design.lookId);
  if (!look) return [];
  return Promise.all(
    visibleLookTextures(look, design.hiddenTextures).map(async (texture) => ({
      image: await loadLookImage(texture.asset),
      blend: texture.blend,
      opacity: texture.opacity,
      label: texture.label,
    })),
  );
}

/** Draws the finish over everything below it. Canvas and CSS share these blend-mode names. */
export function drawLookFinish(context: CanvasRenderingContext2D, layers: readonly LookFinishLayer[]) {
  for (const layer of layers) {
    context.save();
    context.globalCompositeOperation = layer.blend;
    context.globalAlpha = layer.opacity;
    context.drawImage(layer.image, 0, 0, W, H);
    context.restore();
  }
}
