/**
 * free-text.ts
 *
 * Free text: words written straight onto the page, with no bubble. Distinct
 * from comments (`text-bubble.ts`), which are notes with a tail.
 *
 * The canvas renderer, hit testing, and the DOM composer all use the layout
 * here, so a line does not move when the composer commits it. Text is laid
 * out line by line as typed (no wrapping): free text is for labels and
 * headings, and the writer decides where lines break.
 *
 * Fonts are system stacks only. Capann makes no network requests, so nothing
 * is downloaded; each stack ends in a generic family that always exists.
 */

import type { FreeTextAnnotation, Point, TextFont } from "../shared/types";
import { screenPoint, spaceScale } from "./page-space";

export const TEXT_FONTS: { id: TextFont; label: string; stack: string; weight: number }[] = [
  {
    id: "sans",
    label: "Sans",
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    weight: 600,
  },
  {
    id: "serif",
    label: "Serif",
    stack: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
    weight: 600,
  },
  {
    id: "mono",
    label: "Mono",
    stack: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    weight: 600,
  },
  {
    // Handwriting faces ship with macOS and Windows; `cursive` covers the rest.
    id: "hand",
    label: "Hand",
    stack: '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Ink Free", "Comic Sans MS", cursive',
    weight: 400,
  },
];

export const FREE_TEXT = {
  lineHeightRatio: 1.25,
  minFontSize: 10,
  maxFontSize: 220,
  /** Extra hit area around the text box, page px. */
  hitPadding: 6,
} as const;

function fontSpec(font: TextFont) {
  return TEXT_FONTS.find((f) => f.id === font) ?? TEXT_FONTS[0]!;
}

/** Canvas font shorthand; the composer uses the same family, size, and weight. */
export function freeTextFont(font: TextFont, fontSize: number): string {
  const spec = fontSpec(font);
  return `${spec.weight} ${fontSize}px ${spec.stack}`;
}

export function clampFreeFontSize(size: number): number {
  return Math.round(
    Math.min(FREE_TEXT.maxFontSize, Math.max(FREE_TEXT.minFontSize, size)),
  );
}

/** The panel's size slider (1–100) -> font size. 4 (the default) is 18px. */
export function freeFontSizeForWidth(width: number): number {
  return clampFreeFontSize(12 + width * 1.5);
}

/** Inverse of `freeFontSizeForWidth`, for showing a selected text's size. */
export function widthForFreeFontSize(fontSize: number): number {
  return Math.min(100, Math.max(1, Math.round((fontSize - 12) / 1.5)));
}

export function freeLineHeight(fontSize: number): number {
  return Math.round(fontSize * FREE_TEXT.lineHeightRatio);
}

let measureContext: CanvasRenderingContext2D | null = null;

function measure(text: string, font: TextFont, fontSize: number): number {
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * fontSize * 0.6;
  measureContext.font = freeTextFont(font, fontSize);
  return measureContext.measureText(text).width;
}

export interface FreeTextLayout {
  lines: string[];
  lineHeight: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function freeTextLayout(ann: Pick<FreeTextAnnotation, "text" | "font" | "fontSize" | "position">): FreeTextLayout {
  const lines = ann.text.split("\n");
  const lineHeight = freeLineHeight(ann.fontSize);
  const width = Math.max(
    ann.fontSize * 0.5,
    ...lines.map((line) => measure(line, ann.font, ann.fontSize)),
  );
  const height = lineHeight * lines.length;
  return {
    lines,
    lineHeight,
    width,
    height,
    left: ann.position.x,
    top: ann.position.y,
    right: ann.position.x + width,
    bottom: ann.position.y + height,
  };
}

export function drawFreeText(ctx: CanvasRenderingContext2D, ann: FreeTextAnnotation): void {
  if (!ann.text.trim()) return;
  const layout = freeTextLayout(ann);
  ctx.save();
  ctx.fillStyle = ann.color;
  ctx.font = freeTextFont(ann.font, ann.fontSize);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  layout.lines.forEach((line, index) => {
    ctx.fillText(
      line,
      layout.left,
      layout.top + layout.lineHeight * index + layout.lineHeight / 2,
    );
  });
  ctx.restore();
}

/** Where a click puts a new text: the first line is centered on the pointer. */
export function freeTextOrigin(click: Point, fontSize: number): Point {
  return { x: click.x, y: click.y - freeLineHeight(fontSize) / 2 };
}

/**
 * Resize from one of the 8 selection handles. Text keeps its proportions, so
 * every handle scales the font; the opposite edge or corner stays put.
 */
export function resizeFreeText(
  ann: FreeTextAnnotation,
  handle: number,
  point: Point,
): FreeTextAnnotation {
  const b = freeTextLayout(ann);
  const oldW = Math.max(1, b.right - b.left);
  const oldH = Math.max(1, b.bottom - b.top);
  const movesLeft = handle === 0 || handle === 2 || handle === 6;
  const movesRight = handle === 1 || handle === 3 || handle === 7;
  const movesTop = handle === 0 || handle === 1 || handle === 4;
  const movesBottom = handle === 2 || handle === 3 || handle === 5;

  const kx = movesLeft ? (b.right - point.x) / oldW : movesRight ? (point.x - b.left) / oldW : 0;
  const ky = movesTop ? (b.bottom - point.y) / oldH : movesBottom ? (point.y - b.top) / oldH : 0;
  const k = Math.max(0.05, kx && ky ? Math.max(kx, ky) : kx || ky || 1);
  const fontSize = clampFreeFontSize(ann.fontSize * k);
  const scaled = freeTextLayout({ ...ann, fontSize });
  const x = movesLeft ? b.right - scaled.width : b.left;
  const y = movesTop ? b.bottom - scaled.height : b.top;
  return { ...ann, fontSize, position: { x, y } };
}

/** The DOM composer for free text. OverlayApp owns commit and history. */
export interface FreeTextComposer {
  input: HTMLTextAreaElement;
  /** Page (or image) position of the first line's top-left. */
  position: Point;
  existingId: string | null;
  color: string;
  font: TextFont;
  fontSize: number;
  /** Re-place and re-size after typing, scrolling, or a style change. */
  layout: () => void;
}

export function createFreeTextComposer(
  root: ShadowRoot,
  options: {
    position: Point;
    existingId: string | null;
    text: string;
    color: string;
    font: TextFont;
    fontSize: number;
  },
): FreeTextComposer {
  const input = document.createElement("textarea");
  input.className = "free-text-composer";
  input.value = options.text;
  input.placeholder = "Type here";
  input.spellcheck = false;
  input.wrap = "off";
  input.rows = 1;
  input.setAttribute("aria-label", "Text");

  const composer: FreeTextComposer = {
    input,
    position: options.position,
    existingId: options.existingId,
    color: options.color,
    font: options.font,
    fontSize: options.fontSize,
    layout: () => {
      const spec = fontSpec(composer.font);
      const scale = spaceScale();
      const lineHeight = freeLineHeight(composer.fontSize);
      const text = input.value || input.placeholder;
      const layout = freeTextLayout({
        text,
        font: composer.font,
        fontSize: composer.fontSize,
        position: composer.position,
      });
      const screen = screenPoint(composer.position);
      input.style.left = `${screen.x}px`;
      input.style.top = `${screen.y}px`;
      // Layout happens in page units; the transform matches the canvas scale
      // (1 on the page, the fit scale on a screenshot).
      input.style.transform = scale === 1 ? "" : `scale(${scale})`;
      input.style.font = `${spec.weight} ${composer.fontSize}px ${spec.stack}`;
      input.style.lineHeight = `${lineHeight}px`;
      input.style.color = composer.color;
      input.style.caretColor = composer.color;
      // Room for the caret after the last character.
      input.style.width = `${Math.ceil(layout.width + composer.fontSize * 0.6)}px`;
      input.style.height = `${layout.height}px`;
    },
  };

  input.addEventListener("input", composer.layout);
  root.append(input);
  composer.layout();
  return composer;
}
