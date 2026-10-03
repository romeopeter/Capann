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

import type { AnnotationObject, Point, ShapeAnnotation } from "../shared/types";

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function annotationBounds(ann: AnnotationObject): Bounds {
  if (
    ann.type === "rectangle" ||
    ann.type === "ellipse" ||
    ann.type === "arrow"
  ) {
    return {
      left: Math.min(ann.start.x, ann.end.x),
      top: Math.min(ann.start.y, ann.end.y),
      right: Math.max(ann.start.x, ann.end.x),
      bottom: Math.max(ann.start.y, ann.end.y),
    };
  }
  if (ann.type === "text") {
    return {
      left: ann.position.x,
      top: ann.position.y - ann.fontSize * 1.3,
      right: ann.position.x + ann.text.length * ann.fontSize * 0.6,
      bottom: ann.position.y,
    };
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

export function resizeShape(
  shape: ShapeAnnotation,
  handle: number,
  point: Point,
): ShapeAnnotation {
  const b = annotationBounds(shape);
  const corners = [
    { x: b.left, y: b.top },
    { x: b.right, y: b.top },
    { x: b.left, y: b.bottom },
    { x: b.right, y: b.bottom },
  ];
  const opposite = corners[[3, 2, 1, 0][handle]!]!;
  const x = point.x <= opposite.x ? opposite.x - 2 : point.x;
  const y = point.y <= opposite.y ? opposite.y - 2 : point.y;
  const left = Math.min(x, opposite.x),
    top = Math.min(y, opposite.y);
  const right = Math.max(x, opposite.x),
    bottom = Math.max(y, opposite.y);
  return { ...shape, start: { x: left, y: top }, end: { x: right, y: bottom } };
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
      return distanceToSegment(point, ann.start, ann.end) <= tolerance;
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
      const approxWidth = ann.text.length * ann.fontSize * 0.6;
      const approxHeight = ann.fontSize * 1.3;
      return (
        point.x >= ann.position.x &&
        point.x <= ann.position.x + approxWidth &&
        point.y >= ann.position.y - approxHeight &&
        point.y <= ann.position.y
      );
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
