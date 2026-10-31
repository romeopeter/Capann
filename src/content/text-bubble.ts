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

/**
 * Tail triangle. On top/bottom edges `baseLeft.x < baseRight.x`; on
 * left/right edges `baseLeft` is the upper base point (`baseLeft.y <
 * baseRight.y`).
 */
export interface BubbleTail {
  baseLeft: Point;
  baseRight: Point;
  tip: Point;
  side: "top" | "bottom" | "left" | "right";
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

/**
 * Tail for a bubble whose body is pinned (the tip was dragged). The tail
 * leaves from whichever edge faces the tip — the comparison is normalized by
 * the half-size so a wide bubble doesn't always pick top/bottom — with its
 * base slid along that edge toward the tip but kept clear of the corners.
 * Returns null when the tip is inside the body.
 */
export function attachTail(anchor: Point, body: BubbleBody): BubbleTail | null {
  const { radius, tailHalf } = TEXT_BUBBLE;
  const w = body.right - body.left;
  const h = body.bottom - body.top;
  if (
    anchor.x > body.left - 2 &&
    anchor.x < body.right + 2 &&
    anchor.y > body.top - 2 &&
    anchor.y < body.bottom + 2
  )
    return null;
  const dx = anchor.x - (body.left + w / 2);
  const dy = anchor.y - (body.top + h / 2);
  const halfBase = (edge: number) =>
    Math.max(0, Math.min(tailHalf, (edge - 2 * radius) / 2));
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
  const tip = { x: anchor.x, y: anchor.y };

  if (Math.abs(dy) / (h / 2) >= Math.abs(dx) / (w / 2) || halfBase(h) < 4) {
    const half = halfBase(w);
    const y = dy < 0 ? body.top : body.bottom;
    const c = clamp(anchor.x, body.left + radius + half, body.right - radius - half);
    return {
      baseLeft: { x: c - half, y },
      baseRight: { x: c + half, y },
      tip,
      side: dy < 0 ? "top" : "bottom",
    };
  }
  const half = halfBase(h);
  const x = dx < 0 ? body.left : body.right;
  const c = clamp(anchor.y, body.top + radius + half, body.bottom - radius - half);
  return {
    baseLeft: { x, y: c - half },
    baseRight: { x, y: c + half },
    tip,
    side: dx < 0 ? "left" : "right",
  };
}

/**
 * Body + tail for a comment: pinned at `bubble` when the tip has been dragged,
 * otherwise placed automatically around the tip. The composer and the
 * committed bubble both go through this, so a note never jumps on commit.
 */
export function placeComment(
  anchor: Point,
  width: number,
  height: number,
  bubble: Point | undefined,
  viewport: BubbleViewport = defaultViewport(),
): BubblePlacement {
  if (!bubble) return placeTextBubble(anchor, width, height, viewport);
  const w = clampWidth(width);
  const body: BubbleBody = {
    left: bubble.x,
    top: bubble.y,
    right: bubble.x + w,
    bottom: bubble.y + Math.max(1, height),
  };
  return { body, tail: attachTail(anchor, body) };
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
  const placement = placeComment(
    ann.position,
    width,
    height,
    ann.bubble,
    viewport,
  );
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

/** Re-express a page-space tail relative to the bubble body's top-left. */
export function localTail(tail: BubbleTail, body: BubbleBody): BubbleTail {
  const local = (p: Point): Point => ({ x: p.x - body.left, y: p.y - body.top });
  return {
    baseLeft: local(tail.baseLeft),
    baseRight: local(tail.baseRight),
    tip: local(tail.tip),
    side: tail.side,
  };
}

/**
 * Bubble body and tail as ONE closed outline in local space. Filling and
 * stroking a single path leaves no border across the tail base — drawing the
 * rounded rect and the triangle separately always left a seam there, since
 * the translucent fill cannot fully cover the body's own stroke.
 *
 * The tail base always sits on the straight part of its edge (placement keeps
 * it clear of the corner radii), so it splices in between corners on any of
 * the four sides.
 */
export function bubbleOutlinePath(
  width: number,
  height: number,
  tail: BubbleTail | null,
  radius: number = TEXT_BUBBLE.radius,
): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const parts = [`M ${format(r)} 0`];
  // Top edge runs left -> right.
  if (tail?.side === "top")
    parts.push(
      `H ${format(tail.baseLeft.x)}`,
      `L ${format(tail.tip.x)} ${format(tail.tip.y)}`,
      `L ${format(tail.baseRight.x)} 0`,
    );
  parts.push(
    `H ${format(w - r)}`,
    `A ${format(r)} ${format(r)} 0 0 1 ${format(w)} ${format(r)}`,
  );
  // Right edge runs top -> bottom.
  if (tail?.side === "right")
    parts.push(
      `V ${format(tail.baseLeft.y)}`,
      `L ${format(tail.tip.x)} ${format(tail.tip.y)}`,
      `L ${format(w)} ${format(tail.baseRight.y)}`,
    );
  parts.push(
    `V ${format(h - r)}`,
    `A ${format(r)} ${format(r)} 0 0 1 ${format(w - r)} ${format(h)}`,
  );
  // Bottom edge runs right -> left.
  if (tail?.side === "bottom")
    parts.push(
      `H ${format(tail.baseRight.x)}`,
      `L ${format(tail.tip.x)} ${format(tail.tip.y)}`,
      `L ${format(tail.baseLeft.x)} ${format(h)}`,
    );
  parts.push(
    `H ${format(r)}`,
    `A ${format(r)} ${format(r)} 0 0 1 0 ${format(h - r)}`,
  );
  // Left edge runs bottom -> top.
  if (tail?.side === "left")
    parts.push(
      `V ${format(tail.baseRight.y)}`,
      `L ${format(tail.tip.x)} ${format(tail.tip.y)}`,
      `L 0 ${format(tail.baseLeft.y)}`,
    );
  parts.push(
    `V ${format(r)}`,
    `A ${format(r)} ${format(r)} 0 0 1 ${format(r)} 0`,
    "Z",
  );
  return parts.join(" ");
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
