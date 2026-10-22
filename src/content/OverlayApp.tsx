/**
 * OverlayApp.tsx
 *
 * Main application component for the Capann overlay.
 *
 * ── FUSION POINT: read this before changing anything here ──────────────────
 *
 * This file is where Capann's two independent halves meet:
 *
 *   annotation  (tools, canvases, history, per-tab persistence)
 *   recording   (tab capture, media permission, recorder lifecycle)
 *
 * The halves themselves stay apart on purpose. `render.ts` and `geometry.ts`
 * know nothing about capture; `offscreen/recorder.ts` knows nothing about
 * annotations. This component owns both state trees and both message streams,
 * which makes it the one place where a change to one half can silently break
 * the other.
 *
 * The overlap is small and specific. Keep it that way:
 *
 * - `captureHidden` belongs to the recorder. It means "a capture may be
 *   running, keep the overlay out of the frames," and only recording status
 *   writes it.
 * - PNG export needs the SAME effect (the overlay must be off screen before a
 *   screenshot) but must NOT reuse `captureHidden`, because export is a
 *   one-shot hide that has to restore to whatever the recorder currently wants.
 *   `savePng` therefore hides the shadow host directly and restores from
 *   `captureHidden`.
 * - The shadow host is the only sanctioned way to make Capann invisible to a
 *   capture. Hiding it hides everything: canvases, shell, timer/mask chips,
 *   and any open text composer.
 *
 * If a change removes the hide step from ANY capture path, that path starts
 * screenshotting its own annotations and the PNG gains a doubled copy of every
 * object. That regression already shipped once: commit 3eaa296 replaced the
 * export's `isCapturing` flag with the recording-only `captureHidden` and never
 * rewired the export. See "Fusion code" in AGENTS.md before deleting or
 * repurposing a flag, effect, or effect-like step in this file.
 *
 * Key responsibilities:
 * - Canvas lifecycle (creation, resizing, rendering)
 * - Annotation drawing logic for all tool types (pencil, highlighter, arrow, shapes, text)
 * - Undo/redo history management, laser pointer and spotlight effects
 * - Chrome storage integration for per-tab persistence
 * - Screenshot capture and PNG export
 * - Record view, recorder pre-warm, and recording status handling
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useContext,
} from "react";
import type {
  AnnotationObject,
  ArrowHeadStyle,
  BackgroundToContentMessage,
  CaptureVisibleTabResponse,
  ContentToBackgroundMessage,
  GetTabIdResponse,
  MediaPermissionResponse,
  MediaPermissionState,
  Point,
  RecordOptions,
  RecordingStatus,
  TabAnnotationState,
  TextAnnotation,
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
import { drawAnnotation, drawTextHover, redrawAll } from "./render";
import {
  clampFontSize,
  clampWidth,
  composerMaxHeight,
  contrastColor,
  placeTextBubble,
  roundedRectPath,
  tailOutlinePath,
  tailTrianglePath,
  textFontSize,
  TEXT_BUBBLE,
} from "./text-bubble";
import { CapannShell, SHELL_BUTTON } from "./shell";
import type { ShellPosition } from "./shell";
import { AnnotateControls } from "./annotate-controls";
import { ShadowRootContext } from "./overlay";
import { MarkerCircleIcon, RecordIcon } from "@phosphor-icons/react";

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
/** Trash can, drawn at the same stroke weight as the other header icons. */
const DELETE_ICON =
  "M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9L17.5 7M10 11v5M14 11v5";

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

/**
 * Compact icon button for the shell header. One component keeps undo, redo,
 * duplicate, and delete visually identical — they previously repeated the same
 * thirty lines of inline styling, which made every new header action a
 * copy-paste operation.
 *
 * `disabled` mutes the stroke and drops the hover fill, matching how undo/redo
 * used to behave when their history stacks were empty.
 */
function HeaderIcon({
  title,
  path,
  onClick,
  disabled = false,
}: {
  title: string;
  path: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: "26px",
        height: "26px",
        borderRadius: "12px",
        background: "transparent",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "#26262B";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path
          d={path}
          stroke={disabled ? "rgba(139,139,147,0.45)" : "#F5F5F7"}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

interface TextEditor {
  container: HTMLDivElement;
  svg: SVGSVGElement;
  bodyPath: SVGPathElement;
  tailPath: SVGPathElement;
  tailOutline: SVGPathElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  anchor: Point;
  existingId: string | null;
  color: string;
  width: number;
  fontSize: number;
  strokeWidth: number;
  onResize: () => void;
}

/**
 * Size and place the DOM composer from the textarea's measured height. The
 * tail always points at the original click point, so the bubble appears to
 * grow out of the page rather than drifting away from the anchor.
 */
function positionTextEditor(editor: TextEditor): void {
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const lineHeight = Math.round(editor.fontSize * TEXT_BUBBLE.lineHeightRatio);
  const maxHeight = composerMaxHeight(editor.fontSize);

  editor.container.style.width = `${editor.width}px`;
  editor.input.style.height = "auto";
  const scrollHeight = editor.input.scrollHeight;
  const bodyHeight = Math.min(
    Math.max(scrollHeight, lineHeight + TEXT_BUBBLE.padding * 2),
    maxHeight,
  );
  editor.input.style.height = `${bodyHeight}px`;
  editor.input.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";

  const { body, tail } = placeTextBubble(
    editor.anchor,
    editor.width,
    bodyHeight,
    viewport,
  );
  const bubbleWidth = body.right - body.left;
  const bubbleHeight = body.bottom - body.top;

  editor.container.style.left = `${body.left}px`;
  editor.container.style.top = `${body.top}px`;
  editor.container.style.width = `${bubbleWidth}px`;
  editor.container.style.height = `${bubbleHeight}px`;

  editor.svg.setAttribute("viewBox", `0 0 ${bubbleWidth} ${bubbleHeight}`);
  editor.svg.setAttribute("width", `${bubbleWidth}`);
  editor.svg.setAttribute("height", `${bubbleHeight}`);
  editor.bodyPath.setAttribute("d", roundedRectPath(bubbleWidth, bubbleHeight));

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
    editor.tailPath.setAttribute("d", tailTrianglePath(localTail));
    editor.tailOutline.setAttribute("d", tailOutlinePath(localTail));
    editor.tailPath.style.display = "";
    editor.tailOutline.style.display = "";
  } else {
    editor.tailPath.style.display = "none";
    editor.tailOutline.style.display = "none";
  }

  const buttonGap = 38;
  const canUseRight = body.right + buttonGap <= viewport.width - 8;
  const canUseLeft = body.left - buttonGap >= 8;
  editor.send.style.left = "";
  editor.send.style.right = "";
  if (canUseRight) {
    editor.send.style.right = `-${buttonGap}px`;
    editor.send.style.bottom = "0px";
  } else if (canUseLeft) {
    editor.send.style.left = `-${buttonGap}px`;
    editor.send.style.bottom = "0px";
  } else {
    // Extremely narrow viewport: tuck the button into the lower-right corner.
    editor.send.style.right = "4px";
    editor.send.style.bottom = "4px";
  }
}

export function OverlayApp() {
  const shadowRoot = useContext(ShadowRootContext);
  const [tabId, setTabId] = useState(-1);
  const [uiView, setUiView] = useState<
    "closed" | "chooser" | "annotate" | "record"
  >("closed");
  /**
   * Panel drag position. Owned here rather than in `CapannShell` because each
   * view mounts a different shell instance — local state would be discarded on
   * every chooser/Annotate/Record switch and snap the panel home.
   *
   * `null` means docked top-right. Closing the panel clears it, so the next
   * open starts from the base position.
   */
  const [panelPosition, setPanelPosition] = useState<ShellPosition | null>(
    null,
  );
  /**
   * Recorder-owned: true while a capture may be running, so the whole overlay
   * stays out of the video. Only recording status / recorder lifecycle writes
   * this. Do NOT reuse it for PNG export — `savePng` hides and restores the
   * host itself so the two capture paths cannot cancel each other out.
   */
  const [captureHidden, setCaptureHidden] = useState(true);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>({
    state: "idle",
  });
  const [recordOptions, setRecordOptions] = useState<RecordOptions>({
    camera: true,
    microphone: true,
    tabAudio: true,
  });
  const [recorderPreparation, setRecorderPreparation] = useState<
    "idle" | "preparing" | "ready" | "failed"
  >("idle");
  const [startRequested, setStartRequested] = useState(false);
  const [permissionRequested, setPermissionRequested] = useState(false);
  const [mediaPermission, setMediaPermission] =
    useState<MediaPermissionState | null>(null);
  const [recorderPreparationError, setRecorderPreparationError] = useState("");
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
  // Set while a committed note is being edited in the DOM composer. The
  // canvas renderer hides that note so the composer is the only copy visible.
  const [editingId, setEditingId] = useState<string | null>(null);
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
  const editorRef = useRef<TextEditor | null>(null);
  const objectsRef = useRef<AnnotationObject[]>(objects);
  const selectionDragRef = useRef<{
    kind: "move" | "resize" | "bend";
    object: AnnotationObject;
    start: Point;
    handle: number;
    baseline: AnnotationObject[];
  } | null>(null);
  const widthEditBaselineRef = useRef<AnnotationObject[] | null>(null);
  /**
   * Guards PNG export against re-entry. A second overlapping save would restore
   * host visibility while the first capture is still in flight, leaking the
   * overlay into the first screenshot.
   */
  const savingPngRef = useRef(false);

  const objectsCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<number | undefined>(undefined);

  // The composer's event listeners outlive a render; keep the latest objects
  // in a ref so a blur/click-away commit never writes a stale snapshot.
  useLayoutEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  // Tear down a composer if the overlay itself unmounts mid-edit.
  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (!editor) return;
      window.removeEventListener("resize", editor.onResize);
      editor.container.remove();
      editorRef.current = null;
    };
  }, []);

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

    redrawAll(
      objectsCtx,
      width,
      height,
      editingId ? objects.filter((object) => object.id !== editingId) : objects,
    );
  }, [editingId, objects]);

  const redrawObjects = useCallback(() => {
    const objectsCanvas = objectsCanvasRef.current;
    if (!objectsCanvas) return;
    const ctx = objectsCanvas.getContext("2d")!;
    redrawAll(
      ctx,
      window.innerWidth,
      window.innerHeight,
      editingId ? objects.filter((object) => object.id !== editingId) : objects,
    );
  }, [editingId, objects]);

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

  /**
   * Commit or cancel the active DOM composer. Reads the latest objects from a
   * ref because the textarea's blur handler is registered once, long before a
   * later render — using the render's `objects` here would drop annotations
   * created since the composer opened.
   */
  const finishTextInput = useCallback(
    (mode: "commit" | "cancel") => {
      const editor = editorRef.current;
      if (!editor) return;
      editorRef.current = null;
      window.removeEventListener("resize", editor.onResize);

      const text = editor.input.value.trim();
      const existingId = editor.existingId;
      editor.container.remove();
      setEditingId(null);

      const current = objectsRef.current;
      const existing = existingId
        ? current.find(
            (object): object is TextAnnotation =>
              object.id === existingId && object.type === "text",
          )
        : undefined;

      // Esc leaves an existing note exactly as it was and discards a new one.
      if (mode === "cancel") return;

      if (existing) {
        if (!text) {
          objectsRef.current = current.filter(
            (object) => object.id !== existing.id,
          );
          setPast((past) => [...past, current].slice(-HISTORY_LIMIT));
          setFuture([]);
          setObjects(objectsRef.current);
          setSelectedId(null);
          return;
        }
        const width = editor.width;
        const previousWidth = existing.width ?? TEXT_BUBBLE.defaultWidth;
        if (
          text === existing.text &&
          width === previousWidth &&
          editor.fontSize === existing.fontSize
        ) {
          setSelectedId(existing.id);
          return;
        }
        const updated: TextAnnotation = {
          ...existing,
          text,
          width,
          fontSize: editor.fontSize,
        };
        objectsRef.current = current.map((object) =>
          object.id === existing.id ? updated : object,
        );
        setPast((past) => [...past, current].slice(-HISTORY_LIMIT));
        setFuture([]);
        setObjects(objectsRef.current);
        setSelectedId(existing.id);
        return;
      }

      if (!text) return;

      const annotation: TextAnnotation = {
        id: makeId(),
        type: "text",
        color: editor.color,
        strokeWidth: editor.strokeWidth,
        createdAt: Date.now(),
        position: editor.anchor,
        text,
        fontSize: editor.fontSize,
        width: editor.width,
      };
      objectsRef.current = [...current, annotation];
      setPast((past) => [...past, current].slice(-HISTORY_LIMIT));
      setFuture([]);
      setObjects(objectsRef.current);
      setSelectedId(annotation.id);
    },
    [makeId],
  );

  // Keep a stable entry point for blur, keydown, shell actions, and shortcuts.
  const finishTextInputRef = useRef(finishTextInput);
  useLayoutEffect(() => {
    finishTextInputRef.current = finishTextInput;
  }, [finishTextInput]);
  const commitTextInput = useCallback(
    () => finishTextInputRef.current("commit"),
    [],
  );

  const beginTextInput = useCallback(
    (anchor: Point, existing?: TextAnnotation) => {
      // Clicking another note commits the current draft first.
      finishTextInputRef.current("commit");
      if (!shadowRoot) return;
      // Re-read the note after that commit: its text may have just changed.
      const current = existing
        ? objectsRef.current.find(
            (object): object is TextAnnotation =>
              object.id === existing.id && object.type === "text",
          )
        : undefined;
      clearLive();

      const noteColor = current?.color ?? color;
      const width = clampWidth(current?.width ?? TEXT_BUBBLE.defaultWidth);
      const fontSize = clampFontSize(
        current?.fontSize ?? textFontSize(strokeWidth),
      );
      const lineHeight = Math.round(fontSize * TEXT_BUBBLE.lineHeightRatio);

      const container = document.createElement("div");
      container.className = "text-composer";
      container.style.setProperty("--note-color", noteColor);
      container.style.width = `${width}px`;

      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("class", "text-composer-bg");
      svg.setAttribute("overflow", "visible");
      const bodyPath = document.createElementNS(svgNS, "path");
      bodyPath.setAttribute("class", "text-composer-body");
      const tailPath = document.createElementNS(svgNS, "path");
      tailPath.setAttribute("class", "text-composer-tail");
      const tailOutline = document.createElementNS(svgNS, "path");
      tailOutline.setAttribute("class", "text-composer-tail-line");
      svg.append(bodyPath, tailPath, tailOutline);

      const input = document.createElement("textarea");
      input.className = "text-composer-input";
      input.rows = 1;
      input.placeholder = "Add comment";
      input.value = current?.text ?? "";
      input.spellcheck = false;
      input.setAttribute("aria-label", "Add comment");
      input.style.fontSize = `${fontSize}px`;
      input.style.lineHeight = `${lineHeight}px`;
      input.style.padding = `${TEXT_BUBBLE.padding}px`;

      const send = document.createElement("button");
      send.type = "button";
      send.className = "text-composer-send";
      send.title = "Send comment";
      send.tabIndex = -1;
      send.setAttribute("aria-label", "Send comment");
      send.style.background = noteColor;
      send.style.color = contrastColor(noteColor);
      send.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';

      container.append(svg, input, send);
      shadowRoot.append(container);

      const editor: TextEditor = {
        container,
        svg,
        bodyPath,
        tailPath,
        tailOutline,
        input,
        send,
        anchor,
        existingId: current?.id ?? null,
        color: noteColor,
        width,
        fontSize,
        strokeWidth: current?.strokeWidth ?? strokeWidth,
        onResize: () => positionTextEditor(editor),
      };

      editorRef.current = editor;
      setEditingId(current?.id ?? null);

      const refresh = () => {
        positionTextEditor(editor);
        send.disabled = input.value.trim().length === 0;
      };

      input.addEventListener("input", refresh);
      input.addEventListener("blur", () => {
        finishTextInputRef.current("commit");
      });
      input.addEventListener("keydown", (event) => {
        // Let IME composition (e.g. Japanese) own Enter and Escape.
        if (event.isComposing) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          finishTextInputRef.current("commit");
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finishTextInputRef.current("cancel");
        }
      });
      // Keep the textarea focused when the arrow is pressed; commit from
      // pointerdown so the button never triggers a second blur-commit.
      send.addEventListener("mousedown", (event) => event.preventDefault());
      send.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        finishTextInputRef.current("commit");
      });
      send.addEventListener("click", (event) => {
        event.preventDefault();
        finishTextInputRef.current("commit");
      });

      window.addEventListener("resize", editor.onResize);
      refresh();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
    [shadowRoot, clearLive, color, strokeWidth],
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

  const findTextAnnotation = useCallback(
    (point: Point, list: AnnotationObject[]) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const candidate = list[i]!;
        if (candidate.type === "text" && hitTest(point, candidate))
          return candidate;
      }
      return undefined;
    },
    [],
  );

  const redrawSelection = useCallback(() => {
    clearLive();
    if (!drawModeEnabled || !selectedId || selectedId === editingId) return;
    const selected = objects.find((object) => object.id === selectedId);
    const ctx = liveCanvasRef.current?.getContext("2d");
    if (selected && ctx) drawSelection(ctx, selected);
  }, [
    clearLive,
    drawModeEnabled,
    drawSelection,
    editingId,
    objects,
    selectedId,
  ]);

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
        // The composer focuses its textarea while handling this pointerdown.
        // Stop the canvas's default focus action, which would otherwise blur
        // the new textarea in the same tick and commit an empty note.
        e.preventDefault();
        const target = findTextAnnotation(point, objectsRef.current);
        beginTextInput(target?.position ?? point, target);
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
      findTextAnnotation,
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

      if (tool === "text") {
        const liveCanvas = liveCanvasRef.current;
        if (liveCanvas) {
          // Rebuild the selection layer, then add a soft halo over any note
          // under the cursor. No transform or size change on hover.
          redrawSelection();
          const target = findTextAnnotation(point, objectsRef.current);
          const ctx = liveCanvas.getContext("2d");
          if (ctx && target && target.id !== editingId)
            drawTextHover(ctx, target);
        }
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
            Math.min(300, ((point.x - mx) * -dyc + (point.y - my) * dxc) / len),
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
            ? resizeAnnotation(
                selectionDrag.object,
                selectionDrag.handle,
                point,
              )
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
      findTextAnnotation,
      redrawSelection,
      editingId,
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
            Math.min(300, ((point.x - mx) * -dyc + (point.y - my) * dxc) / len),
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
      if (!selected) return;
      if (selected.type === "text") {
        setObjects((prev) =>
          prev.map((object) =>
            object.id === selectedId
              ? {
                  ...object,
                  fontSize: textFontSize(width),
                  strokeWidth: width,
                }
              : object,
          ),
        );
        return;
      }
      if (
        selected.type === "rectangle" ||
        selected.type === "ellipse" ||
        selected.type === "arrow"
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
    // Flush an open text note first so the slider's undo baseline includes the
    // committed text rather than the pre-blur snapshot.
    commitTextInput();
    widthEditBaselineRef.current = objectsRef.current;
  }, [commitTextInput]);

  const handleClear = useCallback(() => {
    // Flush an open composer first so the clear also removes the note being
    // edited and undo can restore the whole pre-clear state.
    commitTextInput();
    const current = objectsRef.current;
    if (current.length === 0) return;
    setPast((pastStates) => [...pastStates, current].slice(-HISTORY_LIMIT));
    setFuture([]);
    objectsRef.current = [];
    setObjects([]);
    setSelectedId(null);
    setStatusText("Cleared");
  }, [commitTextInput]);

  const cycleTool = useCallback(() => {
    commitTextInput();
    const idx = TOOL_CYCLE_ORDER.indexOf(tool);
    const next = TOOL_CYCLE_ORDER[(idx + 1) % TOOL_CYCLE_ORDER.length]!;
    setTool(next);
    setStatusText(`Tool: ${next}`);
  }, [commitTextInput, tool]);

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

  /**
   * Remove the selected annotation. Undoable, and the selection is cleared so
   * the header's Duplicate/Delete controls disappear with the object.
   *
   * `objectsRef` is updated in the same step as the state, matching the other
   * mutation paths: the text composer's blur handler and PNG export both read
   * the ref and must not observe a pre-delete list.
   */
  const deleteSelected = useCallback(() => {
    // Flush an open composer first, so deleting a note that is being edited
    // cannot leave the composer attached to a now-missing object.
    commitTextInput();
    const id = selectedId;
    if (!id) return;
    const current = objectsRef.current;
    const next = current.filter((object) => object.id !== id);
    if (next.length === current.length) return;
    objectsRef.current = next;
    setPast((pastStates) => [...pastStates, current].slice(-HISTORY_LIMIT));
    setFuture([]);
    setObjects(next);
    setSelectedId(null);
    setStatusText("Deleted");
  }, [commitTextInput, selectedId]);

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

  /**
   * Export the visible tab with annotations burned in.
   *
   * ORDERING IS LOAD-BEARING, for the same reason it is in `startRecording`:
   * a capture must never see Capann's own UI.
   *
   *   1. hide the shadow host synchronously
   *   2. wait two animation frames so the compositor paints it hidden
   *   3. capture the tab        -> pixels contain the page only
   *   4. restore the host       -> composition no longer needs the DOM
   *   5. draw each annotation once onto the screenshot
   *
   * Step 5 is why step 1 exists. If the overlay is still visible when
   * `capture-visible-tab` runs, the screenshot already contains the rendered
   * objects and step 5 doubles every stroke, arrowhead, and outline.
   *
   * The hide is deliberately local (host style) rather than reusing
   * `captureHidden`: that flag belongs to the recorder's lifecycle and must
   * survive this function unchanged. Sharing it is exactly what broke export
   * before — see the fusion note at the top of this file.
   */
  const savePng = useCallback(async () => {
    if (savingPngRef.current) return;
    savingPngRef.current = true;

    // Flush an open note first so the export contains the committed bubble
    // rather than the DOM composer.
    commitTextInput();
    setStatusText("Capturing...");

    const host =
      shadowRoot?.host instanceof HTMLElement ? shadowRoot.host : null;
    // Restore to whatever the recorder currently wants — not blindly visible.
    const restoreHost = () => {
      if (host) host.style.visibility = captureHidden ? "hidden" : "visible";
    };

    // Hide before the paint. The click handler runs before React commits, and
    // `capture-visible-tab` reads whatever is currently on screen, so a state
    // update alone is one frame too late.
    try {
      if (host) host.style.visibility = "hidden";

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      const response = (await chrome.runtime.sendMessage({
        kind: "capture-visible-tab",
      } satisfies ContentToBackgroundMessage)) as CaptureVisibleTabResponse;

      // Pixels are captured. Bring the UI back before the slower compose step
      // so the user is not left staring at a blank tab while it encodes.
      restoreHost();

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
      // Exactly once. The screenshot above is annotation-free by construction;
      // drawing here a second time would duplicate every object.
      for (const obj of objectsRef.current) drawAnnotation(ctx, obj);

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
    } finally {
      restoreHost();
      savingPngRef.current = false;
    }
  }, [commitTextInput, captureHidden, shadowRoot]);

  const handleToolChange = useCallback(
    (newTool: ToolId) => {
      commitTextInput();
      setTool(newTool);
      resetDrag();
    },
    [commitTextInput, resetDrag],
  );

  const selectedShape = objects.find((object) => object.id === selectedId);
  const displayedWidth =
    selectedShape &&
    (selectedShape.type === "rectangle" ||
      selectedShape.type === "ellipse" ||
      selectedShape.type === "arrow" ||
      selectedShape.type === "text")
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
        commitTextInput();
        laserActiveRef.current = false;
        resetDrag();
      }
    },
    [commitTextInput, resetDrag],
  );

  // Camera and microphone permission belongs to the extension origin. The
  // recorder cannot prompt, so the panel reports whether a grant is missing.
  const refreshPermissions = useCallback(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        kind: "record-permission-state",
      } satisfies ContentToBackgroundMessage)) as MediaPermissionResponse;
      if (response?.ok)
        setMediaPermission({
          camera: response.camera,
          microphone: response.microphone,
        });
    } catch {
      // A missing answer just leaves the previous state in place.
    }
  }, []);

  const prepareRecorder = useCallback(async () => {
    setRecorderPreparation("preparing");
    setRecorderPreparationError("");
    try {
      const response = (await chrome.runtime.sendMessage({
        kind: "record-prewarm",
      } satisfies ContentToBackgroundMessage)) as {
        ok?: boolean;
        error?: string;
      };
      if (!response?.ok)
        throw new Error(
          response?.error ?? "Capann couldn't prepare recording. Try again.",
        );
      setRecorderPreparation("ready");
      void refreshPermissions();
    } catch (error) {
      setRecorderPreparation("failed");
      setRecorderPreparationError(
        error instanceof Error
          ? error.message
          : "Capann couldn't prepare recording. Try again.",
      );
    }
  }, [refreshPermissions]);

  const requestPermissions = useCallback(async () => {
    if (permissionRequested) return;
    setPermissionRequested(true);
    try {
      await chrome.runtime.sendMessage({
        kind: "record-request-permission",
        camera: recordOptions.camera,
        microphone: recordOptions.microphone,
      } satisfies ContentToBackgroundMessage);
    } catch {
      // Nothing else to do; the notice stays visible.
    }
    // Re-enable the button if the window was closed without a decision.
    window.setTimeout(() => setPermissionRequested(false), 1_500);
  }, [permissionRequested, recordOptions.camera, recordOptions.microphone]);

  const startRecording = useCallback(async () => {
    if (startRequested) return;
    if (recorderPreparation !== "ready") {
      void prepareRecorder();
      return;
    }
    setStartRequested(true);
    commitTextInput();
    handleDrawModeToggle(false);
    setUiView("record");
    setRecordingStatus({ state: "idle" });
    // Hide synchronously before asking the worker to start capturing. React
    // effects run after this click; the direct style change guarantees the
    // first captured frame cannot include Capann's controls or annotations.
    if (shadowRoot?.host instanceof HTMLElement)
      shadowRoot.host.style.visibility = "hidden";
    setCaptureHidden(true);
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
          code: "RECORDER_STARTUP_FAILED",
        };
        setRecordingStatus(status);
        setCaptureHidden(false);
        setStartRequested(false);
      }
    } catch (error) {
      setRecordingStatus({
        state: "error",
        error:
          error instanceof Error ? error.message : "Could not start recording.",
        code: "RECORDER_STARTUP_FAILED",
      });
      setCaptureHidden(false);
      setStartRequested(false);
    }
  }, [
    commitTextInput,
    handleDrawModeToggle,
    recordOptions,
    recorderPreparation,
    prepareRecorder,
    shadowRoot,
    startRequested,
  ]);

  // Create the offscreen document while the user chooses recording options.
  // Getting the recorder ready up front means the tab stream ID can be handed
  // over immediately, before Chrome's short-lived IDs expire.
  useEffect(() => {
    if (uiView !== "record" || recorderPreparation !== "idle") return;
    void prepareRecorder();
  }, [uiView, recorderPreparation, prepareRecorder]);

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

  // Recording's single source of truth for overlay visibility. Hiding the
  // shadow-root host hides everything at once: canvases, shell, timer/mask
  // chips, and any active text input.
  //
  // PNG export deliberately bypasses this effect: it toggles the same host
  // style for one capture and restores it from `captureHidden` afterwards.
  // Do not move export onto this effect unless it can also preserve the
  // recorder's desired state.
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

  // Handle Escape (exit draw mode, keep marks), Ctrl/Cmd+D (duplicate), and
  // Delete/Backspace (delete selected). Esc never clears annotations or closes
  // the panel — it only returns pointer events to the page. Ctrl+D is handled
  // in-page (not a manifest command) because Chrome reserves it for bookmarks;
  // preventDefault stops the bookmark tab from opening. Meta+D covers macOS.
  //
  // The `!captureHidden` guard matters: while the overlay is hidden for a
  // recording the user cannot see draw mode, so Escape must not silently
  // change it behind their back.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // The text composer owns the keyboard while it is open. Checking the
      // shadow root's activeElement is required because events crossing the
      // shadow boundary are retargeted to the host — `e.target` cannot reveal
      // that the user is typing inside the composer, so a bare Backspace would
      // otherwise delete an annotation instead of a character.
      const focused = shadowRoot?.activeElement as HTMLElement | null;
      const typing =
        editorRef.current !== null ||
        (focused !== null &&
          (focused.tagName === "INPUT" ||
            focused.tagName === "TEXTAREA" ||
            focused.isContentEditable));
      if (typing) return;

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
      // Windows labels the key "Delete"; Mac labels Backspace as "delete".
      // Requiring draw mode keeps plain Backspace navigation working whenever
      // annotations are merely on screen rather than being edited.
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        drawModeEnabled &&
        !captureHidden &&
        selectedId
      ) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    drawModeEnabled,
    captureHidden,
    duplicateSelected,
    deleteSelected,
    selectedId,
    shadowRoot,
  ]);

  // Handle extension action, keyboard, and recorder status messages.
  // Alt+Shift+S (toggle-capann-ui) only toggles draw mode while the panel
  // is open; when closed it opens the chooser. It never closes the panel.
  //
  // This listener is a fusion seam: annotation commands (toggle-capann-ui,
  // clear-annotations, cycle-tool) and recorder lifecycle (recording-*) arrive
  // on the same channel. A new case must not assume the other domain's state,
  // and `recording-status` stays the only writer of `captureHidden` here.
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
        case "recording-prepare-hide": {
          // Hide the Capann host before capture starts so controls and
          // annotations cannot enter the recording.
          setCaptureHidden(true);
          break;
        }
        case "recording-prepare-show": {
          // Show the Capann host again when recording didn't start.
          setCaptureHidden(false);
          break;
        }
        case "cycle-tool":
          cycleTool();
          break;
        case "recording-permission": {
          setMediaPermission({
            camera: message.camera,
            microphone: message.microphone,
          });
          // The worker replaced the recorder so the new grant applies; prepare
          // it again from a clean state.
          setRecorderPreparation("idle");
          setRecorderPreparationError("");
          break;
        }
        case "recording-status": {
          setRecordingStatus(message.status);
          const active =
            message.status.state === "recording" ||
            message.status.state === "paused" ||
            message.status.state === "starting";
          setCaptureHidden(active);
          if (!active) {
            setStartRequested(false);
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

  // Recording-driven hide, applied to the rendered subtree so React state and
  // the host style above cannot disagree. `savePng` does not go through this:
  // it hides the host for one capture and restores it, without touching this
  // flag.
  const hiddenByCapture = captureHidden
    ? { visibility: "hidden" as const }
    : undefined;
  const closeUi = () => {
    setUiView("closed");
    // Closing is the reset point: the panel returns to its docked corner the
    // next time it opens.
    setPanelPosition(null);
    handleDrawModeToggle(false);
  };
  const recordingIsActive =
    recordingStatus.state === "recording" ||
    recordingStatus.state === "paused" ||
    recordingStatus.state === "starting";
  // Options are on by default, so a fresh install needs one grant before the
  // camera bubble or microphone audio can be included.
  const missingPermissions: ("camera" | "microphone")[] = [];
  if (mediaPermission) {
    if (recordOptions.camera && mediaPermission.camera !== "granted")
      missingPermissions.push("camera");
    if (recordOptions.microphone && mediaPermission.microphone !== "granted")
      missingPermissions.push("microphone");
  }
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

  // Annotate undo/redo/duplicate/delete live in the shared shell header.
  // Duplicate and Delete only show when an annotation is selected (which
  // includes right after drawing, since new marks auto-select).
  const annotateActions = (
    <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
      <HeaderIcon
        title="Undo"
        path={UNDO_ICON}
        onClick={handleUndo}
        disabled={past.length === 0}
      />
      <HeaderIcon
        title="Redo"
        path={REDO_ICON}
        onClick={handleRedo}
        disabled={future.length === 0}
      />
      {selectedId && (
        <>
          <HeaderIcon
            title="Duplicate selected (Ctrl/Cmd+D)"
            path={DUPLICATE_ICON}
            onClick={duplicateSelected}
          />
          <HeaderIcon
            title="Delete selected (Delete or Backspace)"
            path={DELETE_ICON}
            onClick={deleteSelected}
          />
        </>
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
        .text-composer {
          position: fixed;
          z-index: 2147483647;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          font-weight: 500;
        }
        .text-composer-bg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: visible;
          pointer-events: none;
          filter: drop-shadow(0 10px 26px rgba(0, 0, 0, 0.38));
        }
        .text-composer-body {
          fill: rgba(28, 28, 32, 0.96);
          stroke: rgba(255, 255, 255, 0.15);
          stroke-width: 1;
          transition: stroke 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .text-composer:focus-within .text-composer-body {
          stroke: #A78BFA;
        }
        .text-composer-tail {
          fill: var(--note-color, #A78BFA);
        }
        .text-composer-tail-line {
          fill: none;
          stroke: rgba(255, 255, 255, 0.15);
          stroke-width: 1;
        }
        .text-composer-input {
          position: relative;
          z-index: 1;
          display: block;
          width: 100%;
          height: auto;
          box-sizing: border-box;
          border: 0;
          outline: none;
          background: transparent;
          color: #F5F5F7;
          caret-color: #A78BFA;
          resize: none;
          overflow-y: hidden;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          font-weight: 500;
        }
        .text-composer-input::placeholder {
          color: #8B8B93;
          opacity: 1;
        }
        .text-composer-input::selection {
          background: rgba(167, 139, 250, 0.4);
        }
        .text-composer-input::-webkit-scrollbar {
          width: 6px;
        }
        .text-composer-input::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 999px;
        }
        .text-composer-send {
          position: absolute;
          z-index: 2;
          width: 30px;
          height: 30px;
          padding: 0;
          border: 0;
          border-radius: 999px;
          display: grid;
          place-items: center;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
          cursor: pointer;
          transition:
            transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1),
            opacity 120ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .text-composer-send:disabled {
          opacity: 0.35;
          cursor: default;
          box-shadow: none;
        }
        .text-composer-send:not(:disabled):hover {
          transform: scale(1.06);
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
            position={panelPosition}
            onPositionChange={setPanelPosition}
          >
            <div style={{ display: "grid", gap: 8 }}>
               <button
                onClick={() => {
                  setUiView("annotate");
                  handleDrawModeToggle(false);
                }}
                style={{ ...SHELL_BUTTON, textAlign: "left" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <MarkerCircleIcon size={20} weight="fill" />
                  <span>Annotate</span>
                </div>
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

              <button
                onClick={() => {
                  setStatusText("");
                  setRecordingStatus({ state: "idle" });
                  setUiView("record");
                }}
                style={{ ...SHELL_BUTTON, textAlign: "left" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <RecordIcon size={20} weight="fill" />
                  <span>Record</span>
                </div>
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
            position={panelPosition}
            onPositionChange={setPanelPosition}
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
            position={panelPosition}
            onPositionChange={setPanelPosition}
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
            {missingPermissions.length > 0 && !recordingIsActive && (
              <div style={{ marginTop: 12 }}>
                <p
                  style={{
                    margin: "0 0 8px",
                    color: "#F5E8A6",
                    fontSize: 11,
                    lineHeight: 1.45,
                  }}
                >
                  {missingPermissions.length === 2
                    ? "Camera and microphone need permission — allow them, or record without them."
                    : `${
                        missingPermissions[0] === "camera"
                          ? "Camera"
                          : "Microphone"
                      } needs permission — allow it, or record without it.`}
                </p>
                <button
                  onClick={() => void requestPermissions()}
                  disabled={permissionRequested}
                  style={{
                    ...SHELL_BUTTON,
                    width: "100%",
                    cursor: permissionRequested ? "wait" : "pointer",
                    opacity: permissionRequested ? 0.65 : 1,
                  }}
                >
                  {permissionRequested ? "Waiting for Chrome…" : "Allow"}
                </button>
              </div>
            )}
            {!recordingIsActive && (
              <button
                onClick={() => void startRecording()}
                disabled={recorderPreparation === "preparing" || startRequested}
                style={{
                  ...SHELL_BUTTON,
                  width: "100%",
                  marginTop: 14,
                  background: "#A78BFA",
                  border: 0,
                  color: "#17131F",
                  fontWeight: 700,
                  cursor:
                    recorderPreparation === "preparing" || startRequested
                      ? "wait"
                      : "pointer",
                  opacity:
                    recorderPreparation === "preparing" || startRequested
                      ? 0.65
                      : 1,
                }}
              >
                {recorderPreparation === "preparing"
                  ? "Preparing recorder…"
                  : startRequested
                    ? "Starting recording…"
                    : recorderPreparation === "failed"
                      ? "Try preparing recorder again"
                      : "Start recording"}
              </button>
            )}
            {recorderPreparation === "failed" && !recordingIsActive && (
              <p role="alert" style={{ color: "#FCA5A5", margin: "10px 0 0" }}>
                {recorderPreparationError}
              </p>
            )}
            {recordingStatus.state === "starting" && (
              <p role="status" style={{ color: "#F5E8A6", margin: "14px 0 0" }}>
                {(() => {
                  const s = recordingStatus as {
                    stage?: string;
                    sessionId?: string;
                  };
                  switch (s.stage) {
                    case "preparing-recorder":
                      return "Preparing recorder…";
                    case "acquiring-tab-stream":
                      return "Connecting to this tab…";
                    case "preparing-video":
                      return "Preparing video…";
                    case "starting-recorder":
                      return "Starting recorder…";
                    default:
                      return "Preparing capture…";
                  }
                })()}
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
                padding: "0 6px 0 12px",
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
                  // padding: "0 0 0 14px",
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
            onPointerLeave={() => {
              if (tool === "text") redrawSelection();
            }}
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
