/**
 * geometry.ts
 *
 * Geometric calculations for annotation hit detection and spatial operations.
 * Enables the eraser tool to find and remove annotations under the cursor.
 *
 * Key functions:
 * - findTopmostHit: Determines which annotation is under a given point
 * - distance: Calculates Euclidean distance between two points
 * - distanceToSegment: Point-to-line-segment distance for hit testing
 * - Hit detection for strokes, arrows, shapes, and text annotations
 *
 * 🤖 Co-authored by Claude (because Romeo is nice!)
 */

import type { AnnotationObject, ArrowAnnotation, Point, ShapeAnnotation, TextAnnotation } from "../shared/types";
import {
  clampFontSize,
  clampWidth,
  TEXT_BUBBLE,
  textBubbleLayout,
  textStrokeForFont,
  triangleContains,
} from "./text-bubble";

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function annotationBounds(ann: AnnotationObject): Bounds {
  if (ann.type === "arrow") {
    const pts = [ann.start, ann.end, arrowControl(ann)];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  }
  if (ann.type === "rectangle" || ann.type === "ellipse") {
    return {
      left: Math.min(ann.start.x, ann.end.x),
      top: Math.min(ann.start.y, ann.end.y),
      right: Math.max(ann.start.x, ann.end.x),
      bottom: Math.max(ann.start.y, ann.end.y),
    };
  }
  if (ann.type === "text") {
    return textBubbleLayout(ann).body;
  }
  if (!("points" in ann)) return { left: 0, top: 0, right: 0, bottom: 0 };
  const xs = ann.points.map((p) => p.x),
    ys = ann.points.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

export function shapeContains(
  point: Point,
  shape: ShapeAnnotation,
  padding = 0,
): boolean {
  const b = annotationBounds(shape);
  if (shape.type === "ellipse") {
    const rx = Math.max(1, (b.right - b.left) / 2 + padding);
    const ry = Math.max(1, (b.bottom - b.top) / 2 + padding);
    const cx = (b.left + b.right) / 2,
      cy = (b.top + b.bottom) / 2;
    return ((point.x - cx) / rx) ** 2 + ((point.y - cy) / ry) ** 2 <= 1;
  }
  return (
    point.x >= b.left - padding &&
    point.x <= b.right + padding &&
    point.y >= b.top - padding &&
    point.y <= b.bottom + padding
  );
}

/** Quadratic control point for an arrow (curved when `bend` is set). */
export function arrowControl(ann: ArrowAnnotation): Point {
  const bend = ann.bend ?? 0;
  if (bend === 0) {
    return {
      x: (ann.start.x + ann.end.x) / 2,
      y: (ann.start.y + ann.end.y) / 2,
    };
  }
  const dx = ann.end.x - ann.start.x;
  const dy = ann.end.y - ann.start.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular to the chord, scaled by the bend offset.
  const nx = -dy / len;
  const ny = dx / len;
  return {
    x: (ann.start.x + ann.end.x) / 2 + nx * bend,
    y: (ann.start.y + ann.end.y) / 2 + ny * bend,
  };
}

/** Point on the arrow curve at parameter t (0 = start, 1 = end). */
export function arrowPointAt(ann: ArrowAnnotation, t: number): Point {
  const c = arrowControl(ann);
  const u = 1 - t;
  return {
    x: u * u * ann.start.x + 2 * u * t * c.x + t * t * ann.end.x,
    y: u * u * ann.start.y + 2 * u * t * c.y + t * t * ann.end.y,
  };
}

/** Tangent angle of the arrow curve at parameter t (for head orientation). */
export function arrowTangentAngle(ann: ArrowAnnotation, t = 1): number {
  const c = arrowControl(ann);
  const dx = 2 * (1 - t) * (c.x - ann.start.x) + 2 * t * (ann.end.x - c.x);
  const dy = 2 * (1 - t) * (c.y - ann.start.y) + 2 * t * (ann.end.y - c.y);
  if (dx === 0 && dy === 0) {
    return Math.atan2(ann.end.y - ann.start.y, ann.end.x - ann.start.x);
  }
  return Math.atan2(dy, dx);
}

function arrowPolyline(ann: ArrowAnnotation, segments = 20): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) pts.push(arrowPointAt(ann, i / segments));
  return pts;
}

/**
 * Eight freeform-transformer handles for a bounding box:
 * 0-3 corners (TL, TR, BL, BR), 4 top edge, 5 bottom edge, 6 left edge,
 * 7 right edge. Shared by shapes, arrows, and text so every selectable
 * can be resized from any side.
 */
export function handlesForBounds(b: Bounds): Point[] {
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  return [
    { x: b.left, y: b.top },
    { x: b.right, y: b.top },
    { x: b.left, y: b.bottom },
    { x: b.right, y: b.bottom },
    { x: cx, y: b.top },
    { x: cx, y: b.bottom },
    { x: b.left, y: cy },
    { x: b.right, y: cy },
  ];
}

/** Cursor for a transformer handle index. */
export function cursorForHandle(handle: number): string {
  switch (handle) {
    case 0:
    case 3:
      return "nwse-resize";
    case 1:
    case 2:
      return "nesw-resize";
    case 4:
    case 5:
      return "ns-resize";
    case 6:
    case 7:
      return "ew-resize";
    default:
      return "default";
  }
}

/** Hit-test a point against the 8 transformer handles (10px radius). */
export function handleAtPoint(point: Point, ann: AnnotationObject): number {
  const b = annotationBounds(ann);
  return handlesForBounds(b).findIndex(
    (h) => Math.hypot(point.x - h.x, point.y - h.y) <= 10,
  );
}

/**
 * Midpoint handle of a Bender curved arrow for adjusting the bend by
 * dragging (Apple Preview style). Returns null for straight arrows.
 */
export function benderHandle(ann: ArrowAnnotation): Point | null {
  if (ann.headStyle !== "bender") return null;
  return arrowPointAt(ann, 0.5);
}

export function isBenderHandle(point: Point, ann: ArrowAnnotation): boolean {
  const h = benderHandle(ann);
  return !!h && Math.hypot(point.x - h.x, point.y - h.y) <= 12;
}

export function resizeShape(
  shape: ShapeAnnotation,
  handle: number,
  point: Point,
): ShapeAnnotation {
  const b = annotationBounds(shape);
  let { left, top, right, bottom } = b;
  // Corners move two edges; edge handles move one.
  if (handle === 0 || handle === 2 || handle === 6) left = point.x;
  if (handle === 1 || handle === 3 || handle === 7) right = point.x;
  if (handle === 0 || handle === 1 || handle === 4) top = point.y;
  if (handle === 2 || handle === 3 || handle === 5) bottom = point.y;
  // Keep a 2px minimum so shapes can't collapse or invert.
  if (right - left < 2) {
    if (handle === 6 || handle === 0 || handle === 2) left = right - 2;
    else right = left + 2;
  }
  if (bottom - top < 2) {
    if (handle === 4 || handle === 0 || handle === 1) top = bottom - 2;
    else bottom = top + 2;
  }
  return { ...shape, start: { x: left, y: top }, end: { x: right, y: bottom } };
}

/**
 * Resize an arrow by remapping its endpoints from the old bounding box to
 * the dragged box — same 8-handle model as shapes, orientation preserved.
 */
export function resizeArrow(
  ann: ArrowAnnotation,
  handle: number,
  point: Point,
): ArrowAnnotation {
  const b = annotationBounds(ann);
  let { left, top, right, bottom } = b;
  if (handle === 0 || handle === 2 || handle === 6) left = point.x;
  if (handle === 1 || handle === 3 || handle === 7) right = point.x;
  if (handle === 0 || handle === 1 || handle === 4) top = point.y;
  if (handle === 2 || handle === 3 || handle === 5) bottom = point.y;
  const oldW = b.right - b.left || 1;
  const oldH = b.bottom - b.top || 1;
  const newW = Math.max(2, right - left);
  const newH = Math.max(2, bottom - top);
  const map = (p: Point): Point => ({
    x: left + ((p.x - b.left) / oldW) * newW,
    y: top + ((p.y - b.top) / oldH) * newH,
  });
  return { ...ann, start: map(ann.start), end: map(ann.end) };
}

/**
 * Resize a text bubble. Top/bottom and corner drags scale the font and the
 * bubble width together; left/right edge drags change the wrap width only,
 * so longer notes can be made wider without changing the type size.
 */
export function resizeText(
  ann: TextAnnotation,
  handle: number,
  point: Point,
): TextAnnotation {
  const b = annotationBounds(ann);
  let { left, top, right, bottom } = b;
  if (handle === 0 || handle === 2 || handle === 6) left = point.x;
  if (handle === 1 || handle === 3 || handle === 7) right = point.x;
  if (handle === 0 || handle === 1 || handle === 4) top = point.y;
  if (handle === 2 || handle === 3 || handle === 5) bottom = point.y;

  if (handle === 6 || handle === 7) {
    return { ...ann, width: clampWidth(right - left) };
  }

  const oldH = Math.max(1, b.bottom - b.top);
  const newH = Math.max(1, bottom - top);
  const scale = newH / oldH;
  const fontSize = clampFontSize(ann.fontSize * scale);
  return {
    ...ann,
    fontSize,
    strokeWidth: textStrokeForFont(fontSize),
    width: clampWidth((ann.width ?? TEXT_BUBBLE.defaultWidth) * scale),
  };
}

/** Dispatch to the per-type resizer for the 8-handle transformer. */
export function resizeAnnotation(
  ann: AnnotationObject,
  handle: number,
  point: Point,
): AnnotationObject {
  if (ann.type === "rectangle" || ann.type === "ellipse")
    return resizeShape(ann, handle, point);
  if (ann.type === "arrow") return resizeArrow(ann, handle, point);
  if (ann.type === "text") return resizeText(ann, handle, point);
  return ann;
}

export function translateAnnotation(
  ann: AnnotationObject,
  dx: number,
  dy: number,
): AnnotationObject {
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  if ("points" in ann) return { ...ann, points: ann.points.map(move) };
  if (ann.type === "text") return { ...ann, position: move(ann.position) };
  if (
    ann.type === "arrow" ||
    ann.type === "rectangle" ||
    ann.type === "ellipse"
  ) {
    return { ...ann, start: move(ann.start), end: move(ann.end) };
  }
  return ann;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function distanceToPolyline(p: Point, points: Point[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distance(p, points[0]!);
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    min = Math.min(min, distanceToSegment(p, points[i]!, points[i + 1]!));
  }
  return min;
}

/** Hit-tests a point against an annotation object for the eraser tool. */
export function hitTest(point: Point, ann: AnnotationObject): boolean {
  const tolerance = Math.max(10, ann.strokeWidth);
  switch (ann.type) {
    case "pencil":
    case "highlighter":
      return distanceToPolyline(point, ann.points) <= tolerance;
    case "arrow":
      return distanceToPolyline(point, arrowPolyline(ann)) <= tolerance;
    case "rectangle": {
      const left = Math.min(ann.start.x, ann.end.x);
      const right = Math.max(ann.start.x, ann.end.x);
      const top = Math.min(ann.start.y, ann.end.y);
      const bottom = Math.max(ann.start.y, ann.end.y);
      if (ann.filled) {
        return (
          point.x >= left &&
          point.x <= right &&
          point.y >= top &&
          point.y <= bottom
        );
      }
      const insideOuter =
        point.x >= left - tolerance &&
        point.x <= right + tolerance &&
        point.y >= top - tolerance &&
        point.y <= bottom + tolerance;
      const insideInner =
        point.x >= left + tolerance &&
        point.x <= right - tolerance &&
        point.y >= top + tolerance &&
        point.y <= bottom - tolerance;
      return insideOuter && !insideInner;
    }
    case "ellipse": {
      const cx = (ann.start.x + ann.end.x) / 2;
      const cy = (ann.start.y + ann.end.y) / 2;
      const rx = Math.abs(ann.end.x - ann.start.x) / 2 || 1;
      const ry = Math.abs(ann.end.y - ann.start.y) / 2 || 1;
      const norm =
        (point.x - cx) ** 2 / (rx * rx) + (point.y - cy) ** 2 / (ry * ry);
      if (ann.filled) return norm <= 1;
      const toleranceNorm = tolerance / Math.min(rx, ry);
      return (
        norm >= (1 - toleranceNorm) * (1 - toleranceNorm) &&
        norm <= (1 + toleranceNorm) * (1 + toleranceNorm)
      );
    }
    case "text": {
      const layout = textBubbleLayout(ann);
      const b = layout.body;
      const padding = 3;
      if (
        point.x >= b.left - padding &&
        point.x <= b.right + padding &&
        point.y >= b.top - padding &&
        point.y <= b.bottom + padding
      )
        return true;
      return layout.tail
        ? triangleContains(
            point,
            layout.tail.tip,
            layout.tail.baseLeft,
            layout.tail.baseRight,
          )
        : false;
    }
    default:
      return false;
  }
}

export function findTopmostHit(
  point: Point,
  objects: AnnotationObject[],
): AnnotationObject | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i]!;
    if (hitTest(point, obj)) return obj;
  }
  return undefined;
}
