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
import { createToolbar, TOOLBAR_STYLES } from './toolbar';

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

class ScreenSlateOverlay {
  private tabId = -1;
  private drawModeEnabled = false;
  private tool: ToolId = 'pencil';
  private color = '#ef4444';
  private strokeWidth = 4;
  private headStyle: ArrowHeadStyle = 'triangle';
  private filled = false;
  private objects: AnnotationObject[] = [];

  private currentPoints: Point[] | null = null;
  private dragStart: Point | null = null;
  private cursor: Point = { x: -100, y: -100 };
  private laserTrail: { point: Point; time: number }[] = [];
  private laserActive = false;
  private rafHandle = 0;
  private saveTimer = 0;
  private editingInput: HTMLTextAreaElement | null = null;
  private editingPoint: Point | null = null;

  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private canvasWrapper: HTMLDivElement;
  private objectsCanvas: HTMLCanvasElement;
  private liveCanvas: HTMLCanvasElement;
  private objectsCtx: CanvasRenderingContext2D;
  private liveCtx: CanvasRenderingContext2D;
  private toolbar: ReturnType<typeof createToolbar>;

  constructor() {
    this.host = document.createElement('div');
    this.host.id = 'screenslate-host';
    this.host.style.all = 'initial';
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      ${TOOLBAR_STYLES}
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
    `;
    this.shadow.append(style);

    this.canvasWrapper = document.createElement('div');
    this.canvasWrapper.className = 'canvas-wrapper';
    this.objectsCanvas = document.createElement('canvas');
    this.liveCanvas = document.createElement('canvas');
    this.canvasWrapper.append(this.objectsCanvas, this.liveCanvas);
    this.shadow.append(this.canvasWrapper);

    this.objectsCtx = this.objectsCanvas.getContext('2d')!;
    this.liveCtx = this.liveCanvas.getContext('2d')!;

    this.toolbar = createToolbar(this.shadow, {
      onToolChange: (tool) => this.setTool(tool),
      onColorChange: (color) => (this.color = color),
      onWidthChange: (width) => (this.strokeWidth = width),
      onHeadStyleChange: (style) => (this.headStyle = style),
      onFilledChange: (filled) => (this.filled = filled),
      onClear: () => this.clearAll(),
      onSavePng: () => void this.savePng(),
      onDrawModeToggle: (enabled) => this.setDrawMode(enabled),
    });

    document.documentElement.append(this.host);

    this.resizeCanvases();
    window.addEventListener('resize', () => this.resizeCanvases());
    window.addEventListener('pointermove', (e) => this.onWindowPointerMove(e), { passive: true });
    window.addEventListener('pointerleave', () => (this.laserActive = false));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.drawModeEnabled) this.setDrawMode(false);
    });

    this.liveCanvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.liveCanvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.liveCanvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.liveCanvas.addEventListener('pointercancel', () => this.resetDrag());

    chrome.runtime.onMessage.addListener((message: BackgroundToContentMessage) => {
      this.handleBackgroundMessage(message);
    });

    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const response = (await chrome.runtime.sendMessage({
        kind: 'get-tab-id',
      } satisfies ContentToBackgroundMessage)) as GetTabIdResponse;
      this.tabId = response.tabId;
    } catch {
      this.tabId = -1;
    }
    if (this.tabId >= 0) {
      await this.restoreState();
    }
    this.updatePointerMode();
    this.redrawObjects();
  }

  private storageKey(): string {
    return `${STORAGE_KEY_PREFIX}${this.tabId}`;
  }

  private async restoreState(): Promise<void> {
    const result = await chrome.storage.session.get(this.storageKey());
    const state = result[this.storageKey()] as TabAnnotationState | undefined;
    if (state?.objects) this.objects = state.objects;
  }

  private scheduleSave(): void {
    if (this.tabId < 0) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      const state: TabAnnotationState = { objects: this.objects };
      void chrome.storage.session.set({ [this.storageKey()]: state });
    }, 350);
  }

  private resizeCanvases(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (const canvas of [this.objectsCanvas, this.liveCanvas]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    this.objectsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.liveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redrawObjects();
  }

  private redrawObjects(): void {
    redrawAll(this.objectsCtx, window.innerWidth, window.innerHeight, this.objects);
  }

  private clearLive(): void {
    this.liveCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  private setTool(tool: ToolId): void {
    this.tool = tool;
    this.resetDrag();
    this.updatePointerMode();
  }

  private setDrawMode(enabled: boolean): void {
    this.drawModeEnabled = enabled;
    this.toolbar.setDrawModeEnabled(enabled);
    this.updatePointerMode();
    if (!enabled) {
      this.clearLive();
      this.laserActive = false;
    }
  }

  private updatePointerMode(): void {
    const capturing = this.drawModeEnabled && CAPTURING_TOOLS.has(this.tool);
    this.liveCanvas.style.pointerEvents = capturing ? 'auto' : 'none';
    const needsRaf = this.drawModeEnabled && (this.tool === 'laser' || this.tool === 'spotlight');
    if (needsRaf && !this.rafHandle) {
      const loop = () => {
        this.renderLiveOverlay();
        this.rafHandle = requestAnimationFrame(loop);
      };
      this.rafHandle = requestAnimationFrame(loop);
    } else if (!needsRaf && this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
      this.clearLive();
    }
  }

  private onWindowPointerMove(e: PointerEvent): void {
    this.cursor = { x: e.clientX, y: e.clientY };
    if (this.drawModeEnabled && (this.tool === 'laser' || this.tool === 'spotlight')) {
      this.laserActive = true;
      if (this.tool === 'laser') {
        this.laserTrail.push({ point: this.cursor, time: performance.now() });
      }
    }
  }

  private renderLiveOverlay(): void {
    if (!this.laserActive) return;
    const now = performance.now();
    this.laserTrail = this.laserTrail.filter((p) => now - p.time < LASER_TRAIL_MS);
    this.clearLive();
    if (this.tool === 'laser') {
      for (const entry of this.laserTrail) {
        const age = (now - entry.time) / LASER_TRAIL_MS;
        const alpha = 1 - age;
        const radius = 4 + 4 * (1 - age);
        this.liveCtx.beginPath();
        this.liveCtx.fillStyle = `rgba(239, 68, 68, ${alpha * 0.8})`;
        this.liveCtx.arc(entry.point.x, entry.point.y, radius, 0, Math.PI * 2);
        this.liveCtx.fill();
      }
      this.liveCtx.beginPath();
      this.liveCtx.fillStyle = '#ef4444';
      this.liveCtx.arc(this.cursor.x, this.cursor.y, 6, 0, Math.PI * 2);
      this.liveCtx.fill();
    } else {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.liveCtx.fillStyle = 'rgba(0,0,0,0.55)';
      this.liveCtx.fillRect(0, 0, w, h);
      this.liveCtx.save();
      this.liveCtx.globalCompositeOperation = 'destination-out';
      const radius = 110;
      const gradient = this.liveCtx.createRadialGradient(
        this.cursor.x,
        this.cursor.y,
        0,
        this.cursor.x,
        this.cursor.y,
        radius
      );
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(0.75, 'rgba(0,0,0,1)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      this.liveCtx.fillStyle = gradient;
      this.liveCtx.beginPath();
      this.liveCtx.arc(this.cursor.x, this.cursor.y, radius, 0, Math.PI * 2);
      this.liveCtx.fill();
      this.liveCtx.restore();
    }
  }

  private makeId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.drawModeEnabled) return;
    const point = { x: e.clientX, y: e.clientY };
    this.liveCanvas.setPointerCapture(e.pointerId);

    if (this.tool === 'eraser') {
      const hit = findTopmostHit(point, this.objects);
      if (hit) {
        this.objects = this.objects.filter((o) => o.id !== hit.id);
        this.redrawObjects();
        this.scheduleSave();
      }
      return;
    }

    if (this.tool === 'text') {
      this.beginTextInput(point);
      return;
    }

    if (this.tool === 'pencil' || this.tool === 'highlighter') {
      this.currentPoints = [point];
    } else if (this.tool === 'arrow' || this.tool === 'rectangle' || this.tool === 'ellipse') {
      this.dragStart = point;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drawModeEnabled) return;
    const point = { x: e.clientX, y: e.clientY };

    if (this.currentPoints && (this.tool === 'pencil' || this.tool === 'highlighter')) {
      this.currentPoints.push(point);
      this.clearLive();
      drawAnnotation(this.liveCtx, {
        id: 'preview',
        type: this.tool,
        color: this.color,
        strokeWidth: this.strokeWidth,
        createdAt: 0,
        points: this.currentPoints,
      });
      return;
    }

    if (this.dragStart && this.tool === 'arrow') {
      this.clearLive();
      drawAnnotation(this.liveCtx, {
        id: 'preview',
        type: 'arrow',
        color: this.color,
        strokeWidth: this.strokeWidth,
        createdAt: 0,
        start: this.dragStart,
        end: point,
        headStyle: this.headStyle,
      });
      return;
    }

    if (this.dragStart && (this.tool === 'rectangle' || this.tool === 'ellipse')) {
      this.clearLive();
      drawAnnotation(this.liveCtx, {
        id: 'preview',
        type: this.tool,
        color: this.color,
        strokeWidth: this.strokeWidth,
        createdAt: 0,
        start: this.dragStart,
        end: point,
        filled: this.filled,
      });
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.drawModeEnabled) return;
    const point = { x: e.clientX, y: e.clientY };
    this.liveCanvas.releasePointerCapture(e.pointerId);

    if (this.currentPoints && (this.tool === 'pencil' || this.tool === 'highlighter')) {
      if (this.currentPoints.length > 1) {
        this.objects.push({
          id: this.makeId(),
          type: this.tool,
          color: this.color,
          strokeWidth: this.strokeWidth,
          createdAt: Date.now(),
          points: this.currentPoints,
        });
      }
      this.currentPoints = null;
    } else if (this.dragStart && this.tool === 'arrow') {
      this.objects.push({
        id: this.makeId(),
        type: 'arrow',
        color: this.color,
        strokeWidth: this.strokeWidth,
        createdAt: Date.now(),
        start: this.dragStart,
        end: point,
        headStyle: this.headStyle,
      });
      this.dragStart = null;
    } else if (this.dragStart && (this.tool === 'rectangle' || this.tool === 'ellipse')) {
      this.objects.push({
        id: this.makeId(),
        type: this.tool,
        color: this.color,
        strokeWidth: this.strokeWidth,
        createdAt: Date.now(),
        start: this.dragStart,
        end: point,
        filled: this.filled,
      });
      this.dragStart = null;
    } else {
      return;
    }

    this.clearLive();
    this.redrawObjects();
    this.scheduleSave();
  }

  private resetDrag(): void {
    this.currentPoints = null;
    this.dragStart = null;
    this.clearLive();
  }

  private beginTextInput(point: Point): void {
    if (this.editingInput) this.commitTextInput();
    const input = document.createElement('textarea');
    input.className = 'text-input';
    input.style.left = `${point.x}px`;
    input.style.top = `${point.y - this.strokeWidth * 4}px`;
    input.style.color = this.color;
    input.style.fontSize = `${Math.max(14, this.strokeWidth * 4)}px`;
    input.rows = 1;
    this.shadow.append(input);
    input.focus();
    this.editingInput = input;
    this.editingPoint = point;

    const commit = () => this.commitTextInput();
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
  }

  private commitTextInput(): void {
    const input = this.editingInput;
    const point = this.editingPoint;
    if (!input || !point) return;
    this.editingInput = null;
    this.editingPoint = null;
    const text = input.value.trim();
    input.remove();
    if (!text) return;
    this.objects.push({
      id: this.makeId(),
      type: 'text',
      color: this.color,
      strokeWidth: this.strokeWidth,
      createdAt: Date.now(),
      position: point,
      text,
      fontSize: Math.max(14, this.strokeWidth * 4),
    });
    this.redrawObjects();
    this.scheduleSave();
  }

  private clearAll(): void {
    this.objects = [];
    this.redrawObjects();
    this.scheduleSave();
    this.toolbar.setStatus('Cleared');
  }

  private cycleTool(): void {
    const idx = TOOL_CYCLE_ORDER.indexOf(this.tool);
    const next = TOOL_CYCLE_ORDER[(idx + 1) % TOOL_CYCLE_ORDER.length]!;
    this.setTool(next);
    this.toolbar.setStatus(`Tool: ${next}`);
  }

  private async savePng(): Promise<void> {
    this.toolbar.setStatus('Capturing...');
    try {
      const response = (await chrome.runtime.sendMessage({
        kind: 'capture-visible-tab',
      } satisfies ContentToBackgroundMessage)) as BackgroundToContentMessage;

      if (response.kind === 'capture-visible-tab-error') {
        this.toolbar.setStatus(`Save failed: ${response.error}`);
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
      redrawAll(ctx, window.innerWidth, window.innerHeight, this.objects);

      const dataUrl = composite.toDataURL('image/png');
      const filename = `screenslate-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      await chrome.runtime.sendMessage({
        kind: 'download-png',
        dataUrl,
        filename,
      } satisfies ContentToBackgroundMessage);
      this.toolbar.setStatus('Saved!');
    } catch (err) {
      this.toolbar.setStatus('Save failed');
      console.error('[ScreenSlate] save failed', err);
    }
  }

  private handleBackgroundMessage(message: BackgroundToContentMessage): void {
    switch (message.kind) {
      case 'toggle-draw-mode':
        this.setDrawMode(!this.drawModeEnabled);
        break;
      case 'clear-annotations':
        this.clearAll();
        break;
      case 'cycle-tool':
        this.cycleTool();
        break;
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

if (!document.getElementById('screenslate-host')) {
  new ScreenSlateOverlay();
}
