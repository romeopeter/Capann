/**
 * OverlayApp.tsx
 *
 * Main application component for the Capann annotation overlay.
 * Manages all annotation state, canvas rendering, tool interactions, and user input.
 *
 * Key responsibilities:
 * - Canvas lifecycle (creation, resizing, rendering)
 * - Annotation drawing logic for all tool types (pencil, highlighter, arrow, shapes, text)
 * - Undo/redo history management
 * - Laser pointer and spotlight effects
 * - Chrome storage integration for per-tab persistence
 * - Screenshot capture and PNG export
 * - Background script message handling
 */

import { useState, useEffect, useRef, useCallback, useContext } from "react";
import type {
  AnnotationObject,
  ArrowHeadStyle,
  BackgroundToContentMessage,
  CaptureVisibleTabResponse,
  ContentToBackgroundMessage,
  GetTabIdResponse,
  Point,
  RecordOptions,
  RecordingStatus,
  TabAnnotationState,
  ToolId,
} from "../shared/types";
import { STORAGE_KEY_PREFIX } from "../shared/types";
import {
  annotationBounds,
  findTopmostHit,
  hitTest,
  resizeShape,
  shapeContains,
  translateAnnotation,
} from "./geometry";
import { drawAnnotation, redrawAll } from "./render";
import { Toolbar } from "./toolbar";
import { ShadowRootContext } from "./overlay";

const CAPTURING_TOOLS: ReadonlySet<ToolId> = new Set([
  "pencil",
  "highlighter",
  "arrow",
  "rectangle",
  "ellipse",
  "text",
  "eraser",
  "select",
]);

const TOOL_CYCLE_ORDER: ToolId[] = [
  "pencil",
  "highlighter",
  "arrow",
  "rectangle",
  "ellipse",
  "text",
  "laser",
  "spotlight",
  "eraser",
  "select",
];

const LASER_TRAIL_MS = 450;

/** Cap on retained undo states, so long sessions don't grow memory unbounded. */
const HISTORY_LIMIT = 50;

/**
 * Ring cursor matching the eraser's reach, so it's obvious what will be rubbed
 * out. Radius is clamped because browsers refuse to render cursors past ~128px.
 */
function eraserCursor(strokeWidth: number): string {
  const r = Math.min(48, Math.max(10, strokeWidth));
  const size = r * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${r}" cy="${r}" r="${r - 1}" fill="rgba(245,245,247,0.18)" ` +
    `stroke="#F5F5F7" stroke-width="1.5"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${r} ${r}, cell`;
}

export function OverlayApp() {
  const shadowRoot = useContext(ShadowRootContext);
  const [tabId, setTabId] = useState(-1);
  const [uiView, setUiView] = useState<"closed" | "chooser" | "annotate" | "record">("closed");
  const [captureHidden, setCaptureHidden] = useState(true);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>({ state: "idle" });
  const [recordOptions, setRecordOptions] = useState<RecordOptions>({ camera: true, microphone: true, tabAudio: true });
  const [drawModeEnabled, setDrawModeEnabled] = useState(false);
  const [tool, setTool] = useState<ToolId>("pencil");
  const [color, setColor] = useState("#A78BFA");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [headStyle, setHeadStyle] = useState<ArrowHeadStyle>("triangle");
  const [filled, setFilled] = useState(false);
  const [objects, setObjects] = useState<AnnotationObject[]>([]);
  // Undo history: `past` holds prior states, `future` holds states undone away.
  const [past, setPast] = useState<AnnotationObject[][]>([]);
  const [future, setFuture] = useState<AnnotationObject[][]>([]);
  const [statusText, setStatusText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const currentPointsRef = useRef<Point[] | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  /**
   * Objects as they were when an erase drag began. Erasing mutates state on
   * every pointermove, but the whole drag collapses into one undo entry, so we
   * hold the pre-drag snapshot here and push it once on pointerup.
   */
  const eraseBaselineRef = useRef<AnnotationObject[] | null>(null);
  const cursorRef = useRef<Point>({ x: -100, y: -100 });
  const laserTrailRef = useRef<{ point: Point; time: number }[]>([]);
  const laserActiveRef = useRef(false);
  const rafHandleRef = useRef(0);
  const saveTimerRef = useRef(0);
  const editingInputRef = useRef<HTMLTextAreaElement | null>(null);
  const editingPointRef = useRef<Point | null>(null);
  const selectionDragRef = useRef<{
    kind: "move" | "resize";
    object: AnnotationObject;
    start: Point;
    handle: number;
    baseline: AnnotationObject[];
  } | null>(null);
  const widthEditBaselineRef = useRef<AnnotationObject[] | null>(null);

  const objectsCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);

  const storageKey = useCallback(
    () => `${STORAGE_KEY_PREFIX}${tabId}`,
    [tabId],
  );

  const restoreState = useCallback(async () => {
    if (tabId < 0) return;
    const result = await chrome.storage.session.get(storageKey());
    const state = result[storageKey()] as TabAnnotationState | undefined;
    if (state?.objects) setObjects(state.objects);
  }, [tabId, storageKey]);

  const scheduleSave = useCallback(() => {
    if (tabId < 0) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const state: TabAnnotationState = { objects };
      void chrome.storage.session.set({ [storageKey()]: state });
    }, 350);
  }, [tabId, objects, storageKey]);

  const resizeCanvases = useCallback(() => {
    const objectsCanvas = objectsCanvasRef.current;
    const liveCanvas = liveCanvasRef.current;
    if (!objectsCanvas || !liveCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    for (const canvas of [objectsCanvas, liveCanvas]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    const objectsCtx = objectsCanvas.getContext("2d")!;
    const liveCtx = liveCanvas.getContext("2d")!;
    objectsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    liveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    redrawAll(objectsCtx, width, height, objects);
  }, [objects]);

  const redrawObjects = useCallback(() => {
    const objectsCanvas = objectsCanvasRef.current;
    if (!objectsCanvas) return;
    const ctx = objectsCanvas.getContext("2d")!;
    redrawAll(ctx, window.innerWidth, window.innerHeight, objects);
  }, [objects]);

  const clearLive = useCallback(() => {
    const liveCanvas = liveCanvasRef.current;
    if (!liveCanvas) return;
    const ctx = liveCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }, []);

  const updatePointerMode = useCallback(() => {
    const liveCanvas = liveCanvasRef.current;
    if (!liveCanvas) return;

    const capturing = drawModeEnabled && CAPTURING_TOOLS.has(tool);
    liveCanvas.style.pointerEvents = capturing ? "auto" : "none";
    liveCanvas.style.cursor = !capturing
      ? ""
      : tool === "select"
        ? selectedId
          ? "move"
          : "default"
        : tool === "eraser"
          ? eraserCursor(strokeWidth)
          : tool === "text"
            ? "text"
            : "crosshair";

    const needsRaf =
      drawModeEnabled && (tool === "laser" || tool === "spotlight");
    if (needsRaf && !rafHandleRef.current) {
      const renderLiveOverlay = () => {
        if (!laserActiveRef.current) return;

        const liveCanvas = liveCanvasRef.current;
        if (!liveCanvas) return;
        const ctx = liveCanvas.getContext("2d")!;

        const now = performance.now();
        laserTrailRef.current = laserTrailRef.current.filter(
          (p) => now - p.time < LASER_TRAIL_MS,
        );
        clearLive();

        if (tool === "laser") {
          for (const entry of laserTrailRef.current) {
            const age = (now - entry.time) / LASER_TRAIL_MS;
            const alpha = 1 - age;
            const radius = 4 + 4 * (1 - age);
            ctx.beginPath();
            ctx.fillStyle = `rgba(239, 68, 68, ${alpha * 0.8})`;
            ctx.arc(entry.point.x, entry.point.y, radius, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.fillStyle = "#ef4444";
          ctx.arc(cursorRef.current.x, cursorRef.current.y, 6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const w = window.innerWidth;
          const h = window.innerHeight;
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(0, 0, w, h);
          ctx.save();
          ctx.globalCompositeOperation = "destination-out";
          const radius = 110;
          const gradient = ctx.createRadialGradient(
            cursorRef.current.x,
            cursorRef.current.y,
            0,
            cursorRef.current.x,
            cursorRef.current.y,
            radius,
          );
          gradient.addColorStop(0, "rgba(0,0,0,1)");
          gradient.addColorStop(0.75, "rgba(0,0,0,1)");
          gradient.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(
            cursorRef.current.x,
            cursorRef.current.y,
            radius,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.restore();
        }
      };

      const loop = () => {
        renderLiveOverlay();
        rafHandleRef.current = requestAnimationFrame(loop);
      };
      rafHandleRef.current = requestAnimationFrame(loop);
    } else if (!needsRaf && rafHandleRef.current) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = 0;
      clearLive();
    }
  }, [drawModeEnabled, tool, strokeWidth, clearLive, selectedId]);

  const makeId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  const resetDrag = useCallback(() => {
    currentPointsRef.current = null;
    dragStartRef.current = null;
    eraseBaselineRef.current = null;
    selectionDragRef.current = null;
    clearLive();
  }, [clearLive]);

  /**
   * Single entry point for every annotation mutation. Pushes the outgoing state
   * onto the undo stack and drops the redo stack, so undo/redo stay consistent
   * no matter which tool made the change.
   */
  const commit = useCallback(
    (next: AnnotationObject[]) => {
      setPast((p) => [...p, objects].slice(-HISTORY_LIMIT));
      setFuture([]);
      setObjects(next);
    },
    [objects],
  );

  /**
   * Remove the topmost object under `point`, if any. Deliberately a pure
   * updater rather than a commit() call: an erase drag fires this on every
   * pointermove, and history is recorded once for the whole drag instead.
   */
  const eraseAt = useCallback((point: Point) => {
    setObjects((prev) => {
      const hit = findTopmostHit(point, prev);
      return hit ? prev.filter((o) => o.id !== hit.id) : prev;
    });
  }, []);

  const commitTextInput = useCallback(() => {
    const input = editingInputRef.current;
    const point = editingPointRef.current;
    if (!input || !point) return;
    editingInputRef.current = null;
    editingPointRef.current = null;
    const text = input.value.trim();
    input.remove();
    if (!text) return;
    commit([
      ...objects,
      {
        id: makeId(),
        type: "text",
        color,
        strokeWidth,
        createdAt: Date.now(),
        position: point,
        text,
        fontSize: Math.max(14, strokeWidth * 4),
      },
    ]);
  }, [color, strokeWidth, makeId, commit, objects]);

  const beginTextInput = useCallback(
    (point: Point) => {
      if (editingInputRef.current) commitTextInput();
      if (!shadowRoot) return;

      const input = document.createElement("textarea");
      input.className = "text-input";
      input.style.left = `${point.x}px`;
      input.style.top = `${point.y - strokeWidth * 4}px`;
      input.style.color = color;
      input.style.fontSize = `${Math.max(14, strokeWidth * 4)}px`;
      input.rows = 1;
      shadowRoot.append(input);
      input.focus();
      editingInputRef.current = input;
      editingPointRef.current = point;

      const commitText = () => commitTextInput();
      input.addEventListener("blur", commitText);
      input.addEventListener("keydown", (ke) => {
        if (ke.key === "Enter" && !ke.shiftKey) {
          ke.preventDefault();
          commitText();
        } else if (ke.key === "Escape") {
          ke.preventDefault();
          input.value = "";
          commitText();
        }
      });
    },
    [color, strokeWidth, commitTextInput, shadowRoot],
  );

  const getSelectedHandle = useCallback(
    (point: Point, ann: AnnotationObject) => {
      if (ann.type !== "rectangle" && ann.type !== "ellipse") return -1;
      const b = annotationBounds(ann);
      const corners = [
        { x: b.left, y: b.top },
        { x: b.right, y: b.top },
        { x: b.left, y: b.bottom },
        { x: b.right, y: b.bottom },
      ];
      return corners.findIndex(
        (corner) => Math.hypot(point.x - corner.x, point.y - corner.y) <= 10,
      );
    },
    [],
  );

  const drawSelection = useCallback(
    (ctx: CanvasRenderingContext2D, ann: AnnotationObject) => {
      const b = annotationBounds(ann);
      ctx.save();
      ctx.strokeStyle = "#A78BFA";
      ctx.fillStyle = "#1C1C20";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
      ctx.setLineDash([]);
      if (ann.type === "rectangle" || ann.type === "ellipse") {
        for (const corner of [
          { x: b.left, y: b.top },
          { x: b.right, y: b.top },
          { x: b.left, y: b.bottom },
          { x: b.right, y: b.bottom },
        ]) {
          ctx.beginPath();
          ctx.arc(corner.x, corner.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    },
    [],
  );

  const findSelectable = useCallback(
    (point: Point, list: AnnotationObject[]) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const candidate = list[i]!;
        if (
          candidate.type === "rectangle" || candidate.type === "ellipse"
            ? shapeContains(point, candidate, 8)
            : hitTest(point, candidate)
        )
          return candidate;
      }
      return undefined;
    },
    [],
  );

  const redrawSelection = useCallback(() => {
    clearLive();
    if (!drawModeEnabled || !selectedId) return;
    const selected = objects.find((object) => object.id === selectedId);
    const ctx = liveCanvasRef.current?.getContext("2d");
    if (selected && ctx) drawSelection(ctx, selected);
  }, [clearLive, drawModeEnabled, drawSelection, objects, selectedId]);

  const cancelPointer = useCallback(() => {
    resetDrag();
    redrawSelection();
  }, [redrawSelection, resetDrag]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawModeEnabled) return;
      const point = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);

      if (tool === "eraser") {
        eraseBaselineRef.current = objects;
        eraseAt(point);
        return;
      }

      if (tool === "select") {
        const selected = objects.find((object) => object.id === selectedId);
        const handle = selected ? getSelectedHandle(point, selected) : -1;
        if (selected && handle >= 0) {
          selectionDragRef.current = {
            kind: "resize",
            object: selected,
            start: point,
            handle,
            baseline: objects,
          };
          return;
        }
        const target = findSelectable(point, objects);
        setSelectedId(target?.id ?? null);
        if (target)
          selectionDragRef.current = {
            kind: "move",
            object: target,
            start: point,
            handle: -1,
            baseline: objects,
          };
        return;
      }

      if (tool === "text") {
        beginTextInput(point);
        return;
      }

      if (tool === "pencil" || tool === "highlighter") {
        currentPointsRef.current = [point];
      } else if (
        tool === "arrow" ||
        tool === "rectangle" ||
        tool === "ellipse"
      ) {
        dragStartRef.current = point;
      }
    },
    [
      drawModeEnabled,
      tool,
      objects,
      selectedId,
      getSelectedHandle,
      findSelectable,
      beginTextInput,
      eraseAt,
    ],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawModeEnabled) return;
      const point = { x: e.clientX, y: e.clientY };
      // Eraser rubs out everything the cursor is dragged across, so it runs
      // before the stroke-preview branches and needs no drag state of its own.
      if (tool === "eraser") {
        if (eraseBaselineRef.current !== null) eraseAt(point);
        return;
      }

      const selectionDrag = selectionDragRef.current;
      if (tool === "select" && selectionDrag) {
        const dx = point.x - selectionDrag.start.x;
        const dy = point.y - selectionDrag.start.y;
        const preview =
          selectionDrag.kind === "resize" &&
          (selectionDrag.object.type === "rectangle" ||
            selectionDrag.object.type === "ellipse")
            ? resizeShape(selectionDrag.object, selectionDrag.handle, point)
            : translateAnnotation(selectionDrag.object, dx, dy);
        clearLive();
        drawAnnotation(liveCanvasRef.current!.getContext("2d")!, preview);
        drawSelection(liveCanvasRef.current!.getContext("2d")!, preview);
        return;
      }

      const liveCanvas = liveCanvasRef.current;
      if (!liveCanvas) return;
      const ctx = liveCanvas.getContext("2d")!;

      if (
        currentPointsRef.current &&
        (tool === "pencil" || tool === "highlighter")
      ) {
        currentPointsRef.current.push(point);
        clearLive();
        drawAnnotation(ctx, {
          id: "preview",
          type: tool,
          color,
          strokeWidth,
          createdAt: 0,
          points: currentPointsRef.current,
        });
        return;
      }

      if (dragStartRef.current && tool === "arrow") {
        clearLive();
        drawAnnotation(ctx, {
          id: "preview",
          type: "arrow",
          color,
          strokeWidth,
          createdAt: 0,
          start: dragStartRef.current,
          end: point,
          headStyle,
        });
        return;
      }

      if (
        dragStartRef.current &&
        (tool === "rectangle" || tool === "ellipse")
      ) {
        clearLive();
        drawAnnotation(ctx, {
          id: "preview",
          type: tool,
          color,
          strokeWidth,
          createdAt: 0,
          start: dragStartRef.current,
          end: point,
          filled,
        });
      }
    },
    [
      drawModeEnabled,
      tool,
      color,
      strokeWidth,
      headStyle,
      filled,
      clearLive,
      eraseAt,
      drawSelection,
    ],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawModeEnabled) return;
      const point = { x: e.clientX, y: e.clientY };
      e.currentTarget.releasePointerCapture(e.pointerId);

      // An erase drag already mutated `objects` directly; record the whole drag
      // as one undo entry now that it's finished.
      if (tool === "eraser") {
        const baseline = eraseBaselineRef.current;
        eraseBaselineRef.current = null;
        if (baseline && baseline !== objects) {
          setPast((p) => [...p, baseline].slice(-HISTORY_LIMIT));
          setFuture([]);
        }
        redrawSelection();
        return;
      }

      const selectionDrag = selectionDragRef.current;
      selectionDragRef.current = null;
      if (tool === "select" && selectionDrag) {
        const point = { x: e.clientX, y: e.clientY };
        const dx = point.x - selectionDrag.start.x;
        const dy = point.y - selectionDrag.start.y;
        const updated =
          selectionDrag.kind === "resize" &&
          (selectionDrag.object.type === "rectangle" ||
            selectionDrag.object.type === "ellipse")
            ? resizeShape(selectionDrag.object, selectionDrag.handle, point)
            : translateAnnotation(selectionDrag.object, dx, dy);
        const next = selectionDrag.baseline.map((object) =>
          object.id === updated.id ? updated : object,
        );
        if (dx !== 0 || dy !== 0 || selectionDrag.kind === "resize")
          commit(next);
        clearLive();
        if (drawModeEnabled) {
          const ctx = liveCanvasRef.current?.getContext("2d");
          if (ctx) drawSelection(ctx, updated);
        }
        return;
      }

      // Snapshot the refs before clearing them. setObjects runs its updater
      // asynchronously, so reading a ref inside the updater would see the null
      // we assign below rather than the stroke we just finished.
      const points = currentPointsRef.current;
      const dragStart = dragStartRef.current;
      currentPointsRef.current = null;
      dragStartRef.current = null;

      if (points && (tool === "pencil" || tool === "highlighter")) {
        if (points.length > 1) {
          commit([
            ...objects,
            {
              id: makeId(),
              type: tool,
              color,
              strokeWidth,
              createdAt: Date.now(),
              points,
            },
          ]);
        }
      } else if (dragStart && tool === "arrow") {
        commit([
          ...objects,
          {
            id: makeId(),
            type: "arrow",
            color,
            strokeWidth,
            createdAt: Date.now(),
            start: dragStart,
            end: point,
            headStyle,
          },
        ]);
      } else if (dragStart && (tool === "rectangle" || tool === "ellipse")) {
        commit([
          ...objects,
          {
            id: makeId(),
            type: tool,
            color,
            strokeWidth,
            createdAt: Date.now(),
            start: dragStart,
            end: point,
            filled,
          },
        ]);
      } else {
        return;
      }

      clearLive();
      redrawSelection();
    },
    [
      drawModeEnabled,
      tool,
      color,
      strokeWidth,
      headStyle,
      filled,
      makeId,
      clearLive,
      drawSelection,
      redrawSelection,
      commit,
      objects,
    ],
  );

  const changeWidth = useCallback(
    (width: number) => {
      setStrokeWidth(width);
      const selected = objects.find((object) => object.id === selectedId);
      if (
        selected &&
        (selected.type === "rectangle" || selected.type === "ellipse")
      ) {
        setObjects((prev) =>
          prev.map((object) =>
            object.id === selectedId
              ? { ...object, strokeWidth: width }
              : object,
          ),
        );
      }
    },
    [objects, selectedId],
  );

  const finishWidthEdit = useCallback(() => {
    const baseline = widthEditBaselineRef.current;
    widthEditBaselineRef.current = null;
    if (baseline && baseline !== objects) {
      setPast((pastStates) => [...pastStates, baseline].slice(-HISTORY_LIMIT));
      setFuture([]);
    }
  }, [objects]);

  const beginWidthEdit = useCallback(() => {
    widthEditBaselineRef.current = objects;
  }, [objects]);

  const handleClear = useCallback(() => {
    if (objects.length === 0) return;
    commit([]);
    setStatusText("Cleared");
  }, [commit, objects]);

  const cycleTool = useCallback(() => {
    const idx = TOOL_CYCLE_ORDER.indexOf(tool);
    const next = TOOL_CYCLE_ORDER[(idx + 1) % TOOL_CYCLE_ORDER.length]!;
    setTool(next);
    setStatusText(`Tool: ${next}`);
  }, [tool]);

  const handleUndo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1]!;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [objects, ...f]);
    setObjects(previous);
  }, [past, objects]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0]!;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, objects].slice(-HISTORY_LIMIT));
    setObjects(next);
  }, [future, objects]);

  const savePng = useCallback(async () => {
    setStatusText("Capturing...");
    try {
      // Let the browser finish a compositor frame before capture so the PNG
      // matches what was on screen when the user asked to save.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      const response = (await chrome.runtime.sendMessage({
        kind: "capture-visible-tab",
      } satisfies ContentToBackgroundMessage)) as CaptureVisibleTabResponse;

      if (response.kind === "capture-visible-tab-error") {
        setStatusText(`Save failed: ${response.error}`);
        return;
      }
      if (response.kind !== "capture-visible-tab-result") return;

      const screenshot = await loadImage(response.dataUrl);
      const dpr = window.devicePixelRatio || 1;
      const composite = document.createElement("canvas");
      composite.width = Math.round(window.innerWidth * dpr);
      composite.height = Math.round(window.innerHeight * dpr);
      const ctx = composite.getContext("2d")!;
      ctx.drawImage(screenshot, 0, 0, composite.width, composite.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const obj of objects) drawAnnotation(ctx, obj);

      const dataUrl = composite.toDataURL("image/png");
      const filename = `capann-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      await chrome.runtime.sendMessage({
        kind: "download-png",
        dataUrl,
        filename,
      } satisfies ContentToBackgroundMessage);
      setStatusText("Saved!");
    } catch (err) {
      setStatusText("Save failed");
      console.error("[Capann] save failed", err);
    }
  }, [objects]);

  const handleToolChange = useCallback(
    (newTool: ToolId) => {
      setTool(newTool);
      resetDrag();
    },
    [resetDrag],
  );

  const selectedShape = objects.find((object) => object.id === selectedId);
  const displayedWidth =
    selectedShape &&
    (selectedShape.type === "rectangle" || selectedShape.type === "ellipse")
      ? selectedShape.strokeWidth
      : strokeWidth;

  useEffect(() => {
    redrawSelection();
    window.addEventListener("resize", redrawSelection);
    return () => window.removeEventListener("resize", redrawSelection);
  }, [redrawSelection, tool]);

  const handleDrawModeToggle = useCallback(
    (enabled: boolean) => {
      setDrawModeEnabled(enabled);
      if (!enabled) {
        laserActiveRef.current = false;
        resetDrag();
      }
    },
    [resetDrag],
  );

  const startRecording = useCallback(async () => {
    commitTextInput();
    handleDrawModeToggle(false);
    setUiView("record");
    setRecordingStatus({ state: "starting" });
    setCaptureHidden(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      const response = await chrome.runtime.sendMessage({
        kind: "record-start",
        ...recordOptions,
      } satisfies ContentToBackgroundMessage) as { ok?: boolean; error?: string };
      if (!response?.ok) {
        const status: RecordingStatus = { state: "error", error: response?.error ?? "Could not start recording." };
        setRecordingStatus(status);
        setCaptureHidden(false);
      }
    } catch (error) {
      setRecordingStatus({ state: "error", error: error instanceof Error ? error.message : "Could not start recording." });
      setCaptureHidden(false);
    }
  }, [commitTextInput, handleDrawModeToggle, recordOptions]);

  // Initialize
  useEffect(() => {
    const init = async () => {
      try {
        const response = (await chrome.runtime.sendMessage({
          kind: "get-tab-id",
        } satisfies ContentToBackgroundMessage)) as GetTabIdResponse;
        setTabId(response.tabId);
        setRecordingStatus(response.recordingStatus);
        const isRecording = response.recordingStatus.state === "recording" || response.recordingStatus.state === "paused" || response.recordingStatus.state === "starting";
        setCaptureHidden(isRecording);
        if (isRecording) setUiView("record");
      } catch {
        setTabId(-1);
        setCaptureHidden(false);
      }
    };
    void init();
  }, []);

  // Keep the entire shadow-root host out of tabCapture frames during recording,
  // including canvases, toolbar, and any active text input.
  useEffect(() => {
    if (shadowRoot?.host instanceof HTMLElement) {
      shadowRoot.host.style.visibility = captureHidden ? "hidden" : "visible";
    }
  }, [captureHidden, shadowRoot]);

  // Restore state when tabId changes
  useEffect(() => {
    if (tabId >= 0) {
      void restoreState();
    }
  }, [tabId, restoreState]);

  // Save state when objects change
  useEffect(() => {
    scheduleSave();
  }, [objects, scheduleSave]);

  // Redraw objects when they change
  useEffect(() => {
    redrawObjects();
  }, [redrawObjects]);

  // Update pointer mode when tool or drawMode changes
  useEffect(() => {
    updatePointerMode();
  }, [updatePointerMode]);

  // Clear status text after timeout
  useEffect(() => {
    if (statusText) {
      const timer = setTimeout(() => setStatusText(""), 2500);
      return () => clearTimeout(timer);
    }
  }, [statusText]);

  // Handle window resize
  useEffect(() => {
    resizeCanvases();
    window.addEventListener("resize", resizeCanvases);
    return () => window.removeEventListener("resize", resizeCanvases);
  }, [resizeCanvases]);

  // Handle window pointer move for laser/spotlight
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      if (drawModeEnabled && (tool === "laser" || tool === "spotlight")) {
        laserActiveRef.current = true;
        if (tool === "laser") {
          laserTrailRef.current.push({
            point: cursorRef.current,
            time: performance.now(),
          });
        }
      }
    };

    const handlePointerLeave = () => {
      laserActiveRef.current = false;
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [drawModeEnabled, tool]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawModeEnabled && !captureHidden) setDrawModeEnabled(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawModeEnabled, captureHidden]);

  // Handle extension action, keyboard, and recorder status messages.
  useEffect(() => {
    const handleMessage = (message: BackgroundToContentMessage) => {
      switch (message.kind) {
        case "toggle-capann-ui":
          setUiView((view) => view === "closed" ? "chooser" : "closed");
          break;
        case "clear-annotations":
          handleClear();
          break;
        case "cycle-tool":
          cycleTool();
          break;
        case "recording-status": {
          setRecordingStatus(message.status);
          const active = message.status.state === "recording" || message.status.state === "paused" || message.status.state === "starting";
          setCaptureHidden(active);
          if (!active) {
            setUiView("record");
            setStatusText(message.status.state === "saved" ? "Recording saved" : message.status.state === "discarded" ? "Recording discarded" : message.status.state === "error" ? message.status.error : "");
          }
          break;
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [handleClear, cycleTool]);

  const hiddenByCapture = captureHidden ? { visibility: "hidden" as const } : undefined;
  const closeUi = () => {
    setUiView("closed");
    handleDrawModeToggle(false);
  };
  const surface: React.CSSProperties = {
    position: "fixed", top: "48px", right: "56px", zIndex: 2147483647,
    boxSizing: "border-box", width: "min(280px, calc(100vw - 32px))", padding: "16px",
    borderRadius: "24px", background: "rgba(28,28,32,0.88)", color: "#F5F5F7",
    border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)", font: "400 13px/1.45 Manrope, Inter, system-ui, sans-serif",
    boxShadow: "0 18px 52px rgba(0,0,0,.28)",
  };
  const surfaceButton: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "12px 14px",
    background: "#26262B", color: "#F5F5F7", cursor: "pointer", font: "500 13px/1.2 Manrope, Inter, system-ui, sans-serif",
  };
  const recordingIsActive = recordingStatus.state === "recording" || recordingStatus.state === "paused" || recordingStatus.state === "starting";

  return (
    <>
      <style>{`
        .canvas-wrapper {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 2147483646;
        }
        canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        .text-input {
          position: fixed;
          z-index: 2147483647;
          font-family: system-ui, sans-serif;
          font-weight: 600;
          border: 1.5px dashed #7c3aed;
          background: rgba(255,255,255,0.9);
          padding: 2px 4px;
          outline: none;
          resize: none;
          min-width: 60px;
          line-height: 1.2;
        }
      `}</style>
      <div style={hiddenByCapture}>
        {uiView === "chooser" && <section style={surface} aria-label="Capann workspace chooser">
          <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <img src={chrome.runtime.getURL("icons/capann-logo.png")} alt="" width="32" height="32" style={{ borderRadius: 9 }} />
            <div style={{ flex: 1 }}><strong style={{ fontSize: 15 }}>Capann</strong><div style={{ color: "#8B8B93", fontSize: 11 }}>Choose a workspace</div></div>
            <button onClick={closeUi} aria-label="Close Capann" style={{ ...surfaceButton, padding: "6px 10px", color: "#8B8B93" }}>×</button>
          </header>
          <div style={{ display: "grid", gap: 8 }}>
            <button onClick={() => { setStatusText(""); setRecordingStatus({ state: "idle" }); setUiView("record"); }} style={{ ...surfaceButton, textAlign: "left" }}><b>●　Record</b><span style={{ display: "block", margin: "5px 0 0 24px", color: "#8B8B93", fontSize: 11 }}>Capture this tab with camera and audio</span></button>
            <button onClick={() => { setUiView("annotate"); handleDrawModeToggle(false); }} style={{ ...surfaceButton, textAlign: "left" }}><b>✎　Annotate</b><span style={{ display: "block", margin: "5px 0 0 24px", color: "#8B8B93", fontSize: 11 }}>Draw and mark up this tab</span></button>
          </div>
        </section>}

        {uiView === "annotate" && <>
          <Toolbar
            defaultExpanded
            onToolChange={handleToolChange}
            onColorChange={setColor}
            onWidthChange={changeWidth}
            onWidthEditStart={beginWidthEdit}
            onWidthEditComplete={finishWidthEdit}
            onHeadStyleChange={setHeadStyle}
            onFilledChange={setFilled}
            onClear={handleClear}
            onSavePng={() => void savePng()}
            onDrawModeToggle={handleDrawModeToggle}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            drawModeEnabled={drawModeEnabled}
            currentTool={tool}
            currentColor={color}
            currentWidth={displayedWidth}
            currentHeadStyle={headStyle}
            currentFilled={filled}
            statusText={statusText}
          />
          <button onClick={closeUi} title="Close Capann" aria-label="Close Capann" style={{ position: "fixed", top: "52px", right: "278px", zIndex: 2147483647, width: 30, height: 30, border: "1px solid rgba(255,255,255,.1)", borderRadius: 999, background: "rgba(28,28,32,.9)", color: "#8B8B93", cursor: "pointer" }}>×</button>
        </>}

        {uiView === "record" && <section style={surface} aria-label="Capann recorder">
          <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <img src={chrome.runtime.getURL("icons/capann-logo.png")} alt="" width="30" height="30" style={{ borderRadius: 8 }} />
            <strong style={{ flex: 1, fontSize: 15 }}>Record this tab</strong>
            {!recordingIsActive && <button onClick={() => setUiView("chooser")} aria-label="Back to Capann choices" style={{ ...surfaceButton, padding: "6px 10px", color: "#8B8B93" }}>‹</button>}
            {!recordingIsActive && <button onClick={closeUi} aria-label="Close Capann" style={{ ...surfaceButton, padding: "6px 10px", color: "#8B8B93" }}>×</button>}
          </header>
          <p style={{ margin: "0 0 12px", color: "#8B8B93", fontSize: 11 }}>Capann’s UI and annotations are hidden from the saved video.</p>
          <div style={{ display: "grid", gap: 10 }}>
            {([
              ["Camera bubble", "camera"],
              ["Microphone", "microphone"],
              ["Tab audio", "tabAudio"],
            ] as const).map(([label, key]) => <label key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: recordingIsActive ? "#66666F" : "#F5F5F7" }}>
              {label}<input type="checkbox" checked={recordOptions[key]} disabled={recordingIsActive} onChange={(event) => setRecordOptions((options) => ({ ...options, [key]: event.target.checked }))} />
            </label>)}
          </div>
          {!recordingIsActive && <button onClick={() => void startRecording()} style={{ ...surfaceButton, width: "100%", marginTop: 14, background: "#A78BFA", border: 0, color: "#17131F", fontWeight: 700 }}>Start recording</button>}
          {recordingStatus.state === "starting" && <p role="status" style={{ color: "#F5E8A6", margin: "14px 0 0" }}>Preparing capture…</p>}
          {recordingStatus.state === "recording" && <p role="status" style={{ color: "#86EFAC", margin: "14px 0 0" }}>Recording in progress. Use the Capann icon to stop and save, Alt+Shift+T to pause/resume, or Alt+Shift+C to discard.</p>}
          {recordingStatus.state === "paused" && <p role="status" style={{ color: "#F5E8A6", margin: "14px 0 0" }}>Recording paused. Use Alt+Shift+T to resume or the Capann icon to save.</p>}
          {recordingStatus.state === "error" && <p role="alert" style={{ color: "#FCA5A5", margin: "14px 0 0" }}>{recordingStatus.error}</p>}
          {recordingStatus.state === "saved" && <p role="status" style={{ color: "#86EFAC", margin: "14px 0 0" }}>Saved {recordingStatus.filename}</p>}
          {recordingStatus.state === "discarded" && <p role="status" style={{ color: "#8B8B93", margin: "14px 0 0" }}>Recording discarded.</p>}
          {(recordingStatus.state === "recording" || recordingStatus.state === "paused") && recordingStatus.unavailable.length > 0 && <p style={{ color: "#F5E8A6", fontSize: 11 }}>Unavailable: {recordingStatus.unavailable.join(", ")}</p>}
        </section>}

        <div className="canvas-wrapper">
          <canvas ref={objectsCanvasRef} />
          <canvas
            ref={liveCanvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelPointer}
          />
        </div>
      </div>
    </>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
