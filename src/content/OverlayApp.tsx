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
  benderHandle,
  cursorForHandle,
  findTopmostHit,
  handleAtPoint,
  handlesForBounds,
  hitTest,
  isBenderHandle,
  resizeAnnotation,
  shapeContains,
  translateAnnotation,
} from "./geometry";
import { drawAnnotation, redrawAll } from "./render";
import { CapannShell, SHELL_BUTTON } from "./shell";
import { AnnotateControls } from "./annotate-controls";
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

/** Screen-mask modes and presentation. */
const MASK_LABELS = ["Screen", "Blackout", "Whiteout"];
const MASK_COLORS = ["#0A0A0C", "#0A0A0C", "#FFFFFF"];
const MASK_OPACITIES = [0, 0.94, 0.94];
const MASK_SWATCHES = ["transparent", "#0A0A0C", "#FFFFFF"];

const UNDO_ICON = "M9 7L5 11l4 4M5 11h8a5 5 0 010 10h-3";
const REDO_ICON = "M15 7l4 4-4 4M19 11h-8a5 5 0 000 10h3";
const DUPLICATE_ICON = "M9 9h10v10H9zM5 15V5h10";

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
  const [uiView, setUiView] = useState<
    "closed" | "chooser" | "annotate" | "record"
  >("closed");
  const [captureHidden, setCaptureHidden] = useState(true);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>({
    state: "idle",
  });
  const [recordOptions, setRecordOptions] = useState<RecordOptions>({
    camera: true,
    microphone: true,
    tabAudio: true,
  });
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
  // Session controls live at the shell level so they survive view switches
  // and are independent of any single view. Their close buttons only remove
  // the feature, never Capann itself.
  const [timerOn, setTimerOn] = useState(false);
  const [maskOn, setMaskOn] = useState(false);
  const [maskMode, setMaskMode] = useState(0); // 0 = screen, 1 = blackout, 2 = whiteout
  const [seconds, setSeconds] = useState(754);

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
    kind: "move" | "resize" | "bend";
    object: AnnotationObject;
    start: Point;
    handle: number;
    baseline: AnnotationObject[];
  } | null>(null);
  const widthEditBaselineRef = useRef<AnnotationObject[] | null>(null);

  const objectsCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<number | undefined>(undefined);

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
    const id = makeId();
    commit([
      ...objects,
      {
        id,
        type: "text",
        color,
        strokeWidth,
        createdAt: Date.now(),
        position: point,
        text,
        fontSize: Math.max(14, strokeWidth * 4),
      },
    ]);
    setSelectedId(id);
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
      // Freeform transformer: 8 handles for every resizable type
      // (rectangle, ellipse, arrow, text). Strokes move but don't resize.
      if (
        ann.type !== "rectangle" &&
        ann.type !== "ellipse" &&
        ann.type !== "arrow" &&
        ann.type !== "text"
      )
        return -1;
      return handleAtPoint(point, ann);
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
      if (
        ann.type === "rectangle" ||
        ann.type === "ellipse" ||
        ann.type === "arrow" ||
        ann.type === "text"
      ) {
        for (const corner of handlesForBounds(b)) {
          ctx.beginPath();
          ctx.arc(corner.x, corner.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      // Bender midpoint handle: drag to adjust the curve (Preview-style).
      if (ann.type === "arrow" && ann.headStyle === "bender") {
        const mid = benderHandle(ann);
        if (mid) {
          ctx.beginPath();
          ctx.arc(mid.x, mid.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "#86EFAC";
          ctx.fill();
          ctx.strokeStyle = "#0A2E1B";
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
        // Bender midpoint gets priority over the box handles: dragging it
        // reshapes the curve instead of resizing the bounding box.
        if (
          selected?.type === "arrow" &&
          selected.headStyle === "bender" &&
          isBenderHandle(point, selected)
        ) {
          selectionDragRef.current = {
            kind: "bend",
            object: selected,
            start: point,
            handle: -1,
            baseline: objects,
          };
          return;
        }
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
        const liveCanvas = liveCanvasRef.current!;
        if (
          selectionDrag.kind === "bend" &&
          selectionDrag.object.type === "arrow"
        ) {
          // New bend = signed distance of the cursor from the chord
          // midpoint along the chord normal, clamped to stay sane.
          const src = selectionDrag.object;
          const mx = (src.start.x + src.end.x) / 2;
          const my = (src.start.y + src.end.y) / 2;
          const dxc = src.end.x - src.start.x;
          const dyc = src.end.y - src.start.y;
          const len = Math.hypot(dxc, dyc) || 1;
          const bend = Math.max(
            -300,
            Math.min(
              300,
              ((point.x - mx) * -dyc + (point.y - my) * dxc) / len,
            ),
          );
          const preview = { ...src, bend };
          clearLive();
          drawAnnotation(liveCanvas.getContext("2d")!, preview);
          drawSelection(liveCanvas.getContext("2d")!, preview);
          liveCanvas.style.cursor = "grabbing";
          return;
        }
        const preview =
          selectionDrag.kind === "resize"
            ? resizeAnnotation(selectionDrag.object, selectionDrag.handle, point)
            : translateAnnotation(selectionDrag.object, dx, dy);
        clearLive();
        drawAnnotation(liveCanvas.getContext("2d")!, preview);
        drawSelection(liveCanvas.getContext("2d")!, preview);
        // Active-drag cursor: grabbing for moves, edge cursor for resizes.
        liveCanvas.style.cursor =
          selectionDrag.kind === "resize"
            ? cursorForHandle(selectionDrag.handle)
            : "grabbing";
        return;
      }

      // Hover cursor for the select tool (no buttons down): handles show
      // their resize direction, Bender midpoint shows move, hovering a
      // shape shows it can be dragged, empty canvas shows default.
      if (tool === "select" && !selectionDrag) {
        const liveCanvas = liveCanvasRef.current;
        if (liveCanvas) {
          const selected = objects.find((o) => o.id === selectedId);
          let cursor = "default";
          if (
            selected?.type === "arrow" &&
            selected.headStyle === "bender" &&
            isBenderHandle(point, selected)
          ) {
            cursor = "move";
          } else if (selected) {
            const h = getSelectedHandle(point, selected);
            if (h >= 0) cursor = cursorForHandle(h);
            else if (findSelectable(point, objects)) cursor = "move";
          } else if (findSelectable(point, objects)) {
            cursor = "move";
          }
          if (liveCanvas.style.cursor !== cursor)
            liveCanvas.style.cursor = cursor;
        }
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
        // Bender previews with its default curve so users see the bend
        // before release; straight heads preview as straight lines.
        const bend = headStyle === "bender" ? 48 : 0;
        drawAnnotation(ctx, {
          id: "preview",
          type: "arrow",
          color,
          strokeWidth,
          createdAt: 0,
          start: dragStartRef.current,
          end: point,
          headStyle,
          ...(bend !== 0 ? { bend } : {}),
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
      getSelectedHandle,
      findSelectable,
      objects,
      selectedId,
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
        let updated: AnnotationObject;
        if (
          selectionDrag.kind === "bend" &&
          selectionDrag.object.type === "arrow"
        ) {
          const src = selectionDrag.object;
          const mx = (src.start.x + src.end.x) / 2;
          const my = (src.start.y + src.end.y) / 2;
          const dxc = src.end.x - src.start.x;
          const dyc = src.end.y - src.start.y;
          const len = Math.hypot(dxc, dyc) || 1;
          const bend = Math.max(
            -300,
            Math.min(
              300,
              ((point.x - mx) * -dyc + (point.y - my) * dxc) / len,
            ),
          );
          updated = { ...src, bend };
        } else if (selectionDrag.kind === "resize") {
          updated = resizeAnnotation(
            selectionDrag.object,
            selectionDrag.handle,
            point,
          );
        } else {
          updated = translateAnnotation(selectionDrag.object, dx, dy);
        }
        const next = selectionDrag.baseline.map((object) =>
          object.id === updated.id ? updated : object,
        );
        if (
          dx !== 0 ||
          dy !== 0 ||
          selectionDrag.kind === "resize" ||
          selectionDrag.kind === "bend"
        )
          commit(next);
        clearLive();
        if (drawModeEnabled) {
          const ctx = liveCanvasRef.current?.getContext("2d");
          if (ctx) drawSelection(ctx, updated);
        }
        // Reset cursor after the drag so a stale grabbing hand doesn't stick.
        if (liveCanvasRef.current) liveCanvasRef.current.style.cursor = "move";
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
          const id = makeId();
          commit([
            ...objects,
            {
              id,
              type: tool,
              color,
              strokeWidth,
              createdAt: Date.now(),
              points,
            },
          ]);
          // Select the new mark so Duplicate appears immediately.
          setSelectedId(id);
        }
      } else if (dragStart && tool === "arrow") {
        const id = makeId();
        commit([
          ...objects,
          {
            id,
            type: "arrow",
            color,
            strokeWidth,
            createdAt: Date.now(),
            start: dragStart,
            end: point,
            headStyle,
            ...(headStyle === "bender" ? { bend: 48 } : {}),
          },
        ]);
        setSelectedId(id);
      } else if (dragStart && (tool === "rectangle" || tool === "ellipse")) {
        const id = makeId();
        commit([
          ...objects,
          {
            id,
            type: tool,
            color,
            strokeWidth,
            createdAt: Date.now(),
            start: dragStart,
            end: point,
            filled,
          },
        ]);
        setSelectedId(id);
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
        (selected.type === "rectangle" ||
          selected.type === "ellipse" ||
          selected.type === "arrow")
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
    setSelectedId(null);
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

  /**
   * Duplicate the selected annotation with a small offset, so users can
   * stamp out copies without redrawing. Commits to history (undoable) and
   * selects the copy. No-op when nothing is selected.
   */
  const duplicateSelected = useCallback(() => {
    const selected = objects.find((object) => object.id === selectedId);
    if (!selected) return;
    const id = makeId();
    const copy = translateAnnotation(
      { ...selected, id, createdAt: Date.now() },
      16,
      16,
    ) as AnnotationObject;
    // translateAnnotation preserves the fresh id (it only shifts coords).
    commit([...objects, { ...copy, id }]);
    setSelectedId(id);
    setStatusText("Duplicated");
  }, [objects, selectedId, makeId, commit]);

  const startTimer = useCallback((minutes: number) => {
    setSeconds(minutes * 60);
    setTimerOn(true);
  }, []);

  const dropTimer = useCallback(() => {
    setTimerOn(false);
  }, []);

  const addMask = useCallback(() => {
    setMaskOn(true);
    setMaskMode(0);
  }, []);

  const cycleMask = useCallback(() => {
    setMaskMode((m) => (m + 1) % 3);
  }, []);

  const closeMask = useCallback(() => {
    setMaskOn(false);
  }, []);

  const formatTime = useCallback((secs: number) => {
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }, []);

  const goBackToChooser = useCallback(() => {
    // Back never clears annotations or resets tool settings.
    commitTextInput();
    setUiView("chooser");
  }, [commitTextInput]);

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
    (selectedShape.type === "rectangle" ||
      selectedShape.type === "ellipse" ||
      selectedShape.type === "arrow")
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
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    try {
      const response = (await chrome.runtime.sendMessage({
        kind: "record-start",
        ...recordOptions,
      } satisfies ContentToBackgroundMessage)) as {
        ok?: boolean;
        error?: string;
      };
      if (!response?.ok) {
        const status: RecordingStatus = {
          state: "error",
          error: response?.error ?? "Could not start recording.",
        };
        setRecordingStatus(status);
        setCaptureHidden(false);
      }
    } catch (error) {
      setRecordingStatus({
        state: "error",
        error:
          error instanceof Error ? error.message : "Could not start recording.",
      });
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
        const isRecording =
          response.recordingStatus.state === "recording" ||
          response.recordingStatus.state === "paused" ||
          response.recordingStatus.state === "starting";
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
  // including canvases, shell, and any active text input.
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

  // Countdown timer ticks at the shell level, independent of the active view.
  useEffect(() => {
    if (timerOn) {
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => (s > 0 ? s - 1 : 0));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [timerOn]);

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

  // Handle Escape (exit draw mode, keep marks) and Ctrl/Cmd+D (duplicate).
  // Esc never clears annotations or closes the panel — it only returns
  // pointer events to the page. Ctrl+D is handled in-page (not a manifest
  // command) because Chrome reserves it for bookmarks; preventDefault stops
  // the bookmark tab from opening. Meta+D covers macOS.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawModeEnabled && !captureHidden)
        setDrawModeEnabled(false);
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "d" || e.key === "D") &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawModeEnabled, captureHidden, duplicateSelected]);

  // Handle extension action, keyboard, and recorder status messages.
  // Alt+Shift+S (toggle-capann-ui) only toggles draw mode while the panel
  // is open; when closed it opens the chooser. It never closes the panel.
  useEffect(() => {
    const handleMessage = (message: BackgroundToContentMessage) => {
      switch (message.kind) {
        case "toggle-capann-ui":
          if (uiView === "closed") {
            setUiView("chooser");
          } else if (uiView === "chooser") {
            setUiView("annotate");
            setDrawModeEnabled(true);
          } else if (uiView === "annotate") {
            handleDrawModeToggle(!drawModeEnabled);
          }
          // Record view owns its shortcuts (pause/resume/discard); ignore.
          break;
        case "clear-annotations":
          handleClear();
          break;
        case "cycle-tool":
          cycleTool();
          break;
        case "recording-status": {
          setRecordingStatus(message.status);
          const active =
            message.status.state === "recording" ||
            message.status.state === "paused" ||
            message.status.state === "starting";
          setCaptureHidden(active);
          if (!active) {
            setUiView("record");
            setStatusText(
              message.status.state === "saved"
                ? "Recording saved"
                : message.status.state === "discarded"
                  ? "Recording discarded"
                  : message.status.state === "error"
                    ? message.status.error
                    : "",
            );
          }
          break;
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [handleClear, cycleTool, uiView, drawModeEnabled, handleDrawModeToggle]);

  const hiddenByCapture = captureHidden
    ? { visibility: "hidden" as const }
    : undefined;
  const closeUi = () => {
    setUiView("closed");
    handleDrawModeToggle(false);
  };
  const recordingIsActive =
    recordingStatus.state === "recording" ||
    recordingStatus.state === "paused" ||
    recordingStatus.state === "starting";
  const warn = seconds < 120;

  // Render fallback notices for unavailable inputs during recording.
  const renderUnavailableNotices = () => {
    const status = recordingStatus as { unavailable?: string[] };
    if (!status.unavailable || status.unavailable.length === 0) return null;
    return status.unavailable.map((item: string) => {
      let message = "";
      if (item === "camera")
        message =
          "Camera unavailable — your recording will continue without the camera bubble.";
      else if (item === "microphone")
        message =
          "Microphone unavailable — your recording will continue without microphone audio.";
      else if (item === "tab audio")
        message =
          "Tab audio unavailable — your recording will continue without audio from this tab.";
      else
        message = `${item} unavailable — your recording will continue without it.`;
      return (
        <p
          key={item}
          role="status"
          style={{ color: "#F5E8A6", fontSize: 11, margin: "8px 0 0" }}
        >
          {message}
        </p>
      );
    });
  };

  // Annotate undo/redo/duplicate live in the shared shell header.
  // Duplicate only shows when an annotation is selected (which includes
  // right after drawing, since new marks auto-select).
  const annotateActions = (
    <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
      <button
        onClick={() => handleUndo()}
        title="Undo"
        style={{
          width: "26px",
          height: "26px",
          borderRadius: "12px",
          background: "transparent",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: past.length > 0 ? "pointer" : "default",
        }}
        onMouseEnter={(e) =>
          past.length > 0 && (e.currentTarget.style.background = "#26262B")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path
            d={UNDO_ICON}
            stroke={past.length > 0 ? "#F5F5F7" : "rgba(139,139,147,0.45)"}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        onClick={() => handleRedo()}
        title="Redo"
        style={{
          width: "26px",
          height: "26px",
          borderRadius: "12px",
          background: "transparent",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: future.length > 0 ? "pointer" : "default",
        }}
        onMouseEnter={(e) =>
          future.length > 0 && (e.currentTarget.style.background = "#26262B")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path
            d={REDO_ICON}
            stroke={future.length > 0 ? "#F5F5F7" : "rgba(139,139,147,0.45)"}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {selectedId && (
        <button
          onClick={() => duplicateSelected()}
          title="Duplicate selected (Ctrl+D)"
          style={{
            width: "26px",
            height: "26px",
            borderRadius: "12px",
            background: "transparent",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "#26262B")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path
              d={DUPLICATE_ICON}
              stroke="#F5F5F7"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );

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
        {uiView === "chooser" && (
          <CapannShell
            title="Capann"
            subtitle="Choose a workspace"
            showBack={false}
            onBack={goBackToChooser}
            onClose={closeUi}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <button
                onClick={() => {
                  setStatusText("");
                  setRecordingStatus({ state: "idle" });
                  setUiView("record");
                }}
                style={{ ...SHELL_BUTTON, textAlign: "left" }}
              >
                <b>●　Record</b>
                <span
                  style={{
                    display: "block",
                    margin: "5px 0 0 24px",
                    color: "#8B8B93",
                    fontSize: 11,
                  }}
                >
                  Capture this tab with camera and audio
                </span>
              </button>
              <button
                onClick={() => {
                  setUiView("annotate");
                  handleDrawModeToggle(false);
                }}
                style={{ ...SHELL_BUTTON, textAlign: "left" }}
              >
                <b>✎　Annotate</b>
                <span
                  style={{
                    display: "block",
                    margin: "5px 0 0 24px",
                    color: "#8B8B93",
                    fontSize: 11,
                  }}
                >
                  Draw and mark up this tab
                </span>
              </button>
            </div>
          </CapannShell>
        )}

        {uiView === "annotate" && (
          <CapannShell
            title="Annotate"
            subtitle={
              drawModeEnabled ? undefined : "Pick a tool to start drawing"
            }
            showBack
            onBack={goBackToChooser}
            onClose={closeUi}
            actions={annotateActions}
          >
            <AnnotateControls
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
              onStartTimer={startTimer}
              onAddMask={addMask}
              timerOn={timerOn}
              maskOn={maskOn}
              drawModeEnabled={drawModeEnabled}
              currentTool={tool}
              currentColor={color}
              currentWidth={displayedWidth}
              currentHeadStyle={headStyle}
              currentFilled={filled}
              statusText={statusText}
            />
          </CapannShell>
        )}

        {uiView === "record" && (
          <CapannShell
            title="Record this tab"
            showBack={!recordingIsActive}
            onBack={goBackToChooser}
            onClose={closeUi}
          >
            <p style={{ margin: "0 0 12px", color: "#8B8B93", fontSize: 11 }}>
              Capann's UI and annotations are hidden from the saved video.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              {(
                [
                  ["Camera bubble", "camera"],
                  ["Microphone", "microphone"],
                  ["Tab audio", "tabAudio"],
                ] as const
              ).map(([label, key]) => (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    color: recordingIsActive ? "#66666F" : "#F5F5F7",
                  }}
                >
                  {label}
                  <input
                    type="checkbox"
                    checked={recordOptions[key]}
                    disabled={recordingIsActive}
                    onChange={(event) =>
                      setRecordOptions((options) => ({
                        ...options,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            {!recordingIsActive && (
              <button
                onClick={() => void startRecording()}
                style={{
                  ...SHELL_BUTTON,
                  width: "100%",
                  marginTop: 14,
                  background: "#A78BFA",
                  border: 0,
                  color: "#17131F",
                  fontWeight: 700,
                }}
              >
                Start recording
              </button>
            )}
            {recordingStatus.state === "starting" && (
              <p role="status" style={{ color: "#F5E8A6", margin: "14px 0 0" }}>
                Preparing capture…
              </p>
            )}
            {recordingStatus.state === "recording" && (
              <>
                <p
                  role="status"
                  style={{ color: "#86EFAC", margin: "14px 0 0" }}
                >
                  Recording in progress. Use the Capann icon to stop and save,
                  Alt+Shift+T to pause/resume, or Alt+Shift+C to discard.
                </p>
                {renderUnavailableNotices()}
              </>
            )}
            {recordingStatus.state === "paused" && (
              <>
                <p
                  role="status"
                  style={{ color: "#F5E8A6", margin: "14px 0 0" }}
                >
                  Recording paused. Use Alt+Shift+T to resume or the Capann icon
                  to save.
                </p>
                {renderUnavailableNotices()}
              </>
            )}
            {recordingStatus.state === "error" && (
              <p role="alert" style={{ color: "#FCA5A5", margin: "14px 0 0" }}>
                {recordingStatus.error}
              </p>
            )}
            {recordingStatus.state === "saved" && (
              <p role="status" style={{ color: "#86EFAC", margin: "14px 0 0" }}>
                Saved {recordingStatus.filename}
              </p>
            )}
            {recordingStatus.state === "discarded" && (
              <p role="status" style={{ color: "#8B8B93", margin: "14px 0 0" }}>
                Recording discarded.
              </p>
            )}
          </CapannShell>
        )}

        {/* Timer chip (bottom-left) — independent of the active view */}
        {uiView !== "closed" && timerOn && (
          <div
            style={{
              position: "fixed",
              left: "56px",
              bottom: "44px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              height: "34px",
              padding: "0 6px 0 12px",
              borderRadius: "999px",
              background: "rgba(28,28,32,0.72)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.08)",
              zIndex: 2147483647,
            }}
          >
            <i
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "999px",
                animation: "pulseDot 1.6s ease-in-out infinite",
                background: warn ? "#F5E8A6" : "#86EFAC",
              }}
            />
            <span
              style={{
                font: "500 13px/1 Manrope,system-ui,sans-serif",
                fontVariantNumeric: "tabular-nums",
                color: warn ? "#F5E8A6" : "#F5F5F7",
              }}
            >
              {formatTime(seconds)}
            </span>
            <span
              style={{
                font: "400 11px/1 Manrope,system-ui,sans-serif",
                color: "#8B8B93",
              }}
            >
              left
            </span>
            <button
              onClick={dropTimer}
              title="Remove timer"
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "999px",
                background: "transparent",
                border: "none",
                color: "#8B8B93",
                font: "400 14px/1 Manrope,system-ui,sans-serif",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#26262B";
                e.currentTarget.style.color = "#F5F5F7";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#8B8B93";
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Mask chip (bottom-left, next to timer) — independent of the active view */}
        {uiView !== "closed" && maskOn && (
          <div
            style={{
              position: "fixed",
              left: timerOn ? "220px" : "56px",
              bottom: "44px",
              zIndex: 2147483647,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 0,
                height: "34px",
                padding: 0,
                borderRadius: "999px",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                background:
                  maskMode === 0
                    ? "rgba(28,28,32,0.72)"
                    : "rgba(28,28,32,0.88)",
                border:
                  maskMode === 0
                    ? "1px solid rgba(255,255,255,0.08)"
                    : "1px solid rgba(167,139,250,0.55)",
              }}
            >
              <button
                onClick={cycleMask}
                title="Cycle screen mask mode"
                aria-label={`Screen mask: ${MASK_LABELS[maskMode]}. Click to change mode`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "34px",
                  padding: "0 0 0 14px",
                  border: "none",
                  borderRadius: "999px 0 0 999px",
                  cursor: "pointer",
                  background: "transparent",
                }}
              >
                <i
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "4px",
                    border: "1px solid rgba(255,255,255,0.28)",
                    background: MASK_SWATCHES[maskMode],
                  }}
                />
                <span
                  style={{
                    font: "500 13px/1 Manrope,system-ui,sans-serif",
                    color: maskMode === 0 ? "#F5F5F7" : "#A78BFA",
                  }}
                >
                  {MASK_LABELS[maskMode]}
                </span>
              </button>
              <button
                onClick={closeMask}
                title="Close screen mask"
                aria-label="Close screen mask"
                style={{
                  height: "34px",
                  width: "32px",
                  border: "none",
                  borderRadius: "0 999px 999px 0",
                  background: "transparent",
                  color: "#8B8B93",
                  font: "400 16px/1 Manrope,system-ui,sans-serif",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#26262B";
                  e.currentTarget.style.color = "#F5F5F7";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#8B8B93";
                }}
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Mask overlay — independent of the active view */}
        {uiView !== "closed" && maskOn && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              pointerEvents: "none",
              transition: "opacity 180ms cubic-bezier(0.2,0.8,0.2,1)",
              background: MASK_COLORS[maskMode],
              opacity: MASK_OPACITIES[maskMode],
              zIndex: 2147483645,
            }}
          />
        )}

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
