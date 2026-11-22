/**
 * annotate-controls.tsx
 *
 * Embedded annotation controls rendered inside the shared Capann shell.
 * This is the former Toolbar body minus its standalone panel: no logo
 * header, no circular collapsed state, no morph animation, no
 * close/collapse button. Undo/redo live in the shell header via the
 * actions slot; timer and screen-mask chips live at the OverlayApp level.
 */

import { useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ChatCircleIcon,
  MagnifyingGlassPlusIcon,
  PaletteIcon,
  SelectionPlusIcon,
  TextTIcon,
} from "@phosphor-icons/react";
import type { ArrowHeadStyle, TextFont, ToolId } from "../shared/types";
import { TOOL_LABELS } from "../shared/types";
import { TOOL_ICONS } from "./icons";
import { SHELL_BUTTON } from "./shell";
import { TEXT_FONTS } from "./free-text";
import { LENS_RADII, ZOOM_LEVELS } from "./zoom-lens";
import type { LensSize, ZoomLevel } from "./zoom-lens";

// Two rows on a seven-column grid. Text (free writing) ends the first row and
// Comment starts the second, so the two text tools sit next to each other;
// Screenshot ends the second row.
const MAIN_TOOLS: ToolId[] = [
  "pencil",
  "highlighter",
  "arrow",
  "rectangle",
  "ellipse",
  "write",
];
const EXTRA_TOOLS: ToolId[] = [
  "text",
  "select",
  "laser",
  "spotlight",
  "zoom",
  "eraser",
  "screenshot",
];
const GRID_COLUMNS = 7;

const CORE_COLORS = ["#EF4444", "#0A0A0C", "#FACC15", "#22C55E", "#FFFFFF"];

const TIMER_PRESETS = [5, 10, 15]; // minutes

const HEAD_STYLES: { id: ArrowHeadStyle; label: string }[] = [
  { id: "triangle", label: "Triangle" },
  { id: "chevron", label: "Chevron" },
  { id: "stick", label: "Stick" },
  { id: "bender", label: "Bender" },
];

const SHAPE_TOOLS: ToolId[] = ["rectangle", "ellipse"];

const SIZE_MIN = 1;
const SIZE_MAX = 100;

/**
 * Brush-size slider. The track is a wedge that thickens left to right, so the
 * control previews what it does; the violet fill and white thumb follow the
 * design tokens. Replaces the native range input, which could not be styled to
 * match.
 *
 * Keeps the contract the native input had: `onEditStart` fires on pointer down
 * or focus and `onEditComplete` on release or blur, so one drag (or one burst
 * of key presses) stays a single undo step upstream.
 */
function SizeSlider({
  value,
  onChange,
  onEditStart,
  onEditComplete,
}: {
  value: number;
  onChange: (value: number) => void;
  onEditStart?: () => void;
  onEditComplete?: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const fraction = (value - SIZE_MIN) / (SIZE_MAX - SIZE_MIN);

  const setFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onChange(Math.round(SIZE_MIN + t * (SIZE_MAX - SIZE_MIN)));
  };

  const wedge = "polygon(0 calc(50% - 1px), 100% 0, 100% 100%, 0 calc(50% + 1px))";

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Size"
      aria-valuemin={SIZE_MIN}
      aria-valuemax={SIZE_MAX}
      aria-valuenow={value}
      className="capann-size-slider"
      onFocus={() => onEditStart?.()}
      onBlur={() => {
        if (!draggingRef.current) onEditComplete?.();
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        onEditStart?.();
        setFromPointer(e.clientX);
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) setFromPointer(e.clientX);
      }}
      onPointerUp={(e) => {
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onEditComplete?.();
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
        onEditComplete?.();
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        let next = value;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") next += step;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next -= step;
        else if (e.key === "Home") next = SIZE_MIN;
        else if (e.key === "End") next = SIZE_MAX;
        else return;
        e.preventDefault();
        onChange(Math.min(SIZE_MAX, Math.max(SIZE_MIN, next)));
      }}
      style={{
        position: "relative",
        flex: 1,
        height: "20px",
        cursor: "pointer",
        touchAction: "none",
        outline: "none",
      }}
    >
      <div
        ref={trackRef}
        style={{
          position: "absolute",
          left: "7px",
          right: "7px",
          top: "50%",
          height: "12px",
          transform: "translateY(-50%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: wedge,
            background: "rgba(255,255,255,0.12)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${fraction * 100}%`,
              background: "#A78BFA",
            }}
          />
        </div>
        <div
          className="capann-size-thumb"
          style={{
            position: "absolute",
            left: `${fraction * 100}%`,
            top: "50%",
            width: "14px",
            height: "14px",
            transform: "translate(-50%, -50%)",
            borderRadius: "999px",
            background: "#F5F5F7",
            boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Tool glyph. Comment uses Phosphor's chat-circle (bold weight, to match the
 * 1.7px stroke of the other tool icons at 16px); the rest are the path icons
 * in icons.ts.
 */
function ToolIcon({ tool, active }: { tool: ToolId; active: boolean }) {
  const color = active ? "#A78BFA" : "#8B8B93";
  if (tool === "text")
    return <ChatCircleIcon size={16} weight="bold" color={color} />;
  if (tool === "write") return <TextTIcon size={16} weight="bold" color={color} />;
  if (tool === "zoom")
    return <MagnifyingGlassPlusIcon size={16} weight="bold" color={color} />;
  if (tool === "screenshot")
    return <SelectionPlusIcon size={16} weight="bold" color={color} />;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d={TOOL_ICONS[tool]}
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One tool in the grid. Hovering or focusing it previews its name and caption
 * in the panel header (`onPreview`), so a tool can be learned without being
 * picked; leaving clears the preview. The label is `aria-label` rather than a
 * `title` tooltip, which would only repeat the header.
 */
function ToolButton({
  tool,
  active,
  onSelect,
  onPreview,
}: {
  tool: ToolId;
  active: boolean;
  onSelect: (tool: ToolId) => void;
  onPreview?: (tool: ToolId | null) => void;
}) {
  return (
    <button
      onClick={() => onSelect(tool)}
      aria-label={TOOL_LABELS[tool]}
      aria-pressed={active}
      style={{
        height: "30px",
        borderRadius: "12px",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        background: active ? "rgba(167,139,250,0.18)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "#26262B";
        onPreview?.(tool);
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
        onPreview?.(null);
      }}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) onPreview?.(tool);
      }}
      onBlur={() => onPreview?.(null)}
    >
      <ToolIcon tool={tool} active={active} />
    </button>
  );
}

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
  /** Free text font; the row shows while Text is active or a text is selected. */
  currentFont: TextFont;
  onFontChange: (font: TextFont) => void;
  showFontRow: boolean;
  zoomLevel: ZoomLevel;
  lensSize: LensSize;
  onZoomLevelChange: (zoom: ZoomLevel) => void;
  onLensSizeChange: (size: LensSize) => void;
  /**
   * "screenshot": the same tools on a frozen screenshot. Session add-ons are
   * hidden, and the actions become Style / Copy / Save.
   */
  mode?: "page" | "screenshot";
  /** Tools not offered here (e.g. live-only tools on a screenshot). */
  hiddenTools?: ReadonlySet<ToolId>;
  /** A tool is hovered or keyboard-focused (null when it no longer is). */
  onToolPreview?: (tool: ToolId | null) => void;
  onOpenStyle?: () => void;
  onCopy?: () => void;
  copyAvailable?: boolean;
}

const ROW_LABEL: CSSProperties = {
  font: "500 11px/1 Manrope,system-ui,sans-serif",
  color: "#8B8B93",
  paddingLeft: "4px",
};

/**
 * A labelled row of pill choices (arrow heads, fonts, zoom). Contextual rows
 * use it so they look and behave the same.
 */
function OptionRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: ReactNode; title?: string; style?: CSSProperties }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "7px",
        animation: "rowIn 140ms cubic-bezier(0.2,0.8,0.2,1) both",
      }}
    >
      <span style={ROW_LABEL}>{label}</span>
      <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: "4px" }}>
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={String(option.id)}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.id)}
              title={option.title}
              style={{
                flex: 1,
                height: "26px",
                padding: 0,
                borderRadius: "999px",
                border: "none",
                cursor: "pointer",
                font: "500 11px/1 Manrope,system-ui,sans-serif",
                background: active ? "rgba(167,139,250,0.18)" : "transparent",
                color: active ? "#A78BFA" : "#8B8B93",
                ...option.style,
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "#26262B";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ACTION_BUTTON: CSSProperties = {
  flex: 1,
  height: "32px",
  borderRadius: "999px",
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "#F5F5F7",
  font: "500 13px Manrope,system-ui,sans-serif",
  cursor: "pointer",
};

/** Ghost pill (hairline border) used for secondary actions. */
function GhostButton({
  children,
  onClick,
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...ACTION_BUTTON,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "#26262B";
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
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
  currentFont,
  onFontChange,
  showFontRow,
  zoomLevel,
  lensSize,
  onZoomLevelChange,
  onLensSizeChange,
  mode = "page",
  hiddenTools,
  onToolPreview,
  onOpenStyle,
  onCopy,
  copyAvailable = true,
}: AnnotateControlsProps) {
  const screenshotMode = mode === "screenshot";
  const offered = (tools: ToolId[]) =>
    hiddenTools ? tools.filter((tool) => !hiddenTools.has(tool)) : tools;
  const mainTools = offered(MAIN_TOOLS);
  const extraTools = offered(EXTRA_TOOLS);
  /** A tool only counts as active while draw mode is on. */
  const isToolActive = (t: ToolId) => drawModeEnabled && currentTool === t;
  // A color outside the swatch row came from the custom picker; the palette
  // icon takes that color so the picker shows what is currently selected.
  const isCustomColor = !CORE_COLORS.some(
    (c) => c.toLowerCase() === currentColor.toLowerCase(),
  );

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

  const needsSetup = !screenshotMode && (!timerOn || !maskOn);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {/* Main tools */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLUMNS},1fr)`,
          gap: "4px",
        }}
      >
        {mainTools.map((tool) => (
          <ToolButton
            key={tool}
            tool={tool}
            active={isToolActive(tool)}
            onSelect={handleToolSelect}
            onPreview={onToolPreview}
          />
        ))}
      </div>

      {/* Extra tools (same grid, so the two rows line up) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLUMNS},1fr)`,
          gap: "4px",
        }}
      >
        {extraTools.map((tool) => (
          <ToolButton
            key={tool}
            tool={tool}
            active={isToolActive(tool)}
            onSelect={handleToolSelect}
            onPreview={onToolPreview}
          />
        ))}
      </div>

      {/* Color swatches */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
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
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: isCustomColor ? currentColor : "#F5F5F7",
              cursor: "pointer",
            }}
          >
            <PaletteIcon size={20} weight={isCustomColor ? "fill" : "regular"} />
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
        }}
      >
        <SizeSlider
          value={currentWidth}
          onChange={onWidthChange}
          onEditStart={onWidthEditStart}
          onEditComplete={onWidthEditComplete}
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
        <OptionRow
          label="Arrow head"
          options={HEAD_STYLES.map((h) => ({ id: h.id, label: h.label, title: h.label }))}
          value={currentHeadStyle}
          onChange={onHeadStyleChange}
        />
      )}

      {/* Font — free text only. Each choice is shown in its own typeface. */}
      {showFontRow && (
        <OptionRow
          label="Font"
          options={TEXT_FONTS.map((f) => ({
            id: f.id,
            label: f.label,
            title: `${f.label} font`,
            style: { fontFamily: f.stack, fontSize: "12px", fontWeight: f.weight },
          }))}
          value={currentFont}
          onChange={onFontChange}
        />
      )}

      {/* Zoom lens: magnification and lens size */}
      {isToolActive("zoom") && (
        <>
          <OptionRow
            label="Zoom"
            options={ZOOM_LEVELS.map((z) => ({ id: z, label: `${z}×`, title: `${z}× magnification` }))}
            value={zoomLevel}
            onChange={onZoomLevelChange}
          />
          <OptionRow
            label="Lens size"
            options={(Object.keys(LENS_RADII) as LensSize[]).map((size) => ({
              id: size,
              label: size,
              title: { S: "Small", M: "Medium", L: "Large" }[size],
            }))}
            value={lensSize}
            onChange={onLensSizeChange}
          />
        </>
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
        }}
      >
        {screenshotMode ? (
          <>
            <GhostButton onClick={() => onOpenStyle?.()} title="Background, padding, corners, shadow, and border">
              Style
            </GhostButton>
            <GhostButton
              onClick={() => onCopy?.()}
              disabled={!copyAvailable}
              title={
                copyAvailable
                  ? "Copy the framed image"
                  : "This page doesn't allow copying images. Use Save."
              }
            >
              Copy
            </GhostButton>
          </>
        ) : (
          <GhostButton onClick={onClear}>Clear</GhostButton>
        )}
        <button
          onClick={onSavePng}
          style={{
            ...ACTION_BUTTON,
            background: "#86EFAC",
            border: "none",
            color: "#0A2E1B",
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
