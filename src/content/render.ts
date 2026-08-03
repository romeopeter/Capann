/**
 * render.ts
 *
 * Canvas rendering engine for all annotation types.
 * Handles drawing strokes, arrows, shapes, and text to the HTML5 canvas.
 *
 * Key functions:
 * - drawAnnotation: Renders a single annotation object
 * - redrawAll: Clears and redraws the entire annotation layer
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
} from '../shared/types';

function drawStroke(ctx: CanvasRenderingContext2D, ann: StrokeAnnotation): void {
  if (ann.points.length < 2) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = ann.color;
  ctx.lineWidth = ann.strokeWidth;
  ctx.globalAlpha = ann.type === 'highlighter' ? 0.35 : 1;
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
  style: ArrowHeadStyle
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = Math.max(10, size * 4);
  const spread = Math.PI / 7;

  ctx.beginPath();
  if (style === 'triangle') {
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
  } else if (style === 'chevron') {
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
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ann.start.x, ann.start.y);
  ctx.lineTo(ann.end.x, ann.end.y);
  ctx.stroke();
  drawArrowHead(ctx, ann.start, ann.end, ann.strokeWidth, ann.headStyle);
  ctx.restore();
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
  if (ann.type === 'rectangle') {
    ctx.rect(left, top, width, height);
  } else {
    ctx.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
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
  ctx.save();
  ctx.fillStyle = ann.color;
  ctx.font = `600 ${ann.fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(ann.text, ann.position.x, ann.position.y);
  ctx.restore();
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, ann: AnnotationObject): void {
  switch (ann.type) {
    case 'pencil':
    case 'highlighter':
      drawStroke(ctx, ann);
      break;
    case 'arrow':
      drawArrow(ctx, ann);
      break;
    case 'rectangle':
    case 'ellipse':
      drawShape(ctx, ann);
      break;
    case 'text':
      drawText(ctx, ann);
      break;
  }
}

export function redrawAll(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  objects: AnnotationObject[]
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  for (const obj of objects) drawAnnotation(ctx, obj);
}
