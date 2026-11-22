/**
 * screenshot.tsx
 *
 * The Screenshot workflow's own pieces. OverlayApp owns the flow (and the
 * annotation document); this file holds what it draws:
 *
 *   select  -> `ScreenshotSelector`: drag a box (or take the whole screen)
 *   edit    -> `ScreenshotStage`: the framed screenshot, scaled to fit,
 *              under the normal annotation canvases
 *   export  -> `renderScreenshot`: the same frame at full resolution
 *
 * The preview and the export both draw through `drawFrame`
 * (shared/screenshot-style.ts), so what you see is what you save.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AnnotationObject, Point } from "../shared/types";
import {
  backgroundFill,
  drawFrame,
  frameLayout,
  type FrameLayout,
  type ScreenshotStyle,
} from "../shared/screenshot-style";
import { drawAnnotation } from "./render";

/** A rectangle in viewport CSS pixels. */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A captured, cropped screenshot. */
export interface Screenshot {
  /** The whole visible-tab capture. */
  image: HTMLImageElement;
  /** The selected area, in capture pixels. */
  source: ViewportRect;
  /** The selected area's size in CSS pixels (the annotation space). */
  width: number;
  height: number;
  /** Capture pixels per CSS pixel (the device pixel ratio at capture). */
  ratio: number;
}

/** How the framed screenshot sits on screen while it is being edited. */
export interface ScreenshotFit {
  layout: FrameLayout;
  /** Screen pixels per image pixel. */
  scale: number;
  /** Viewport position of the frame's top-left. */
  frameX: number;
  frameY: number;
}

const STAGE_MARGIN = 28;
/**
 * The panel docks top-right (280px wide, 56px from the edge; shell.tsx); keep
 * the image clear of it, with a gap, on screens wide enough to afford it.
 */
const PANEL_RESERVE = 56 + 280 + 24;
/** Small selections are enlarged to be easy to annotate, but not blown up. */
const MAX_FIT_SCALE = 2;

export function fitScreenshot(
  viewportWidth: number,
  viewportHeight: number,
  shot: Pick<Screenshot, "width" | "height">,
  style: ScreenshotStyle,
): ScreenshotFit {
  const layout = frameLayout(shot.width, shot.height, style);
  const reserve = viewportWidth >= 900 ? PANEL_RESERVE : STAGE_MARGIN;
  const areaWidth = Math.max(120, viewportWidth - STAGE_MARGIN - reserve);
  const areaHeight = Math.max(120, viewportHeight - STAGE_MARGIN * 2);
  const scale = Math.min(
    areaWidth / layout.width,
    areaHeight / layout.height,
    MAX_FIT_SCALE,
  );
  return {
    layout,
    scale,
    frameX: STAGE_MARGIN + (areaWidth - layout.width * scale) / 2,
    frameY: STAGE_MARGIN + (areaHeight - layout.height * scale) / 2,
  };
}

const MIN_SELECTION = 8;

/**
 * Drag-to-select. Enter (or the button) takes the whole visible area; Esc
 * cancels. Sits under the annotation canvases, so marks already on the page
 * stay visible while choosing (they are carried into the screenshot).
 */
export function ScreenshotSelector({
  onSelect,
  onCancel,
}: {
  onSelect: (rect: ViewportRect) => void;
  onCancel: () => void;
}) {
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const whole = () =>
    onSelect({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });

  // Latest callbacks for the long-lived key listener.
  const callbacks = useRef({ onCancel, whole });
  useEffect(() => {
    callbacks.current = { onCancel, whole };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        callbacks.current.onCancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        callbacks.current.whole();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const rect = drag && {
    x: Math.min(drag.start.x, drag.end.x),
    y: Math.min(drag.start.y, drag.end.y),
    width: Math.abs(drag.end.x - drag.start.x),
    height: Math.abs(drag.end.y - drag.start.y),
  };

  return (
    <div
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const point = { x: e.clientX, y: e.clientY };
        setDrag({ start: point, end: point });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        setDrag({
          start: drag.start,
          end: {
            x: Math.min(window.innerWidth, Math.max(0, e.clientX)),
            y: Math.min(window.innerHeight, Math.max(0, e.clientY)),
          },
        });
      }}
      onPointerUp={() => {
        setDrag(null);
        if (rect && rect.width >= MIN_SELECTION && rect.height >= MIN_SELECTION)
          onSelect({
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
      }}
      onPointerCancel={() => setDrag(null)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483645,
        cursor: "crosshair",
        pointerEvents: "auto",
        background: rect ? "transparent" : "rgba(10,10,12,0.38)",
        touchAction: "none",
      }}
    >
      {rect && (
        <div
          style={{
            position: "absolute",
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 100vmax rgba(10,10,12,0.38)",
            outline: "1.5px solid #A78BFA",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 6px)",
              padding: "3px 7px",
              borderRadius: 999,
              background: "rgba(28,28,32,0.88)",
              color: "#F5F5F7",
              font: "500 11px/1.2 Manrope,system-ui,sans-serif",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      )}
      {!rect && (
        <div
          role="dialog"
          aria-label="Take a screenshot"
          // The chip is clickable; don't start a selection from it.
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 6px 6px 14px",
            borderRadius: 999,
            background: "rgba(28,28,32,0.86)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#F5F5F7",
            font: "500 13px/1.2 Manrope,system-ui,sans-serif",
            cursor: "default",
            whiteSpace: "nowrap",
            animation: "rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both",
          }}
        >
          <span>Drag to select an area</span>
          <button
            onClick={whole}
            title="Enter"
            style={{
              height: 28,
              padding: "0 12px",
              borderRadius: 999,
              border: "none",
              background: "#A78BFA",
              color: "#17131F",
              font: "600 12px/1 Manrope,system-ui,sans-serif",
              cursor: "pointer",
            }}
          >
            Whole screen
          </button>
          <button
            onClick={onCancel}
            title="Esc"
            style={{
              height: 28,
              padding: "0 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "transparent",
              color: "#F5F5F7",
              font: "500 12px/1 Manrope,system-ui,sans-serif",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The framed screenshot behind the annotation canvases. Covers the page so
 * clicks can't reach it, and redraws whenever the frame or fit changes.
 */
export function ScreenshotStage({
  shot,
  style,
  fit,
}: {
  shot: Screenshot;
  style: ScreenshotStyle;
  fit: ScreenshotFit;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = dpr * fit.scale;
    ctx.setTransform(s, 0, 0, s, fit.frameX * dpr, fit.frameY * dpr);
    const { width, height } = fit.layout;
    // Preview only: a transparent ("None") background shows as a checkerboard,
    // so its padding is visible against the backdrop.
    if (backgroundFill(style) === null) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();
      const cell = 10 / fit.scale;
      for (let y = 0; y < height; y += cell)
        for (let x = 0; x < width; x += cell) {
          ctx.fillStyle = (Math.round(x / cell) + Math.round(y / cell)) % 2 ? "#2A2A30" : "#202025";
          ctx.fillRect(x, y, cell, cell);
        }
      ctx.restore();
    }
    drawFrame(ctx, shot.image, shot.source, fit.layout, style, s);
    // Preview only: a hairline at the export's edge, so a dark frame still
    // reads against the dark backdrop.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(fit.frameX * dpr) - 0.5,
      Math.round(fit.frameY * dpr) - 0.5,
      Math.round(width * fit.scale * dpr) + 1,
      Math.round(height * fit.scale * dpr) + 1,
    );
  }, [shot, style, fit]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483645,
        pointerEvents: "auto",
        background: "rgba(18,18,20,0.96)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    </div>
  );
}

/** The framed, annotated screenshot at full capture resolution. */
export function renderScreenshot(
  shot: Screenshot,
  style: ScreenshotStyle,
  objects: AnnotationObject[],
): HTMLCanvasElement {
  const layout = frameLayout(shot.width, shot.height, style);
  const r = shot.ratio;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(layout.width * r);
  canvas.height = Math.round(layout.height * r);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(r, 0, 0, r, 0, 0);
  drawFrame(ctx, shot.image, shot.source, layout, style, r);
  // Annotations live in the screenshot's own space, offset by the frame.
  ctx.setTransform(r, 0, 0, r, layout.image.x * r, layout.image.y * r);
  for (const object of objects) drawAnnotation(ctx, object);
  return canvas;
}
