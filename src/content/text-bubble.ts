/**
 * text-bubble.ts
 *
 * Shared layout, text wrapping, and path building for text annotations that
 * render as comment-style bubbles. Both the committed canvas renderer and the
 * DOM composer use this module, so a note does not move or reflow when it is
 * committed.
 */

import type { Point, TextAnnotation } from "../shared/types";

export const TEXT_BUBBLE = {
  defaultWidth: 280,
  minWidth: 140,
  maxWidth: 280,
  padding: 12,
  radius: 14,
  tailLength: 10,
  tailHalf: 9,
  margin: 8,
  minFontSize: 13,
  maxFontSize: 28,
  lineHeightRatio: 1.35,
  maxComposerLines: 6,
  fontBaseWidth: 4,
  fontPerWidth: 0.16,
} as const;

export interface BubbleViewport {
  width: number;
  height: number;
}

export interface BubbleBody {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BubbleTail {
  baseLeft: Point;
  baseRight: Point;
  tip: Point;
  side: "top" | "bottom";
}

export interface BubblePlacement {
  body: BubbleBody;
  tail: BubbleTail | null;
}

export interface BubbleLayout extends BubblePlacement {
  lines: string[];
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  padding: number;
}

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Canvas font shorthand matching the composer's CSS font. */
export function bubbleFont(fontSize: number): string {
  return `500 ${fontSize}px ${FONT_STACK}`;
}

/** Map the toolbar size slider to a readable callout font size. */
export function textFontSize(strokeWidth: number): number {
  const raw =
    TEXT_BUBBLE.minFontSize +
    Math.max(0, strokeWidth - TEXT_BUBBLE.fontBaseWidth) *
      TEXT_BUBBLE.fontPerWidth;
  return clampFontSize(raw);
}

/**
 * Inverse of textFontSize, so the size slider reflects a bubble that was
 * scaled with a corner or top/bottom handle.
 */
export function textStrokeForFont(fontSize: number): number {
  const font = clampFontSize(fontSize);
  return Math.max(
    TEXT_BUBBLE.fontBaseWidth,
    Math.round(
      TEXT_BUBBLE.fontBaseWidth +
        (font - TEXT_BUBBLE.minFontSize) / TEXT_BUBBLE.fontPerWidth,
    ),
  );
}

export function clampFontSize(size: number): number {
  const value = Number.isFinite(size) ? size : TEXT_BUBBLE.minFontSize;
  return Math.round(
    Math.min(TEXT_BUBBLE.maxFontSize, Math.max(TEXT_BUBBLE.minFontSize, value)),
  );
}

export function clampWidth(width: number): number {
  const value = Number.isFinite(width)
    ? width
    : TEXT_BUBBLE.defaultWidth;
  return Math.round(
    Math.min(TEXT_BUBBLE.maxWidth, Math.max(TEXT_BUBBLE.minWidth, value)),
  );
}

export function composerMaxHeight(fontSize: number): number {
  return (
    TEXT_BUBBLE.maxComposerLines *
      Math.round(fontSize * TEXT_BUBBLE.lineHeightRatio) +
    TEXT_BUBBLE.padding * 2
  );
}

/** Pick a readable icon color for a filled accent button. */
export function contrastColor(hex: string): string {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return "#F5F5F7";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? "#17131F" : "#F5F5F7";
}

let measureCanvas: HTMLCanvasElement | null = null;
let measureContext: CanvasRenderingContext2D | null = null;

function measureText(text: string, fontSize: number): number {
  if (typeof document === "undefined") {
    return text.length * fontSize * 0.58;
  }
  if (!measureContext) {
    measureCanvas = document.createElement("canvas");
    measureContext = measureCanvas.getContext("2d");
  }
  if (!measureContext) return text.length * fontSize * 0.58;
  measureContext.font = bubbleFont(fontSize);
  return measureContext.measureText(text).width;
}

/**
 * Greedy word wrap that also breaks unbroken words and preserves explicit
 * blank lines. Mirrors the textarea's wrapping closely enough that the
 * committed bubble keeps the same line count as the composer.
 */
export function wrapBubbleText(
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  const width = Math.max(24, maxWidth);
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  const breakWord = (word: string): string => {
    let line = "";
    for (const char of word) {
      const next = line + char;
      if (line && measureText(next, fontSize) > width) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    return line;
  };

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureText(candidate, fontSize) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      line =
        measureText(word, fontSize) <= width ? word : breakWord(word);
    }
    if (line) lines.push(line);
  }

  return lines.length > 0 ? lines : [""];
}

function defaultViewport(): BubbleViewport {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  return {
    width: window.innerWidth || 1024,
    height: window.innerHeight || 768,
  };
}

/**
 * Place a bubble body above the anchor (the tail tip) and return the tail
 * geometry. The near corner tucks under the anchor so the tail is a solid
 * little triangle rather than a long diagonal sliver; the bubble flips sides
 * when there is not enough room and clamps to the viewport.
 */
export function placeTextBubble(
  anchor: Point,
  width: number,
  height: number,
  viewport: BubbleViewport = defaultViewport(),
): BubblePlacement {
  const { margin, tailLength, tailHalf, radius } = TEXT_BUBBLE;
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const w = clampWidth(width);
  const h = Math.max(1, height);
  // Put the rounded corner's end (radius + half the tail base) exactly under
  // the anchor, so the tail base is centered on the click point.
  const nearInset = radius + tailHalf;

  const aboveFits = anchor.y - tailLength - h >= margin;
  const belowFits = anchor.y + tailLength + h <= vh - margin;
  let above = aboveFits;
  if (!aboveFits && !belowFits) above = anchor.y >= vh / 2;

  const rightFits = anchor.x - nearInset + w <= vw - margin;
  const leftFits = anchor.x - w + nearInset >= margin;
  let toRight = rightFits;
  if (!rightFits && !leftFits) toRight = anchor.x <= vw / 2;

  const desiredLeft = toRight
    ? anchor.x - nearInset
    : anchor.x - w + nearInset;
  const desiredTop = above
    ? anchor.y - tailLength - h
    : anchor.y + tailLength;

  const maxLeft = Math.max(margin, vw - margin - w);
  const maxTop = Math.max(margin, vh - margin - h);
  const left = Math.min(Math.max(desiredLeft, margin), maxLeft);
  const top = Math.min(Math.max(desiredTop, margin), maxTop);
  const body: BubbleBody = {
    left,
    top,
    right: left + w,
    bottom: top + h,
  };

  const verticalGap = above ? anchor.y - body.bottom : body.top - anchor.y;
  const tipInside =
    anchor.x > body.left + 2 &&
    anchor.x < body.right - 2 &&
    anchor.y > body.top + 2 &&
    anchor.y < body.bottom - 2;

  let tail: BubbleTail | null = null;
  if (!tipInside && verticalGap >= 4) {
    const baseY = above ? body.bottom : body.top;
    const minCenter = body.left + radius + tailHalf;
    const maxCenter = body.right - radius - tailHalf;
    const center = Math.min(
      Math.max(anchor.x, Math.min(minCenter, maxCenter)),
      Math.max(minCenter, maxCenter),
    );
    tail = {
      baseLeft: { x: center - tailHalf, y: baseY },
      baseRight: { x: center + tailHalf, y: baseY },
      tip: { x: anchor.x, y: anchor.y },
      side: above ? "bottom" : "top",
    };
  }

  return { body, tail };
}

/** Full committed layout for a text annotation. */
export function textBubbleLayout(
  ann: TextAnnotation,
  viewport: BubbleViewport = defaultViewport(),
): BubbleLayout {
  const width = clampWidth(ann.width ?? TEXT_BUBBLE.defaultWidth);
  const fontSize = clampFontSize(ann.fontSize);
  const padding = TEXT_BUBBLE.padding;
  const contentWidth = Math.max(24, width - padding * 2);
  const lines = wrapBubbleText(ann.text, contentWidth, fontSize);
  const lineHeight = Math.max(
    1,
    Math.round(fontSize * TEXT_BUBBLE.lineHeightRatio),
  );
  const height = Math.max(1, lines.length) * lineHeight + padding * 2;
  const placement = placeTextBubble(ann.position, width, height, viewport);
  return {
    ...placement,
    lines,
    width,
    height,
    fontSize,
    lineHeight,
    padding,
  };
}

const format = (value: number): string =>
  (Math.round(value * 100) / 100).toString();

/** Rounded-rectangle SVG/canvas path in local (0,0)-(width,height) space. */
export function roundedRectPath(
  width: number,
  height: number,
  radius: number = TEXT_BUBBLE.radius,
): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  return [
    `M ${format(r)} 0`,
    `H ${format(w - r)}`,
    `A ${format(r)} ${format(r)} 0 0 1 ${format(w)} ${format(r)}`,
    `V ${format(h - r)}`,
    `A ${format(r)} ${format(r)} 0 0 1 ${format(w - r)} ${format(h)}`,
    `H ${format(r)}`,
    `A ${format(r)} ${format(r)} 0 0 1 0 ${format(h - r)}`,
    `V ${format(r)}`,
    `A ${format(r)} ${format(r)} 0 0 1 ${format(r)} 0`,
    "Z",
  ].join(" ");
}

/** Filled triangle for the bubble tail. */
export function tailTrianglePath(tail: BubbleTail): string {
  return [
    `M ${format(tail.baseLeft.x)} ${format(tail.baseLeft.y)}`,
    `L ${format(tail.tip.x)} ${format(tail.tip.y)}`,
    `L ${format(tail.baseRight.x)} ${format(tail.baseRight.y)}`,
    "Z",
  ].join(" ");
}

/** Open path for the two outer tail edges, so the border can continue. */
export function tailOutlinePath(tail: BubbleTail): string {
  return [
    `M ${format(tail.baseLeft.x)} ${format(tail.baseLeft.y)}`,
    `L ${format(tail.tip.x)} ${format(tail.tip.y)}`,
    `L ${format(tail.baseRight.x)} ${format(tail.baseRight.y)}`,
  ].join(" ");
}

function sign(point: Point, a: Point, b: Point): number {
  return (point.x - b.x) * (a.y - b.y) - (a.x - b.x) * (point.y - b.y);
}

/** Point-in-triangle test used for clicking a bubble's tail. */
export function triangleContains(
  point: Point,
  a: Point,
  b: Point,
  c: Point,
): boolean {
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}
