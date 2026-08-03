/**
 * OverlayApp.tsx
 *
 * Main application component for the ScreenSlate annotation overlay.
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

import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import type {
  AnnotationObject,
  ArrowHeadStyle,
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  GetTabIdResponse,
  Point,
  TabAnnotationState,
  ToolId,
} from '../shared/types';
import { STORAGE_KEY_PREFIX } from '../shared/types';
import { findTopmostHit } from './geometry';
import { drawAnnotation, redrawAll } from './render';
import { Toolbar } from './toolbar';
import { ShadowRootContext } from './overlay';

const CAPTURING_TOOLS: ReadonlySet<ToolId> = new Set([
  'pencil',
  'highlighter',
  'arrow',
  'rectangle',
  'ellipse',
  'text',
  'eraser',
]);

const TOOL_CYCLE_ORDER: ToolId[] = [
  'pencil',
  'highlighter',
  'arrow',
  'rectangle',
  'ellipse',
  'text',
  'laser',
  'spotlight',
  'eraser',
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
  const [drawModeEnabled, setDrawModeEnabled] = useState(false);
  const [tool, setTool] = useState<ToolId>('pencil');
  const [color, setColor] = useState('#A78BFA');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [headStyle, setHeadStyle] = useState<ArrowHeadStyle>('triangle');
  const [filled, setFilled] = useState(false);
  const [objects, setObjects] = useState<AnnotationObject[]>([]);
  // Undo history: `past` holds prior states, `future` holds states undone away.
  const [past, setPast] = useState<AnnotationObject[][]>([]);
  const [future, setFuture] = useState<AnnotationObject[][]>([]);
  const [statusText, setStatusText] = useState('');

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

  const objectsCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);

  const storageKey = useCallback(() => `${STORAGE_KEY_PREFIX}${tabId}`, [tabId]);

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

    const objectsCtx = objectsCanvas.getContext('2d')!;
    const liveCtx = liveCanvas.getContext('2d')!;
    objectsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    liveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    redrawAll(objectsCtx, width, height, objects);
  }, [objects]);

  const redrawObjects = useCallback(() => {
    const objectsCanvas = objectsCanvasRef.current;
    if (!objectsCanvas) return;
    const ctx = objectsCanvas.getContext('2d')!;
    redrawAll(ctx, window.innerWidth, window.innerHeight, objects);
  }, [objects]);

  const clearLive = useCallback(() => {
    const liveCanvas = liveCanvasRef.current;
    if (!liveCanvas) return;
    const ctx = liveCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }, []);

  const updatePointerMode = useCallback(() => {
    const liveCanvas = liveCanvasRef.current;
    if (!liveCanvas) return;

    const capturing = drawModeEnabled && CAPTURING_TOOLS.has(tool);
    liveCanvas.style.pointerEvents = capturing ? 'auto' : 'none';
    liveCanvas.style.cursor = !capturing
      ? ''
      : tool === 'eraser'
        ? eraserCursor(strokeWidth)
        : tool === 'text'
          ? 'text'
          : 'crosshair';

    const needsRaf = drawModeEnabled && (tool === 'laser' || tool === 'spotlight');
    if (needsRaf && !rafHandleRef.current) {
      const renderLiveOverlay = () => {
        if (!laserActiveRef.current) return;

        const liveCanvas = liveCanvasRef.current;
        if (!liveCanvas) return;
        const ctx = liveCanvas.getContext('2d')!;

        const now = performance.now();
        laserTrailRef.current = laserTrailRef.current.filter((p) => now - p.time < LASER_TRAIL_MS);
        clearLive();

        if (tool === 'laser') {
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
          ctx.fillStyle = '#ef4444';
          ctx.arc(cursorRef.current.x, cursorRef.current.y, 6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const w = window.innerWidth;
          const h = window.innerHeight;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(0, 0, w, h);
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          const radius = 110;
          const gradient = ctx.createRadialGradient(
            cursorRef.current.x,
            cursorRef.current.y,
            0,
            cursorRef.current.x,
            cursorRef.current.y,
            radius
          );
          gradient.addColorStop(0, 'rgba(0,0,0,1)');
          gradient.addColorStop(0.75, 'rgba(0,0,0,1)');
          gradient.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(cursorRef.current.x, cursorRef.current.y, radius, 0, Math.PI * 2);
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
  }, [drawModeEnabled, tool, strokeWidth, clearLive]);

  const makeId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  const resetDrag = useCallback(() => {
    currentPointsRef.current = null;
    dragStartRef.current = null;
    eraseBaselineRef.current = null;
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
    [objects]
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
        type: 'text',
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

      const input = document.createElement('textarea');
      input.className = 'text-input';
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
      input.addEventListener('blur', commitText);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter' && !ke.shiftKey) {
          ke.preventDefault();
          commitText();
        } else if (ke.key === 'Escape') {
          ke.preventDefault();
          input.value = '';
          commitText();
        }
      });
    },
    [color, strokeWidth, commitTextInput, shadowRoot]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawModeEnabled) return;
      const point = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);

      if (tool === 'eraser') {
        eraseBaselineRef.current = objects;
        eraseAt(point);
        return;
      }

      if (tool === 'text') {
        beginTextInput(point);
        return;
      }

      if (tool === 'pencil' || tool === 'highlighter') {
        currentPointsRef.current = [point];
      } else if (tool === 'arrow' || tool === 'rectangle' || tool === 'ellipse') {
        dragStartRef.current = point;
      }
    },
    [drawModeEnabled, tool, objects, beginTextInput, eraseAt]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawModeEnabled) return;
      const point = { x: e.clientX, y: e.clientY };
      // Eraser rubs out everything the cursor is dragged across, so it runs
      // before the stroke-preview branches and needs no drag state of its own.
      if (tool === 'eraser') {
        if (eraseBaselineRef.current !== null) eraseAt(point);
        return;
      }

      const liveCanvas = liveCanvasRef.current;
      if (!liveCanvas) return;
      const ctx = liveCanvas.getContext('2d')!;

      if (currentPointsRef.current && (tool === 'pencil' || tool === 'highlighter')) {
        currentPointsRef.current.push(point);
        clearLive();
        drawAnnotation(ctx, {
          id: 'preview',
          type: tool,
          color,
          strokeWidth,
          createdAt: 0,
          points: currentPointsRef.current,
        });
        return;
      }

      if (dragStartRef.current && tool === 'arrow') {
        clearLive();
        drawAnnotation(ctx, {
          id: 'preview',
          type: 'arrow',
          color,
          strokeWidth,
          createdAt: 0,
          start: dragStartRef.current,
          end: point,
          headStyle,
        });
        return;
      }

      if (dragStartRef.current && (tool === 'rectangle' || tool === 'ellipse')) {
        clearLive();
        drawAnnotation(ctx, {
          id: 'preview',
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
    [drawModeEnabled, tool, color, strokeWidth, headStyle, filled, clearLive, eraseAt]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawModeEnabled) return;
      const point = { x: e.clientX, y: e.clientY };
      e.currentTarget.releasePointerCapture(e.pointerId);

      // An erase drag already mutated `objects` directly; record the whole drag
      // as one undo entry now that it's finished.
      if (tool === 'eraser') {
        const baseline = eraseBaselineRef.current;
        eraseBaselineRef.current = null;
        if (baseline && baseline !== objects) {
          setPast((p) => [...p, baseline].slice(-HISTORY_LIMIT));
          setFuture([]);
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

      if (points && (tool === 'pencil' || tool === 'highlighter')) {
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
      } else if (dragStart && tool === 'arrow') {
        commit([
          ...objects,
          {
            id: makeId(),
            type: 'arrow',
            color,
            strokeWidth,
            createdAt: Date.now(),
            start: dragStart,
            end: point,
            headStyle,
          },
        ]);
      } else if (dragStart && (tool === 'rectangle' || tool === 'ellipse')) {
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
    },
    [drawModeEnabled, tool, color, strokeWidth, headStyle, filled, makeId, clearLive, commit, objects]
  );

  const handleClear = useCallback(() => {
    if (objects.length === 0) return;
    commit([]);
    setStatusText('Cleared');
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
    setStatusText('Capturing...');
    try {
      const response = (await chrome.runtime.sendMessage({
        kind: 'capture-visible-tab',
      } satisfies ContentToBackgroundMessage)) as BackgroundToContentMessage;

      if (response.kind === 'capture-visible-tab-error') {
        setStatusText(`Save failed: ${response.error}`);
        return;
      }
      if (response.kind !== 'capture-visible-tab-result') return;

      const screenshot = await loadImage(response.dataUrl);
      const dpr = window.devicePixelRatio || 1;
      const composite = document.createElement('canvas');
      composite.width = Math.round(window.innerWidth * dpr);
      composite.height = Math.round(window.innerHeight * dpr);
      const ctx = composite.getContext('2d')!;
      ctx.drawImage(screenshot, 0, 0, composite.width, composite.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawAll(ctx, window.innerWidth, window.innerHeight, objects);

      const dataUrl = composite.toDataURL('image/png');
      const filename = `screenslate-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      await chrome.runtime.sendMessage({
        kind: 'download-png',
        dataUrl,
        filename,
      } satisfies ContentToBackgroundMessage);
      setStatusText('Saved!');
    } catch (err) {
      setStatusText('Save failed');
      console.error('[ScreenSlate] save failed', err);
    }
  }, [objects]);

  const handleToolChange = useCallback(
    (newTool: ToolId) => {
      setTool(newTool);
      resetDrag();
    },
    [resetDrag]
  );

  const handleDrawModeToggle = useCallback(
    (enabled: boolean) => {
      setDrawModeEnabled(enabled);
      if (!enabled) {
        laserActiveRef.current = false;
        resetDrag();
      }
    },
    [resetDrag]
  );

  /**
   * Toggle driven by the toolbar icon / Alt+Shift+S. Activating always drops the
   * user into pencil so the extension is immediately usable; the toolbar's own
   * tool buttons go through handleDrawModeToggle instead, which preserves the
   * tool the user just picked.
   */
  const toggleDrawMode = useCallback(() => {
    const next = !drawModeEnabled;
    setDrawModeEnabled(next);
    if (next) {
      setTool('pencil');
    } else {
      laserActiveRef.current = false;
    }
    resetDrag();
  }, [drawModeEnabled, resetDrag]);

  // Initialize
  useEffect(() => {
    const init = async () => {
      try {
        const response = (await chrome.runtime.sendMessage({
          kind: 'get-tab-id',
        } satisfies ContentToBackgroundMessage)) as GetTabIdResponse;
        setTabId(response.tabId);
      } catch {
        setTabId(-1);
      }
    };
    void init();
  }, []);

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
      const timer = setTimeout(() => setStatusText(''), 2500);
      return () => clearTimeout(timer);
    }
  }, [statusText]);

  // Handle window resize
  useEffect(() => {
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);
    return () => window.removeEventListener('resize', resizeCanvases);
  }, [resizeCanvases]);

  // Handle window pointer move for laser/spotlight
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      if (drawModeEnabled && (tool === 'laser' || tool === 'spotlight')) {
        laserActiveRef.current = true;
        if (tool === 'laser') {
          laserTrailRef.current.push({ point: cursorRef.current, time: performance.now() });
        }
      }
    };

    const handlePointerLeave = () => {
      laserActiveRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [drawModeEnabled, tool]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawModeEnabled) setDrawModeEnabled(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawModeEnabled]);

  // Handle messages from background
  useEffect(() => {
    const handleMessage = (message: BackgroundToContentMessage) => {
      switch (message.kind) {
        case 'toggle-draw-mode':
          toggleDrawMode();
          break;
        case 'clear-annotations':
          handleClear();
          break;
        case 'cycle-tool':
          cycleTool();
          break;
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [handleClear, cycleTool, toggleDrawMode]);

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
      <Toolbar
        onToolChange={handleToolChange}
        onColorChange={setColor}
        onWidthChange={setStrokeWidth}
        onHeadStyleChange={setHeadStyle}
        onFilledChange={setFilled}
        onClear={handleClear}
        onSavePng={savePng}
        onDrawModeToggle={handleDrawModeToggle}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        drawModeEnabled={drawModeEnabled}
        currentTool={tool}
        currentColor={color}
        currentWidth={strokeWidth}
        currentHeadStyle={headStyle}
        currentFilled={filled}
        statusText={statusText}
      />
      <div className="canvas-wrapper">
        <canvas ref={objectsCanvasRef} />
        <canvas
          ref={liveCanvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => resetDrag()}
        />
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
