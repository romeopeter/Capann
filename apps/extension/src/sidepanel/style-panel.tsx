/**
 * style-panel.tsx — the side panel's "Screenshot" tab (every edition).
 *
 * Edits the screenshot frame: background, padding, corners, shadow, and
 * border. The style is saved to `chrome.storage.local` on every change; the
 * page's screenshot editor follows it live through `storage.onChanged`, and
 * the next screenshot starts with it.
 *
 * The controls are only available while the window's active tab has a
 * screenshot open (`useScreenshotOpen`). Otherwise the tab explains how to take
 * one, so the style can't be changed with nothing to apply it to.
 *
 * The preview here draws through the same `drawFrame` as the editor and the
 * export, onto a placeholder page, so it shows exactly what the frame does.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SelectionPlusIcon } from "@phosphor-icons/react";
import {
  BACKGROUNDS,
  DEFAULT_SCREENSHOT_STYLE,
  PADDING_MAX,
  RADIUS_MAX,
  SCREENSHOT_STYLE_KEY,
  backgroundCss,
  drawFrame,
  frameLayout,
  loadScreenshotStyle,
  normalizeStyle,
  saveScreenshotStyle,
} from "../shared/screenshot-style";
import type { ScreenshotStyle } from "../shared/screenshot-style";
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  ScreenshotEditingResponse,
} from "../shared/types";

/**
 * Whether the active tab of this window has a screenshot open, or null while
 * checking. The page is the source of truth: the panel asks it when it opens
 * and whenever the active tab changes or reloads, and the page announces when
 * its editor opens or closes.
 */
function useScreenshotOpen(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let disposed = false;
    let activeTabId: number | null = null;
    let check = 0;
    const refresh = async () => {
      const id = ++check;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (disposed || id !== check) return;
      activeTabId = tab?.id ?? null;
      if (activeTabId === null) return setOpen(false);
      try {
        const reply = (await chrome.tabs.sendMessage(activeTabId, {
          kind: "screenshot-editing-query",
        } satisfies BackgroundToContentMessage)) as ScreenshotEditingResponse | undefined;
        if (!disposed && id === check) setOpen(reply?.editing === true);
      } catch {
        // No Capann on that page (a chrome:// tab, or not loaded yet).
        if (!disposed && id === check) setOpen(false);
      }
    };
    const onActivated = () => void refresh();
    const onUpdated = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId === activeTabId && info.status) void refresh();
    };
    // Never answers: other messages on this channel belong to the worker.
    const onMessage = (
      message: ContentToBackgroundMessage,
      sender: chrome.runtime.MessageSender,
    ) => {
      if (message?.kind === "screenshot-editing" && sender.tab?.id === activeTabId)
        setOpen(message.editing);
      return false;
    };
    void refresh();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);
  return open;
}

const MUTED: CSSProperties = { margin: 0, color: "var(--text-muted)", fontSize: 12 };
const LABEL: CSSProperties = { margin: 0, fontSize: 12, fontWeight: 500 };

/** A stand-in page for the preview: a toolbar, some text, and a card. */
const PLACEHOLDER = { width: 600, height: 360 };
let placeholder: HTMLCanvasElement | null = null;
function placeholderPage(): HTMLCanvasElement {
  if (placeholder) return placeholder;
  const canvas = document.createElement("canvas");
  canvas.width = PLACEHOLDER.width * 2;
  canvas.height = PLACEHOLDER.height * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, PLACEHOLDER.width, PLACEHOLDER.height);
  ctx.fillStyle = "#F1F1F4";
  ctx.fillRect(0, 0, PLACEHOLDER.width, 44);
  ctx.fillStyle = "#D9D9E0";
  for (const x of [20, 38, 56]) {
    ctx.beginPath();
    ctx.arc(x, 22, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const bar = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
  };
  bar(40, 82, 280, 18, "#2B2E36");
  bar(40, 120, 420, 10, "#C9CAD3");
  bar(40, 140, 380, 10, "#C9CAD3");
  bar(40, 160, 300, 10, "#C9CAD3");
  ctx.fillStyle = "#ECE6FA";
  ctx.beginPath();
  ctx.roundRect(40, 196, 250, 124, 12);
  ctx.fill();
  bar(60, 220, 120, 12, "#A78BFA");
  bar(60, 244, 180, 8, "#C4B5FD");
  bar(60, 260, 150, 8, "#C4B5FD");
  ctx.fillStyle = "#F4F4F6";
  ctx.beginPath();
  ctx.roundRect(310, 196, 250, 124, 12);
  ctx.fill();
  placeholder = canvas;
  return canvas;
}

function Preview({ style }: { style: ScreenshotStyle }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const layout = frameLayout(PLACEHOLDER.width, PLACEHOLDER.height, style);
  const scale = width > 0 ? width / layout.width : 0;
  const height = Math.round(layout.height * scale);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || scale === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = scale * dpr;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const page = placeholderPage();
    drawFrame(ctx, page, { x: 0, y: 0, width: page.width, height: page.height }, layout, style, s);
  });

  return (
    <div
      ref={wrapRef}
      style={{
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid var(--border-hairline)",
        // "None" exports a transparent background; show that as a checkerboard.
        background: backgroundCss(null),
      }}
    >
      <canvas
        ref={canvasRef}
        aria-label="Preview of the screenshot frame"
        role="img"
        style={{ display: "block", width: "100%", height }}
      />
    </div>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <p style={LABEL}>{label}</p>
        {value !== undefined && (
          <span
            style={{
              ...MUTED,
              marginLeft: "auto",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        gap: 4,
        padding: 3,
        borderRadius: 12,
        background: "var(--surface-base)",
        border: "1px solid var(--border-hairline)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            style={{
              height: 28,
              borderRadius: 9,
              border: 0,
              fontSize: 12,
              fontWeight: 500,
              background: active ? "rgba(167,139,250,0.18)" : "transparent",
              color: active ? "var(--accent-violet)" : "var(--text-muted)",
              cursor: disabled ? "default" : "pointer",
              transition: "background 180ms var(--ease-morph), color 180ms var(--ease-morph)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ScreenshotStylePanel() {
  const open = useScreenshotOpen();
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Screenshot style</h2>
        <p style={{ ...MUTED, fontSize: 11 }}>
          {open
            ? "Applies to the screenshot you're editing and the ones after it."
            : "Style a screenshot while you edit it."}
        </p>
      </div>
      {open === null ? null : open ? <StyleControls /> : <NoScreenshot />}
    </div>
  );
}

function NoScreenshot() {
  return (
    <div
      role="status"
      style={{
        padding: "28px 16px",
        borderRadius: 16,
        border: "1px dashed var(--border-strong)",
        textAlign: "center",
      }}
    >
      <SelectionPlusIcon size={22} color="#A78BFA" weight="bold" />
      <p style={{ margin: "8px 0 2px", fontWeight: 500 }}>No screenshot open</p>
      <p style={MUTED}>
        In Capann's Mark screen panel, pick the Screenshot tool and select an area. Its
        background, padding, corners, shadow, and border can be changed here
        while you edit it.
      </p>
    </div>
  );
}

function StyleControls() {
  const [style, setStyle] = useState<ScreenshotStyle>(DEFAULT_SCREENSHOT_STYLE);

  useEffect(() => {
    let cancelled = false;
    void loadScreenshotStyle().then((stored) => {
      if (!cancelled) setStyle(stored);
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && SCREENSHOT_STYLE_KEY in changes)
        setStyle(normalizeStyle(changes[SCREENSHOT_STYLE_KEY]!.newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const update = (change: Partial<ScreenshotStyle>) => {
    const next = { ...style, ...change };
    setStyle(next);
    void saveScreenshotStyle(next);
  };

  const custom = style.background.startsWith("#");

  return (
    <div className="row" style={{ display: "grid", gap: 18 }}>
      <Preview style={style} />

      <Field label="Background">
        <div
          role="radiogroup"
          aria-label="Background"
          style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8 }}
        >
          {BACKGROUNDS.map((bg) => {
            const active = style.background === bg.id;
            return (
              <button
                key={bg.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={bg.label}
                title={bg.label}
                onClick={() => update({ background: bg.id })}
                style={{
                  aspectRatio: "1",
                  borderRadius: 10,
                  border: "1px solid var(--border-strong)",
                  background: backgroundCss(bg.fill),
                  boxShadow: active
                    ? "0 0 0 2px #141417, 0 0 0 4px var(--text-primary)"
                    : "none",
                  transition: "box-shadow 180ms var(--ease-morph)",
                }}
              />
            );
          })}
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 8px",
            borderRadius: 10,
            border: `1px solid ${custom ? "var(--accent-violet)" : "var(--border-hairline)"}`,
            cursor: "pointer",
          }}
        >
          <input
            type="color"
            aria-label="Custom background color"
            value={custom ? style.background : "#ECE6FA"}
            onChange={(event) => update({ background: event.target.value.toUpperCase() })}
            style={{
              width: 26,
              height: 26,
              padding: 0,
              border: 0,
              borderRadius: 8,
              background: "none",
              cursor: "pointer",
            }}
          />
          <span style={{ fontSize: 12 }}>Custom color</span>
          {custom && (
            <span style={{ ...MUTED, fontSize: 11, marginLeft: "auto" }}>{style.background}</span>
          )}
        </label>
      </Field>

      <Field label="Padding" value={`${style.padding}px`}>
        <input
          type="range"
          className="range"
          aria-label="Padding"
          min={0}
          max={PADDING_MAX}
          step={4}
          value={style.padding}
          onChange={(event) => update({ padding: Number(event.target.value) })}
        />
      </Field>

      <Field label="Corners" value={`${style.radius}px`}>
        <input
          type="range"
          className="range"
          aria-label="Corner radius"
          min={0}
          max={RADIUS_MAX}
          step={1}
          value={style.radius}
          onChange={(event) => update({ radius: Number(event.target.value) })}
        />
      </Field>

      <Field label="Shadow">
        <Segmented
          label="Shadow"
          options={[
            { id: "none", label: "None" },
            { id: "soft", label: "Soft" },
            { id: "strong", label: "Strong" },
          ]}
          value={style.shadow}
          onChange={(shadow) => update({ shadow })}
        />
      </Field>

      <Field label="Border">
        <Segmented
          label="Border"
          options={[
            { id: "none", label: "None" },
            { id: "thin", label: "Thin" },
            { id: "thick", label: "Thick" },
          ]}
          value={style.border}
          onChange={(border) => update({ border })}
        />
        <Segmented
          label="Border color"
          options={[
            { id: "light", label: "Light" },
            { id: "dark", label: "Dark" },
          ]}
          value={style.borderTone}
          onChange={(borderTone) => update({ borderTone })}
          disabled={style.border === "none"}
        />
      </Field>

      <button
        type="button"
        onClick={() => update(DEFAULT_SCREENSHOT_STYLE)}
        style={{
          justifySelf: "start",
          background: "none",
          border: 0,
          padding: 0,
          color: "var(--accent-violet)",
          fontSize: 12,
        }}
      >
        Reset to default
      </button>
    </div>
  );
}
