/**
 * screenshot-style.ts
 *
 * The frame around a screenshot: background, padding, corner radius, shadow,
 * and border. Shared by three places that must agree pixel for pixel:
 *
 * - the in-page screenshot editor's live preview (content script)
 * - the exported PNG (content script, full resolution)
 * - the side panel's controls and swatches (extension page)
 *
 * The style is a preference in `chrome.storage.local`, so the side panel edits
 * it and the page re-renders from `storage.onChanged`. Nothing else crosses
 * between the two.
 *
 * All lengths are in the screenshot's own CSS pixels, so a frame looks the
 * same in the preview (scaled to fit the screen) and in the export.
 */

export type ShadowLevel = "none" | "soft" | "strong";
export type BorderWidth = "none" | "thin" | "thick";
export type BorderTone = "light" | "dark";

export interface ScreenshotStyle {
  /** A background id from BACKGROUNDS, or a custom "#RRGGBB". */
  background: string;
  padding: number;
  radius: number;
  shadow: ShadowLevel;
  border: BorderWidth;
  borderTone: BorderTone;
}

export interface Background {
  id: string;
  label: string;
  /** null = transparent; one color = solid; two = 135° gradient. */
  fill: null | string | [string, string];
}

/** Minimal by design: soft solids, a few quiet gradients, and none. */
export const BACKGROUNDS: Background[] = [
  { id: "none", label: "None", fill: null },
  { id: "mist", label: "Mist", fill: "#E8EDF4" },
  { id: "sand", label: "Sand", fill: "#F2EADF" },
  { id: "blush", label: "Blush", fill: "#F6E4E2" },
  { id: "sage", label: "Sage", fill: "#E2EEE5" },
  { id: "lilac", label: "Lilac", fill: "#ECE6FA" },
  { id: "slate", label: "Slate", fill: "#2B2E36" },
  { id: "ink", label: "Ink", fill: "#141417" },
  { id: "dawn", label: "Dawn", fill: ["#FBD7C9", "#E9D5FF"] },
  { id: "lagoon", label: "Lagoon", fill: ["#C7F0E3", "#BFD7FF"] },
  { id: "violet", label: "Violet", fill: ["#A78BFA", "#6366F1"] },
  { id: "dusk", label: "Dusk", fill: ["#1E1B2E", "#3B2F5C"] },
];

export const DEFAULT_SCREENSHOT_STYLE: ScreenshotStyle = {
  background: "lilac",
  padding: 56,
  radius: 12,
  shadow: "soft",
  border: "none",
  borderTone: "light",
};

export const PADDING_MAX = 160;
export const RADIUS_MAX = 32;

export const SCREENSHOT_STYLE_KEY = "capann_shot_style";
/** chrome.storage.session: which side panel tab to show (written by the worker). */
export const SIDE_PANEL_SECTION_KEY = "capann_sidepanel_section";

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (value: unknown, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(0, Math.round(value)))
    : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/** Repairs anything stored by an older version or edited by hand. */
export function normalizeStyle(raw: unknown): ScreenshotStyle {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<ScreenshotStyle>;
  const d = DEFAULT_SCREENSHOT_STYLE;
  const background =
    typeof value.background === "string" &&
    (HEX.test(value.background) || BACKGROUNDS.some((b) => b.id === value.background))
      ? value.background
      : d.background;
  return {
    background,
    padding: clamp(value.padding, PADDING_MAX, d.padding),
    radius: clamp(value.radius, RADIUS_MAX, d.radius),
    shadow: oneOf(value.shadow, ["none", "soft", "strong"] as const, d.shadow),
    border: oneOf(value.border, ["none", "thin", "thick"] as const, d.border),
    borderTone: oneOf(value.borderTone, ["light", "dark"] as const, d.borderTone),
  };
}

export async function loadScreenshotStyle(): Promise<ScreenshotStyle> {
  const stored = await chrome.storage.local.get(SCREENSHOT_STYLE_KEY);
  return normalizeStyle(stored[SCREENSHOT_STYLE_KEY]);
}

export async function saveScreenshotStyle(style: ScreenshotStyle): Promise<void> {
  await chrome.storage.local.set({ [SCREENSHOT_STYLE_KEY]: normalizeStyle(style) });
}

export function backgroundFill(style: ScreenshotStyle): Background["fill"] {
  if (HEX.test(style.background)) return style.background;
  return BACKGROUNDS.find((b) => b.id === style.background)?.fill ?? null;
}

/** CSS for a swatch or preview of a background. "None" shows a checkerboard. */
export function backgroundCss(fill: Background["fill"]): string {
  if (fill === null)
    return "repeating-conic-gradient(#3A3A40 0% 25%, #26262B 0% 50%) 0 0 / 10px 10px";
  if (typeof fill === "string") return fill;
  return `linear-gradient(135deg, ${fill[0]}, ${fill[1]})`;
}

export function borderPx(style: ScreenshotStyle): number {
  return style.border === "thick" ? 6 : style.border === "thin" ? 2 : 0;
}

export interface FrameLayout {
  /** Whole output, image px. */
  width: number;
  height: number;
  /** Where the screenshot sits inside it. */
  image: { x: number; y: number; width: number; height: number };
}

/** The border sits outside the image, so it shows even with no padding. */
export function frameLayout(
  imageWidth: number,
  imageHeight: number,
  style: ScreenshotStyle,
): FrameLayout {
  const inset = style.padding + borderPx(style);
  return {
    width: imageWidth + inset * 2,
    height: imageHeight + inset * 2,
    image: { x: inset, y: inset, width: imageWidth, height: imageHeight },
  };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

/**
 * Draws background, shadow, the screenshot, and its border. The context must
 * already map one unit to one image CSS pixel (with the frame's top-left at
 * 0,0). `pixelScale` is that transform's scale in device pixels: canvas
 * shadows ignore the transform, so they are scaled by hand.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceRect: { x: number; y: number; width: number; height: number },
  layout: FrameLayout,
  style: ScreenshotStyle,
  pixelScale: number,
): void {
  const fill = backgroundFill(style);
  ctx.save();
  if (fill !== null) {
    if (typeof fill === "string") {
      ctx.fillStyle = fill;
    } else {
      const gradient = ctx.createLinearGradient(0, 0, layout.width, layout.height);
      gradient.addColorStop(0, fill[0]);
      gradient.addColorStop(1, fill[1]);
      ctx.fillStyle = gradient;
    }
    ctx.fillRect(0, 0, layout.width, layout.height);
  }

  const { x, y, width, height } = layout.image;
  const border = borderPx(style);
  // The border ring follows the image's corners, offset outward.
  const outerRadius = style.radius > 0 ? style.radius + border : 0;

  if (style.shadow !== "none") {
    ctx.save();
    const strong = style.shadow === "strong";
    ctx.shadowColor = strong ? "rgba(0,0,0,0.42)" : "rgba(0,0,0,0.22)";
    ctx.shadowBlur = (strong ? 48 : 28) * pixelScale;
    ctx.shadowOffsetY = (strong ? 18 : 10) * pixelScale;
    ctx.fillStyle = "#000";
    roundedRect(ctx, x - border, y - border, width + border * 2, height + border * 2, outerRadius);
    ctx.fill();
    ctx.restore();
  }

  if (border > 0) {
    ctx.fillStyle =
      style.borderTone === "light" ? "rgba(255,255,255,0.92)" : "rgba(10,10,12,0.92)";
    roundedRect(ctx, x - border, y - border, width + border * 2, height + border * 2, outerRadius);
    ctx.fill();
  }

  ctx.save();
  roundedRect(ctx, x, y, width, height, style.radius);
  ctx.clip();
  ctx.drawImage(
    source,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    x,
    y,
    width,
    height,
  );
  ctx.restore();
  ctx.restore();
}
