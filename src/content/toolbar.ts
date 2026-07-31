import type { ArrowHeadStyle, ToolId } from '../shared/types';
import { TOOL_LABELS } from '../shared/types';
import { CLEAR_ICON, CLOSE_ICON, HANDLE_ICON, POWER_ICON, SAVE_ICON, TOOL_ICONS } from './icons';

const DRAW_TOOLS: ToolId[] = [
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

const COLOR_SWATCHES = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6', '#111827', '#ffffff'];
const HIGHLIGHTER_SWATCHES = ['#facc15', '#4ade80', '#f472b6', '#60a5fa'];

export interface ToolbarCallbacks {
  onToolChange(tool: ToolId): void;
  onColorChange(color: string): void;
  onWidthChange(width: number): void;
  onHeadStyleChange(style: ArrowHeadStyle): void;
  onFilledChange(filled: boolean): void;
  onClear(): void;
  onSavePng(): void;
  onDrawModeToggle(enabled: boolean): void;
}

export interface ToolbarHandle {
  root: HTMLElement;
  setDrawModeEnabled(enabled: boolean): void;
  setStatus(text: string): void;
}

export function createToolbar(shadowRoot: ShadowRoot, callbacks: ToolbarCallbacks): ToolbarHandle {
  const container = document.createElement('div');
  container.className = 'toolbar';

  const launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.title = 'Toggle ScreenSlate (Alt+Shift+S)';
  launcher.innerHTML = POWER_ICON;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;

  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.innerHTML = HANDLE_ICON;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'icon-btn close-btn';
  closeBtn.title = 'Exit draw mode';
  closeBtn.innerHTML = CLOSE_ICON;
  const headerRow = document.createElement('div');
  headerRow.className = 'row header-row';
  headerRow.append(dragHandle, closeBtn);

  const toolsRow = document.createElement('div');
  toolsRow.className = 'row tools-row';
  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  for (const tool of DRAW_TOOLS) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn tool-btn';
    btn.title = TOOL_LABELS[tool];
    btn.innerHTML = TOOL_ICONS[tool];
    btn.addEventListener('click', () => {
      for (const b of toolButtons.values()) b.classList.remove('active');
      btn.classList.add('active');
      callbacks.onToolChange(tool);
      updateConditionalRows(tool);
    });
    toolButtons.set(tool, btn);
    toolsRow.append(btn);
  }

  const colorRow = document.createElement('div');
  colorRow.className = 'row color-row';
  const swatchButtons: HTMLButtonElement[] = [];
  function buildSwatches(colors: string[]) {
    colorRow.innerHTML = '';
    swatchButtons.length = 0;
    for (const color of colors) {
      const swatch = document.createElement('button');
      swatch.className = 'swatch';
      swatch.style.background = color;
      swatch.addEventListener('click', () => {
        for (const s of swatchButtons) s.classList.remove('active');
        swatch.classList.add('active');
        callbacks.onColorChange(color);
      });
      swatchButtons.push(swatch);
      colorRow.append(swatch);
    }
    swatchButtons[0]?.classList.add('active');
    const customColor = document.createElement('input');
    customColor.type = 'color';
    customColor.className = 'custom-color';
    customColor.title = 'Custom color';
    customColor.addEventListener('input', () => {
      for (const s of swatchButtons) s.classList.remove('active');
      callbacks.onColorChange(customColor.value);
    });
    colorRow.append(customColor);
  }
  buildSwatches(COLOR_SWATCHES);

  const widthRow = document.createElement('div');
  widthRow.className = 'row width-row';
  const widthLabel = document.createElement('span');
  widthLabel.className = 'label';
  widthLabel.textContent = 'Size';
  const widthSlider = document.createElement('input');
  widthSlider.type = 'range';
  widthSlider.min = '2';
  widthSlider.max = '24';
  widthSlider.value = '4';
  widthSlider.addEventListener('input', () => callbacks.onWidthChange(Number(widthSlider.value)));
  widthRow.append(widthLabel, widthSlider);

  const headStyleRow = document.createElement('div');
  headStyleRow.className = 'row head-style-row';
  const headStyleLabel = document.createElement('span');
  headStyleLabel.className = 'label';
  headStyleLabel.textContent = 'Head';
  const headStyleSelect = document.createElement('select');
  const headStyles: { value: ArrowHeadStyle; label: string }[] = [
    { value: 'triangle', label: 'Triangle' },
    { value: 'chevron', label: 'Chevron' },
    { value: 'stick', label: 'Stick' },
  ];
  for (const opt of headStyles) {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    headStyleSelect.append(optionEl);
  }
  headStyleSelect.addEventListener('change', () =>
    callbacks.onHeadStyleChange(headStyleSelect.value as ArrowHeadStyle)
  );
  headStyleRow.append(headStyleLabel, headStyleSelect);

  const filledRow = document.createElement('div');
  filledRow.className = 'row filled-row';
  const filledLabel = document.createElement('label');
  filledLabel.className = 'checkbox-label';
  const filledCheckbox = document.createElement('input');
  filledCheckbox.type = 'checkbox';
  filledCheckbox.addEventListener('change', () => callbacks.onFilledChange(filledCheckbox.checked));
  filledLabel.append(filledCheckbox, document.createTextNode(' Filled'));
  filledRow.append(filledLabel);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'row actions-row';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'icon-btn action-btn';
  clearBtn.title = 'Clear all annotations';
  clearBtn.innerHTML = `${CLEAR_ICON}<span>Clear</span>`;
  clearBtn.addEventListener('click', () => callbacks.onClear());
  const saveBtn = document.createElement('button');
  saveBtn.className = 'icon-btn action-btn';
  saveBtn.title = 'Save screen + annotations as PNG';
  saveBtn.innerHTML = `${SAVE_ICON}<span>Save PNG</span>`;
  saveBtn.addEventListener('click', () => callbacks.onSavePng());
  actionsRow.append(clearBtn, saveBtn);

  const statusRow = document.createElement('div');
  statusRow.className = 'row status-row';
  statusRow.textContent = '';

  function updateConditionalRows(tool: ToolId) {
    headStyleRow.hidden = tool !== 'arrow';
    filledRow.hidden = tool !== 'rectangle' && tool !== 'ellipse';
    widthRow.hidden = tool === 'text';
    colorRow.hidden = tool === 'eraser';
    buildSwatches(tool === 'highlighter' ? HIGHLIGHTER_SWATCHES : COLOR_SWATCHES);
  }
  updateConditionalRows('pencil');

  panel.append(headerRow, toolsRow, colorRow, widthRow, headStyleRow, filledRow, actionsRow, statusRow);
  container.append(launcher, panel);
  shadowRoot.append(container);

  function setExpanded(expanded: boolean) {
    panel.hidden = !expanded;
    launcher.classList.toggle('active', expanded);
  }

  launcher.addEventListener('click', () => {
    const next = panel.hidden;
    setExpanded(next);
    callbacks.onDrawModeToggle(next);
  });
  closeBtn.addEventListener('click', () => {
    setExpanded(false);
    callbacks.onDrawModeToggle(false);
  });

  // Drag-to-move via the handle only, so tool buttons stay clickable.
  let dragging = false;
  let dragStart: { x: number; y: number; left: number; top: number } | null = null;
  dragHandle.addEventListener('pointerdown', (e) => {
    dragging = true;
    const rect = container.getBoundingClientRect();
    dragStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    dragHandle.setPointerCapture(e.pointerId);
  });
  dragHandle.addEventListener('pointermove', (e) => {
    if (!dragging || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    container.style.left = `${dragStart.left + dx}px`;
    container.style.top = `${dragStart.top + dy}px`;
    container.style.right = 'auto';
    container.style.bottom = 'auto';
  });
  dragHandle.addEventListener('pointerup', () => {
    dragging = false;
    dragStart = null;
  });

  return {
    root: container,
    setDrawModeEnabled(enabled: boolean) {
      setExpanded(enabled);
    },
    setStatus(text: string) {
      statusRow.textContent = text;
      if (text) {
        window.setTimeout(() => {
          if (statusRow.textContent === text) statusRow.textContent = '';
        }, 2500);
      }
    },
  };
}

export const TOOLBAR_STYLES = `
:host {
  all: initial;
}
.toolbar {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  pointer-events: auto;
}
.launcher {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: #7c3aed;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,0.35);
}
.launcher.active {
  background: #5b21b6;
  box-shadow: 0 0 0 3px rgba(124,58,237,0.4), 0 4px 14px rgba(0,0,0,0.35);
}
.panel {
  position: absolute;
  top: 52px;
  right: 0;
  width: 240px;
  background: #1f2430ee;
  backdrop-filter: blur(6px);
  border-radius: 14px;
  padding: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.header-row {
  justify-content: space-between;
  cursor: default;
}
.drag-handle {
  cursor: grab;
  color: #9ca3af;
  padding: 4px;
}
.icon-btn {
  border: none;
  background: #2f3646;
  color: #e5e7eb;
  border-radius: 8px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.icon-btn:hover {
  background: #3a4257;
}
.icon-btn.active {
  background: #7c3aed;
  color: white;
}
.close-btn {
  background: transparent;
  width: 26px;
  height: 26px;
}
.action-btn {
  width: auto;
  gap: 6px;
  padding: 0 10px;
  font-size: 12px;
}
.action-btn span {
  white-space: nowrap;
}
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);
}
.swatch.active {
  border-color: #ffffff;
}
.custom-color {
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
}
.label {
  color: #9ca3af;
  font-size: 11px;
  min-width: 30px;
}
select {
  flex: 1;
  background: #2f3646;
  color: #e5e7eb;
  border: none;
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 12px;
}
input[type="range"] {
  flex: 1;
}
.checkbox-label {
  color: #e5e7eb;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-row {
  color: #a3e635;
  font-size: 11px;
  min-height: 14px;
}
`;
