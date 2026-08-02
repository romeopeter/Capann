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
import { Toolbar, TOOLBAR_STYLES } from './toolbar';
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

export function OverlayApp() {
  const shadowRoot = useContext(ShadowRootContext);
  const [tabId, setTabId] = useState(-1);
  const [drawModeEnabled, setDrawModeEnabled] = useState(false);
  const [tool, setTool] = useState<ToolId>('pencil');
  const [color, setColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [headStyle, setHeadStyle] = useState<ArrowHeadStyle>('triangle');
  const [filled, setFilled] = useState(false);
  const [objects, setObjects] = useState<AnnotationObject[]>([]);
  const [statusText, setStatusText] = useState('');

  const currentPointsRef = useRef<Point[] | null>(null);
  const dragStartRef = useRef<Point | null>(null);
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
  }, [drawModeEnabled, tool, clearLive]);

  const makeId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  const resetDrag = useCallback(() => {
    currentPointsRef.current = null;
    dragStartRef.current = null;
    clearLive();
  }, [clearLive]);

  const commitTextInput = useCallback(() => {
    const input = editingInputRef.current;
    const point = editingPointRef.current;
    if (!input || !point) return;
    editingInputRef.current = null;
    editingPointRef.current = null;
    const text = input.value.trim();
    input.remove();
    if (!text) return;
    setObjects((prev) => [
      ...prev,
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
  }, [color, strokeWidth, makeId]);

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

      const commit = () => commitTextInput();
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter' && !ke.shiftKey) {
          ke.preventDefault();
          commit();
        } else if (ke.key === 'Escape') {
          ke.preventDefault();
          input.value = '';
          commit();
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
        const hit = findTopmostHit(point, objects);
        if (hit) {
          setObjects((prev) => prev.filter((o) => o.id !== hit.id));
        }
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
    [drawModeEnabled, tool, objects, beginTextInput]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawModeEnabled) return;
      const point = { x: e.clientX, y: e.clientY };
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
    [drawModeEnabled, tool, color, strokeWidth, headStyle, filled, clearLive]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawModeEnabled) return;
      const point = { x: e.clientX, y: e.clientY };
      e.currentTarget.releasePointerCapture(e.pointerId);

      if (currentPointsRef.current && (tool === 'pencil' || tool === 'highlighter')) {
        if (currentPointsRef.current.length > 1) {
          setObjects((prev) => [
            ...prev,
            {
              id: makeId(),
              type: tool,
              color,
              strokeWidth,
              createdAt: Date.now(),
              points: currentPointsRef.current!,
            },
          ]);
        }
        currentPointsRef.current = null;
      } else if (dragStartRef.current && tool === 'arrow') {
        setObjects((prev) => [
          ...prev,
          {
            id: makeId(),
            type: 'arrow',
            color,
            strokeWidth,
            createdAt: Date.now(),
            start: dragStartRef.current!,
            end: point,
            headStyle,
          },
        ]);
        dragStartRef.current = null;
      } else if (dragStartRef.current && (tool === 'rectangle' || tool === 'ellipse')) {
        setObjects((prev) => [
          ...prev,
          {
            id: makeId(),
            type: tool,
            color,
            strokeWidth,
            createdAt: Date.now(),
            start: dragStartRef.current!,
            end: point,
            filled,
          },
        ]);
        dragStartRef.current = null;
      } else {
        return;
      }

      clearLive();
    },
    [drawModeEnabled, tool, color, strokeWidth, headStyle, filled, makeId, clearLive]
  );

  const handleClear = useCallback(() => {
    setObjects([]);
    setStatusText('Cleared');
  }, []);

  const cycleTool = useCallback(() => {
    const idx = TOOL_CYCLE_ORDER.indexOf(tool);
    const next = TOOL_CYCLE_ORDER[(idx + 1) % TOOL_CYCLE_ORDER.length]!;
    setTool(next);
    setStatusText(`Tool: ${next}`);
  }, [tool]);

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

  const handleDrawModeToggle = useCallback((enabled: boolean) => {
    setDrawModeEnabled(enabled);
    if (!enabled) {
      laserActiveRef.current = false;
    }
  }, []);

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
          setDrawModeEnabled((prev) => !prev);
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
  }, [handleClear, cycleTool]);

  return (
    <>
      <style>{TOOLBAR_STYLES}</style>
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
