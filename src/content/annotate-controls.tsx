/**
 * annotate-controls.tsx
 *
 * Embedded annotation controls rendered inside the shared Capann shell.
 * This is the former Toolbar body minus its standalone panel: no logo
 * header, no circular collapsed state, no morph animation, no
 * close/collapse button. Undo/redo live in the shell header via the
 * actions slot; timer and screen-mask chips live at the OverlayApp level.
 */

import type { ArrowHeadStyle, ToolId } from "../shared/types";
import { TOOL_LABELS } from "../shared/types";
import { TOOL_ICONS } from "./icons";
import { SHELL_BUTTON } from "./shell";

const MAIN_TOOLS: ToolId[] = [
  "pencil",
  "highlighter",
  "arrow",
  "rectangle",
  "ellipse",
  "text",
];
const EXTRA_TOOLS: ToolId[] = ["select", "laser", "spotlight", "eraser"];

const CORE_COLORS = ["#EF4444", "#0A0A0C", "#FACC15", "#22C55E", "#FFFFFF"];

const TIMER_PRESETS = [5, 10, 15]; // minutes

const HEAD_STYLES: { id: ArrowHeadStyle; label: string }[] = [
  { id: "triangle", label: "Triangle" },
  { id: "chevron", label: "Chevron" },
  { id: "stick", label: "Stick" },
  { id: "bender", label: "Bender" },
];

const SHAPE_TOOLS: ToolId[] = ["rectangle", "ellipse"];

export interface AnnotateControlsProps {
  onToolChange: (tool: ToolId) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onWidthEditStart?: () => void;
  onWidthEditComplete?: () => void;
  onHeadStyleChange: (style: ArrowHeadStyle) => void;
  onFilledChange: (filled: boolean) => void;
  onClear: () => void;
  onSavePng: () => void;
  onDrawModeToggle: (enabled: boolean) => void;
  onStartTimer: (minutes: number) => void;
  onAddMask: () => void;
  timerOn: boolean;
  maskOn: boolean;
  drawModeEnabled: boolean;
  currentTool: ToolId;
  currentColor: string;
  currentWidth: number;
  currentHeadStyle: ArrowHeadStyle;
  currentFilled: boolean;
  statusText?: string;
}

export function AnnotateControls({
  onToolChange,
  onColorChange,
  onWidthChange,
  onWidthEditStart,
  onWidthEditComplete,
  onHeadStyleChange,
  onFilledChange,
  onClear,
  onSavePng,
  onDrawModeToggle,
  onStartTimer,
  onAddMask,
  timerOn,
  maskOn,
  drawModeEnabled,
  currentTool,
  currentColor,
  currentWidth,
  currentHeadStyle,
  currentFilled,
  statusText = "",
}: AnnotateControlsProps) {
  /** A tool only counts as active while draw mode is on. */
  const isToolActive = (t: ToolId) => drawModeEnabled && currentTool === t;

  const handleToolSelect = (tool: ToolId) => {
    // Clicking the active tool deselects it: annotations stay on screen but
    // pointer events go back to the page underneath.
    if (isToolActive(tool)) {
      onDrawModeToggle(false);
      return;
    }
    onToolChange(tool);
    // Auto-enable draw mode when a drawing tool is selected
    if (!drawModeEnabled) {
      onDrawModeToggle(true);
    }
  };

  const needsSetup = !timerOn || !maskOn;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {/* Main tools (6-col grid) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6,1fr)",
          gap: "4px",
          animation: "rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both",
          animationDelay: "50ms",
        }}
      >
        {MAIN_TOOLS.map((tool) => (
          <button
            key={tool}
            onClick={() => handleToolSelect(tool)}
            title={TOOL_LABELS[tool]}
            style={{
              height: "30px",
              borderRadius: "12px",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              background: isToolActive(tool)
                ? "rgba(167,139,250,0.18)"
                : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!isToolActive(tool))
                e.currentTarget.style.background = "#26262B";
            }}
            onMouseLeave={(e) => {
              if (!isToolActive(tool))
                e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d={TOOL_ICONS[tool]}
                stroke={isToolActive(tool) ? "#A78BFA" : "#8B8B93"}
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ))}
      </div>

      {/* Extra tools (4-col grid) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: "4px",
          animation: "rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both",
          animationDelay: "100ms",
        }}
      >
        {EXTRA_TOOLS.map((tool) => (
          <button
            key={tool}
            onClick={() => handleToolSelect(tool)}
            title={TOOL_LABELS[tool]}
            style={{
              height: "30px",
              borderRadius: "12px",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              background: isToolActive(tool)
                ? "rgba(167,139,250,0.18)"
                : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!isToolActive(tool))
                e.currentTarget.style.background = "#26262B";
            }}
            onMouseLeave={(e) => {
              if (!isToolActive(tool))
                e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d={TOOL_ICONS[tool]}
                stroke={isToolActive(tool) ? "#A78BFA" : "#8B8B93"}
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ))}
      </div>

      {/* Color swatches */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          animation: "rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both",
          animationDelay: "150ms",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "2px 4px",
          }}
        >
          {CORE_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => onColorChange(color)}
              style={{
                width: "18px",
                height: "18px",
                padding: 0,
                borderRadius: "999px",
                cursor: "pointer",
                background: color,
                border:
                  color === "#0A0A0C"
                    ? "1px solid rgba(255,255,255,0.18)"
                    : "none",
                boxShadow:
                  currentColor === color
                    ? "0 0 0 2px #1C1C20, 0 0 0 4px #F5F5F7"
                    : "none",
              }}
            />
          ))}
          <label
            title="Choose a custom color"
            style={{
              position: "relative",
              width: "20px",
              height: "20px",
              flex: "none",
              overflow: "hidden",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.25)",
              background:
                "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
              cursor: "pointer",
            }}
          >
            <input
              aria-label="Choose custom annotation color"
              type="color"
              value={currentColor}
              onChange={(e) => onColorChange(e.target.value.toUpperCase())}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                opacity: 0,
                cursor: "pointer",
              }}
            />
          </label>
        </div>
      </div>

      {/* Size slider */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "9px",
          padding: "0 4px",
          animation: "rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both",
          animationDelay: "200ms",
        }}
      >
        <input
          type="range"
          min="1"
          max="100"
          value={currentWidth}
          onChange={(e) => onWidthChange(Number(e.target.value))}
          onFocus={onWidthEditStart}
          onPointerDown={onWidthEditStart}
          onPointerUp={onWidthEditComplete}
          onBlur={onWidthEditComplete}
          style={{ flex: 1, accentColor: "#A78BFA", height: "4px" }}
        />
        <span
          style={{
            font: "500 11px/1 Manrope,system-ui,sans-serif",
            color: "#8B8B93",
            fontVariantNumeric: "tabular-nums",
            minWidth: "22px",
            textAlign: "right",
          }}
        >
          {currentWidth}
        </span>
      </div>

      {/* Arrow head style — only meaningful for the arrow tool */}
      {isToolActive("arrow") && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "7px",
            animation: "rowIn 140ms cubic-bezier(0.2,0.8,0.2,1) both",
          }}
        >
          <span
            style={{
              font: "500 11px/1 Manrope,system-ui,sans-serif",
              color: "#8B8B93",
              paddingLeft: "4px",
            }}
          >
            Arrow head
          </span>
          <div style={{ display: "flex", gap: "4px" }}>
            {HEAD_STYLES.map((h) => (
              <button
                key={h.id}
                onClick={() => onHeadStyleChange(h.id)}
                title={h.label}
                style={{
                  flex: 1,
                  height: "26px",
                  padding: 0,
                  borderRadius: "999px",
                  border: "none",
                  cursor: "pointer",
                  font: "500 11px/1 Manrope,system-ui,sans-serif",
                  background:
                    currentHeadStyle === h.id
                      ? "rgba(167,139,250,0.18)"
                      : "transparent",
                  color: currentHeadStyle === h.id ? "#A78BFA" : "#8B8B93",
                }}
                onMouseEnter={(e) => {
                  if (currentHeadStyle !== h.id)
                    e.currentTarget.style.background = "#26262B";
                }}
                onMouseLeave={(e) => {
                  if (currentHeadStyle !== h.id)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Shape fill — only meaningful for rectangle / ellipse */}
      {SHAPE_TOOLS.some(isToolActive) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "0 4px",
            animation: "rowIn 140ms cubic-bezier(0.2,0.8,0.2,1) both",
          }}
        >
          <span
            style={{
              flex: 1,
              font: "400 12px/1 Manrope,system-ui,sans-serif",
              color: "#F5F5F7",
            }}
          >
            Fill shape
          </span>
          <button
            onClick={() => onFilledChange(!currentFilled)}
            aria-pressed={currentFilled}
            style={{
              height: "24px",
              padding: "0 11px",
              borderRadius: "999px",
              cursor: "pointer",
              font: "500 11px/1 Manrope,system-ui,sans-serif",
              background: currentFilled
                ? "rgba(167,139,250,0.18)"
                : "transparent",
              border: currentFilled
                ? "1px solid rgba(167,139,250,0.55)"
                : "1px solid rgba(255,255,255,0.15)",
              color: currentFilled ? "#A78BFA" : "#F5F5F7",
            }}
          >
            {currentFilled ? "On" : "Off"}
          </button>
        </div>
      )}

      {/* Session add-ons */}
      {needsSetup && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "7px",
            paddingTop: "11px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            animation: "rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both",
            animationDelay: "250ms",
          }}
        >
          <span
            style={{
              font: "500 11px/1 Manrope,system-ui,sans-serif",
              color: "#8B8B93",
              paddingLeft: "4px",
            }}
          >
            Session add-ons
          </span>
          {!timerOn && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  font: "400 12px/1 Manrope,system-ui,sans-serif",
                  color: "#F5F5F7",
                  paddingLeft: "4px",
                }}
              >
                Timer
              </span>
              {TIMER_PRESETS.map((mins) => (
                <button
                  key={mins}
                  onClick={() => onStartTimer(mins)}
                  style={{
                    flex: "none",
                    height: "24px",
                    padding: "0 7px",
                    borderRadius: "999px",
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "#F5F5F7",
                    font: "500 11px/1 Manrope,system-ui,sans-serif",
                    fontVariantNumeric: "tabular-nums",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#26262B")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  {mins}m
                </button>
              ))}
            </div>
          )}
          {!maskOn && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span
                style={{
                  flex: 1,
                  font: "400 12px/1 Manrope,system-ui,sans-serif",
                  color: "#F5F5F7",
                  paddingLeft: "4px",
                }}
              >
                Screen mask
              </span>
              <button
                onClick={onAddMask}
                style={{
                  height: "24px",
                  padding: "0 11px",
                  borderRadius: "999px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#F5F5F7",
                  font: "500 11px/1 Manrope,system-ui,sans-serif",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#26262B")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          animation: "rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both",
          animationDelay: "300ms",
        }}
      >
        <button
          onClick={onClear}
          style={{
            flex: 1,
            height: "32px",
            borderRadius: "999px",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#F5F5F7",
            font: "500 13px Manrope,system-ui,sans-serif",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#26262B")}
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          Clear
        </button>
        <button
          onClick={onSavePng}
          style={{
            flex: 1,
            height: "32px",
            borderRadius: "999px",
            background: "#86EFAC",
            border: "none",
            color: "#0A2E1B",
            font: "500 13px Manrope,system-ui,sans-serif",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#9df3bd")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#86EFAC")}
        >
          Save
        </button>
      </div>

      {/* Transient feedback: "Saved!", "Cleared", "Save failed" */}
      {statusText && (
        <div
          style={{
            font: "400 11px/1 Manrope,system-ui,sans-serif",
            color: "#8B8B93",
            textAlign: "center",
            animation: "rowIn 140ms cubic-bezier(0.2,0.8,0.2,1) both",
          }}
        >
          {statusText}
        </div>
      )}
    </div>
  );
}
