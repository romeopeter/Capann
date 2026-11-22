/**
 * zoom-lens.ts
 *
 * The Zoom tool: a round magnifier that follows the cursor, like the
 * spotlight. A content script cannot re-render the page at a larger scale, so
 * the lens shows a SNAPSHOT of the tab (`captureVisibleTab`, taken with
 * Capann's overlay hidden, per the capture invariant) and draws the
 * annotations on top of it as vectors, so they stay sharp at any zoom.
 *
 * The snapshot is retaken after scrolling, resizing, and clicking (see
 * OverlayApp). Between retakes, scrolling is compensated from the scroll
 * offset the snapshot was taken at.
 */

import type { AnnotationObject, Point } from "../shared/types";
import { drawAnnotation } from "./render";

export const ZOOM_LEVELS = [1.5, 2, 3] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export const LENS_RADII = { S: 70, M: 100, L: 140 } as const;
export type LensSize = keyof typeof LENS_RADII;

export interface LensSnapshot {
  image: CanvasImageSource;
  /** Window scroll when the snapshot was taken. */
  scrollX: number;
  scrollY: number;
  /** Snapshot pixels per viewport CSS pixel. */
  ratio: number;
}

/**
 * Draw the lens at `cursor` (viewport CSS px). `ctx` must be in screen
 * transform (`setScreenTransform`). Annotations are in page coordinates.
 */
export function drawLens(
  ctx: CanvasRenderingContext2D,
  cursor: Point,
  zoom: number,
  radius: number,
  snapshot: LensSnapshot | null,
  objects: AnnotationObject[],
): void {
  const dpr = window.devicePixelRatio || 1;
  const { x: cx, y: cy } = cursor;
  // Page point under the cursor: the lens's fixed point.
  const px = cx + window.scrollX;
  const py = cy + window.scrollY;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.38)";
  ctx.shadowBlur = 22 * dpr;
  ctx.shadowOffsetY = 6 * dpr;
  // Shown until the first snapshot arrives, and wherever it doesn't reach.
  ctx.fillStyle = "#1C1C20";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.clip();
  if (snapshot) {
    const { ratio } = snapshot;
    const sx = (px - snapshot.scrollX) * ratio;
    const sy = (py - snapshot.scrollY) * ratio;
    const half = (radius / zoom) * ratio;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      snapshot.image,
      sx - half,
      sy - half,
      half * 2,
      half * 2,
      cx - radius,
      cy - radius,
      radius * 2,
      radius * 2,
    );
  }
  // Annotations magnified about the cursor, redrawn as vectors.
  const s = dpr * zoom;
  ctx.setTransform(s, 0, 0, s, dpr * (cx - zoom * px), dpr * (cy - zoom * py));
  for (const object of objects) drawAnnotation(ctx, object);
  ctx.restore();

  // Rim: white with a dark hairline inside, so it reads on any page.
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1.75, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(10,10,12,0.28)";
  ctx.stroke();
  ctx.restore();
}
