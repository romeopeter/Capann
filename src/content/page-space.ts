/**
 * page-space.ts
 *
 * Annotations are stored in PAGE coordinates (CSS pixels from the document's
 * top-left), so they scroll with the page. The canvases stay viewport-sized and
 * `position: fixed` (see learn/canvas.md for why); scrolling is expressed as a
 * canvas transform instead of a bigger bitmap.
 *
 * Only window scrolling is tracked. Pages that scroll an inner element (many web
 * apps) keep the window at 0,0, so annotations there behave as before.
 */

import type { Point } from "../shared/types";

/** Pointer position (viewport CSS px) -> page coordinates. */
export function pagePoint(clientX: number, clientY: number): Point {
  return { x: clientX + window.scrollX, y: clientY + window.scrollY };
}

/**
 * Draw in page coordinates: HiDPI scale plus the current scroll offset. Every
 * canvas that renders annotations must use this, including PNG export.
 */
export function setPageTransform(ctx: CanvasRenderingContext2D): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, -window.scrollX * dpr, -window.scrollY * dpr);
}

/** Draw in viewport coordinates (laser, spotlight): HiDPI scale only. */
export function setScreenTransform(ctx: CanvasRenderingContext2D): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Clear the whole bitmap regardless of the current transform. */
export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
