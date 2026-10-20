/**
 * render.ts
 *
 * Canvas rendering engine for all annotation types.
 * Handles drawing strokes, arrows, shapes, and text to the HTML5 canvas.
 *
 * Key functions:
 * - drawAnnotation: Renders a single annotation object
 * - redrawAll: Clears and redraws the entire annotation layer
 * - drawTextHover: Subtle affordance shown when the text tool hovers a note
 * - Specialized renderers for each annotation type (stroke, arrow, shape, text)
 * - Arrow head rendering with multiple style options (triangle, chevron, stick)
 */

import type {
  AnnotationObject,
  ArrowAnnotation,
  ArrowHeadStyle,
  Point,
  ShapeAnnotation,
  StrokeAnnotation,
  TextAnnotation,
} from "../shared/types";
import {
  bubbleFont,
  roundedRectPath,
  tailOutlinePath,
  tailTrianglePath,
  textBubbleLayout,
} from "./text-bubble";

function drawStroke(
  ctx: CanvasRenderingContext2D,
  ann: StrokeAnnotation,
): void {
  if (ann.points.length < 2) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = ann.strokeWidth;
  ctx.globalAlpha = ann.type === "highlighter" ? 0.35 : 1;
  ctx.beginPath();
  const [first, ...rest] = ann.points;
  ctx.moveTo(first!.x, first!.y);
  for (const p of rest) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number,
  style: ArrowHeadStyle,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = Math.max(10, size * 4);
  const spread = Math.PI / 7;

  ctx.beginPath();
  if (style === "triangle" || style === "bender") {
    const left: Point = {
      x: to.x - headLength * Math.cos(angle - spread),
      y: to.y - headLength * Math.sin(angle - spread),
    };
    const right: Point = {
      x: to.x - headLength * Math.cos(angle + spread),
      y: to.y - headLength * Math.sin(angle + spread),
    };
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();
  } else if (style === "chevron") {
    const left: Point = {
      x: to.x - headLength * Math.cos(angle - spread),
      y: to.y - headLength * Math.sin(angle - spread),
    };
    const right: Point = {
      x: to.x - headLength * Math.cos(angle + spread),
      y: to.y - headLength * Math.sin(angle + spread),
    };
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  } else {
    const left: Point = {
      x: to.x - headLength * 0.7 * Math.cos(angle - spread * 1.4),
      y: to.y - headLength * 0.7 * Math.sin(angle - spread * 1.4),
    };
    const right: Point = {
      x: to.x - headLength * 0.7 * Math.cos(angle + spread * 1.4),
      y: to.y - headLength * 0.7 * Math.sin(angle + spread * 1.4),
    };
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(to.x, to.y);
    ctx.moveTo(right.x, right.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, ann: ArrowAnnotation): void {
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = ann.strokeWidth;
  ctx.lineCap = "round";
  const bend = ann.bend ?? 0;
  if (ann.headStyle === "bender" || bend !== 0) {
    const c = arrowControlPoint(ann.start, ann.end, bend);
    ctx.beginPath();
    ctx.moveTo(ann.start.x, ann.start.y);
    ctx.quadraticCurveTo(c.x, c.y, ann.end.x, ann.end.y);
    ctx.stroke();
    // Head follows the end tangent of the curve, not the straight chord.
    const angle = Math.atan2(ann.end.y - c.y, ann.end.x - c.x);
    drawArrowHeadAt(ctx, ann.end, angle, ann.strokeWidth, "triangle");
  } else {
    ctx.beginPath();
    ctx.moveTo(ann.start.x, ann.start.y);
    ctx.lineTo(ann.end.x, ann.end.y);
    ctx.stroke();
    drawArrowHead(ctx, ann.start, ann.end, ann.strokeWidth, ann.headStyle);
  }
  ctx.restore();
}

/** Shared control-point math (mirrors geometry.ts, render-local copy). */
function arrowControlPoint(start: Point, end: Point, bend: number): Point {
  if (!bend) return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: (start.x + end.x) / 2 + (-dy / len) * bend,
    y: (start.y + end.y) / 2 + (dx / len) * bend,
  };
}

function drawArrowHeadAt(
  ctx: CanvasRenderingContext2D,
  to: Point,
  angle: number,
  size: number,
  style: ArrowHeadStyle,
): void {
  // Straight-shaft entry point: project back along the head angle.
  const from = { x: to.x - Math.cos(angle), y: to.y - Math.sin(angle) };
  drawArrowHead(ctx, from, to, size, style);
}

function drawShape(ctx: CanvasRenderingContext2D, ann: ShapeAnnotation): void {
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = ann.strokeWidth;
  const left = Math.min(ann.start.x, ann.end.x);
  const top = Math.min(ann.start.y, ann.end.y);
  const width = Math.abs(ann.end.x - ann.start.x);
  const height = Math.abs(ann.end.y - ann.start.y);

  ctx.beginPath();
  if (ann.type === "rectangle") {
    ctx.rect(left, top, width, height);
  } else {
    ctx.ellipse(
      left + width / 2,
      top + height / 2,
      width / 2,
      height / 2,
      0,
      0,
      Math.PI * 2,
    );
  }
  if (ann.filled) {
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  } else {
    ctx.stroke();
  }
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, ann: TextAnnotation): void {
  const layout = textBubbleLayout(ann);
  const {
    body,
    tail,
    width,
    height,
    lines,
    fontSize,
    lineHeight,
    padding,
  } = layout;
  const localTail = tail
    ? {
        baseLeft: {
          x: tail.baseLeft.x - body.left,
          y: tail.baseLeft.y - body.top,
        },
        baseRight: {
          x: tail.baseRight.x - body.left,
          y: tail.baseRight.y - body.top,
        },
        tip: {
          x: tail.tip.x - body.left,
          y: tail.tip.y - body.top,
        },
        side: tail.side,
      }
    : null;

  ctx.save();
  ctx.translate(body.left, body.top);

  const bodyPath = new Path2D(roundedRectPath(width, height));

  // One shadow pass covers the body and the tail silhouette.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "rgba(28,28,32,0.96)";
  ctx.fill(bodyPath);
  if (localTail) {
    ctx.fillStyle = ann.color;
    ctx.fill(new Path2D(tailTrianglePath(localTail)));
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke(bodyPath);

  if (localTail) {
    // Re-fill after the body stroke so the tail base does not show a seam,
    // then outline only the two outer edges to continue the border.
    ctx.fillStyle = ann.color;
    ctx.fill(new Path2D(tailTrianglePath(localTail)));
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.stroke(new Path2D(tailOutlinePath(localTail)));
  }

  if (ann.text.trim()) {
    ctx.save();
    ctx.clip(bodyPath);
    ctx.fillStyle = "#F5F5F7";
    ctx.font = bubbleFont(fontSize);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        padding,
        padding + lineHeight * index + lineHeight / 2,
      );
    });
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Subtle violet halo shown while the text tool hovers a committed note.
 * Deliberately no scale or size change — just enough to signal "click to
 * edit" without moving the annotation.
 */
export function drawTextHover(
  ctx: CanvasRenderingContext2D,
  ann: TextAnnotation,
): void {
  const layout = textBubbleLayout(ann);
  const { body, tail, width, height } = layout;
  ctx.save();
  ctx.translate(body.left, body.top);
  ctx.strokeStyle = "rgba(167,139,250,0.8)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(167,139,250,0.5)";
  ctx.shadowBlur = 12;
  ctx.stroke(new Path2D(roundedRectPath(width, height)));
  if (tail) {
    const localTail = {
      baseLeft: {
        x: tail.baseLeft.x - body.left,
        y: tail.baseLeft.y - body.top,
      },
      baseRight: {
        x: tail.baseRight.x - body.left,
        y: tail.baseRight.y - body.top,
      },
      tip: {
        x: tail.tip.x - body.left,
        y: tail.tip.y - body.top,
      },
      side: tail.side,
    };
    ctx.stroke(new Path2D(tailOutlinePath(localTail)));
  }
  ctx.restore();
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: AnnotationObject,
): void {
  switch (ann.type) {
    case "pencil":
    case "highlighter":
      drawStroke(ctx, ann);
      break;
    case "arrow":
      drawArrow(ctx, ann);
      break;
    case "rectangle":
    case "ellipse":
      drawShape(ctx, ann);
      break;
    case "text":
      drawText(ctx, ann);
      break;
  }
}

export function redrawAll(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  objects: AnnotationObject[],
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  for (const obj of objects) drawAnnotation(ctx, obj);
}
