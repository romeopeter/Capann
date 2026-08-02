import { useState, useEffect, useRef } from 'react';
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

export interface ToolbarProps {
  onToolChange: (tool: ToolId) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onHeadStyleChange: (style: ArrowHeadStyle) => void;
  onFilledChange: (filled: boolean) => void;
  onClear: () => void;
  onSavePng: () => void;
  onDrawModeToggle: (enabled: boolean) => void;
  drawModeEnabled: boolean;
  currentTool: ToolId;
  currentColor: string;
  currentWidth: number;
  currentHeadStyle: ArrowHeadStyle;
  currentFilled: boolean;
  statusText?: string;
}

export function Toolbar({
  onToolChange,
  onColorChange,
  onWidthChange,
  onHeadStyleChange,
  onFilledChange,
  onClear,
  onSavePng,
  onDrawModeToggle,
  drawModeEnabled,
  currentTool,
  currentColor,
  currentWidth,
  currentHeadStyle,
  currentFilled,
  statusText = '',
}: ToolbarProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; left: number; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const swatches = currentTool === 'highlighter' ? HIGHLIGHTER_SWATCHES : COLOR_SWATCHES;

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    setIsDragging(true);
    const rect = containerRef.current.getBoundingClientRect();
    setDragStart({ x: e.clientX, y: e.clientY, left: rect.left, top: rect.top });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setPosition({ left: dragStart.left + dx, top: dragStart.top + dy });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragStart(null);
  };

  const containerStyle: React.CSSProperties = position
    ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' }
    : {};

  return (
    <div className="toolbar" style={containerStyle} ref={containerRef}>
      <button
        className={`launcher${drawModeEnabled ? ' active' : ''}`}
        onClick={() => onDrawModeToggle(!drawModeEnabled)}
        title="Toggle ScreenSlate (Alt+Shift+S)"
        dangerouslySetInnerHTML={{ __html: POWER_ICON }}
      />
      {drawModeEnabled && (
        <div className="panel">
          <div className="row header-row">
            <div
              className="drag-handle"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              dangerouslySetInnerHTML={{ __html: HANDLE_ICON }}
            />
            <button
              className="icon-btn close-btn"
              onClick={() => onDrawModeToggle(false)}
              title="Exit draw mode"
              dangerouslySetInnerHTML={{ __html: CLOSE_ICON }}
            />
          </div>

          <div className="row tools-row">
            {DRAW_TOOLS.map((tool) => (
              <button
                key={tool}
                className={`icon-btn tool-btn${currentTool === tool ? ' active' : ''}`}
                onClick={() => onToolChange(tool)}
                title={TOOL_LABELS[tool]}
                dangerouslySetInnerHTML={{ __html: TOOL_ICONS[tool] }}
              />
            ))}
          </div>

          {currentTool !== 'eraser' && (
            <div className="row color-row">
              {swatches.map((color) => (
                <button
                  key={color}
                  className={`swatch${currentColor === color ? ' active' : ''}`}
                  style={{ background: color }}
                  onClick={() => onColorChange(color)}
                />
              ))}
              <input
                type="color"
                className="custom-color"
                title="Custom color"
                value={currentColor}
                onChange={(e) => onColorChange(e.target.value)}
              />
            </div>
          )}

          {currentTool !== 'text' && (
            <div className="row width-row">
              <span className="label">Size</span>
              <input
                type="range"
                min="2"
                max="24"
                value={currentWidth}
                onChange={(e) => onWidthChange(Number(e.target.value))}
              />
            </div>
          )}

          {currentTool === 'arrow' && (
            <div className="row head-style-row">
              <span className="label">Head</span>
              <select
                value={currentHeadStyle}
                onChange={(e) => onHeadStyleChange(e.target.value as ArrowHeadStyle)}
              >
                <option value="triangle">Triangle</option>
                <option value="chevron">Chevron</option>
                <option value="stick">Stick</option>
              </select>
            </div>
          )}

          {(currentTool === 'rectangle' || currentTool === 'ellipse') && (
            <div className="row filled-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={currentFilled}
                  onChange={(e) => onFilledChange(e.target.checked)}
                />
                {' Filled'}
              </label>
            </div>
          )}

          <div className="row actions-row">
            <button
              className="icon-btn action-btn"
              onClick={onClear}
              title="Clear all annotations"
              dangerouslySetInnerHTML={{ __html: `${CLEAR_ICON}<span>Clear</span>` }}
            />
            <button
              className="icon-btn action-btn"
              onClick={onSavePng}
              title="Save screen + annotations as PNG"
              dangerouslySetInnerHTML={{ __html: `${SAVE_ICON}<span>Save PNG</span>` }}
            />
          </div>

          {statusText && (
            <div className="row status-row">
              {statusText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function setToolbarStatus(text: string) {
  // This will be handled via props instead
  console.log('Status:', text);
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
