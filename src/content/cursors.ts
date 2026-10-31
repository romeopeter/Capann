/**
 * cursors.ts
 *
 * Custom canvas cursors, built as SVG data URLs from Phosphor glyphs (fill
 * weight). Paths are copied from @phosphor-icons/react/dist/defs because a CSS
 * cursor must be an image URL; re-copy them if the icon set is upgraded. All
 * glyphs use a 256-unit box.
 *
 * Results are memoized: cursors are re-applied on pointer move, and rebuilding
 * and re-encoding an SVG each time would be wasteful.
 */

import type { ToolId } from "../shared/types";

// Phosphor glyphs (fill weight), inlined so the cursors can be data URLs. Paths
// come from @phosphor-icons/react/dist/defs; re-copy them if the icon set is
// upgraded. All use a 256-unit box.
const CURSOR_GLYPHS = {
  select:
    "M220.49,207.8,207.8,220.49a12,12,0,0,1-17,0l-56.57-56.57L115,214.08l-.13.33A15.84,15.84,0,0,1,100.26,224l-.78,0a15.82,15.82,0,0,1-14.41-11L32.8,52.92A15.95,15.95,0,0,1,52.92,32.8L213,85.07a16,16,0,0,1,1.41,29.8l-.33.13-50.16,19.27,56.57,56.56A12,12,0,0,1,220.49,207.8Z",
  move:
    "M96,136H64v24a8,8,0,0,1-13.66,5.66l-32-32a8,8,0,0,1,0-11.32l32-32A8,8,0,0,1,64,96v24H96a8,8,0,0,1,0,16Zm0-72h24V96a8,8,0,0,0,16,0V64h24a8,8,0,0,0,5.66-13.66l-32-32a8,8,0,0,0-11.32,0l-32,32A8,8,0,0,0,96,64Zm141.66,58.34-32-32A8,8,0,0,0,192,96v24H160a8,8,0,0,0,0,16h32v24a8,8,0,0,0,13.66,5.66l32-32A8,8,0,0,0,237.66,122.34ZM160,192H136V160a8,8,0,0,0-16,0v32H96a8,8,0,0,0-5.66,13.66l32,32a8,8,0,0,0,11.32,0l32-32A8,8,0,0,0,160,192Z",
  grabbing:
    "M216,104v48a88,88,0,0,1-176,0V136a16,16,0,0,1,32,0v8a8,8,0,0,0,16,0V88a16,16,0,0,1,32,0v16a8,8,0,0,0,16,0V88a16,16,0,0,1,32,0v16a8,8,0,0,0,16,0,16,16,0,0,1,32,0Z",
  rotate:
    "M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1-5.66-13.66l17-17-10.55-9.65-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,1,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60l10.93,10L226.34,50.3A8,8,0,0,1,240,56Z",
  resize:
    "M237.66,133.66l-32,32A8,8,0,0,1,192,160V136H64v24a8,8,0,0,1-13.66,5.66l-32-32a8,8,0,0,1,0-11.32l32-32A8,8,0,0,1,64,96v24H192V96a8,8,0,0,1,13.66-5.66l32,32A8,8,0,0,1,237.66,133.66Z",
  comment:
    "M232,128A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Z",
  pencil:
    "M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM192,108.68,147.31,64l24-24L216,84.68Z",
  highlighter:
    "M253.66,106.34a8,8,0,0,0-11.32,0L192,156.69,107.31,72l50.35-50.34a8,8,0,1,0-11.32-11.32L96,60.69A16,16,0,0,0,93.18,79.5L72,100.69a16,16,0,0,0,0,22.62L76.69,128,18.34,186.34a8,8,0,0,0,3.13,13.25l72,24A7.88,7.88,0,0,0,96,224a8,8,0,0,0,5.66-2.34L136,187.31l4.69,4.69a16,16,0,0,0,22.62,0l21.18-21.18A16,16,0,0,0,203.31,168l50.35-50.34A8,8,0,0,0,253.66,106.34ZM152,180.69,83.31,112,104,91.31,172.69,160Z",
  arrow:
    "M200,64V168a8,8,0,0,1-13.66,5.66L140,127.31,69.66,197.66a8,8,0,0,1-11.32-11.32L128.69,116,82.34,69.66A8,8,0,0,1,88,56H192A8,8,0,0,1,200,64Z",
  rectangle:
    "M232,56V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56Z",
  ellipse:
    "M232,128A104,104,0,1,1,128,24,104.13,104.13,0,0,1,232,128Z",
} as const;

/** Filled glyph with a dark halo and white rim so it reads on any page. */
function glyphMarkup(path: string, color: string): string {
  return (
    `<path d="${path}" fill="#0A0A0C" stroke="#0A0A0C" stroke-width="30" stroke-linejoin="round"/>` +
    `<path d="${path}" fill="${color}" stroke="#FFFFFF" stroke-width="10" paint-order="stroke" stroke-linejoin="round"/>`
  );
}

function svgCursor(
  svg: string,
  hotX: number,
  hotY: number,
  fallback = "crosshair",
): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;
}

/**
 * Cursor for the drawing tools, or null where the browser's own is right
 * (text I-beam, select's move/resize cursors, the eraser ring).
 *
 * - Pencil / highlighter: the tool glyph with its hotspot on the nib.
 * - Arrow / rectangle / ellipse: a crosshair (precise anchor point) with the
 *   tool glyph as a small badge, since the drag start must stay exact.
 * The glyph takes the active color so the next stroke is previewed.
 */
function buildToolCursor(tool: ToolId, color: string): string | null {
  if (tool === "text") {
    // Comment: Phosphor chat-circle. Comments don't take the palette color, so
    // the glyph is the neutral text color. Hotspot is the bubble's tail tip,
    // which is where the comment's own tail will point.
    const size = 26;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">` +
      glyphMarkup(CURSOR_GLYPHS.comment, "#F5F5F7") +
      `</svg>`;
    return svgCursor(svg, 3, size - 3, "text");
  }
  if (tool === "pencil" || tool === "highlighter") {
    const size = 28;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">` +
      glyphMarkup(CURSOR_GLYPHS[tool], color) +
      `</svg>`;
    // Nib: bottom-left of the glyph.
    return svgCursor(svg, 3, size - 3);
  }
  if (tool === "arrow" || tool === "rectangle" || tool === "ellipse") {
    const size = 36;
    const c = 14;
    const cross = (stroke: string, w: number) =>
      `<path d="M${c} 3V25M3 ${c}H25" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      cross("#0A0A0C", 4) +
      cross("#FFFFFF", 1.5) +
      `<svg x="18" y="18" width="16" height="16" viewBox="0 0 256 256">` +
      glyphMarkup(CURSOR_GLYPHS[tool], color) +
      `</svg></svg>`;
    return svgCursor(svg, c, c);
  }
  return null;
}


const cache = new Map<string, string>();
function memo(key: string, build: () => string): string {
  let value = cache.get(key);
  if (value === undefined) {
    value = build();
    cache.set(key, value);
  }
  return value;
}

/** Rotation (degrees) of the double-headed resize glyph per transformer handle. */
const HANDLE_ROTATION: Record<number, number> = {
  0: 45, // nw
  3: 45, // se
  1: -45, // ne
  2: -45, // sw
  4: 90, // n
  5: 90, // s
  6: 0, // w
  7: 0, // e
};

export type SelectCursorKind =
  | "select"
  | "move"
  | "grabbing"
  | "rotate"
  | number;

/**
 * Cursor for the select tool and its transformer: the pointer when idle, a
 * four-way arrow over something movable, a closed hand while dragging, and a
 * double arrow rotated to the edge or corner of the handle being resized.
 * `number` is a transformer handle index (see geometry.ts); `rotation`
 * (radians) turns the resize arrow with a rotated shape so it still points
 * along the edge being dragged.
 */
export function selectCursor(kind: SelectCursorKind, rotation = 0): string {
  // Cache by 5° steps; finer differences are not visible in a 26px cursor.
  const deg = Math.round(((rotation * 180) / Math.PI) / 5) * 5;
  return memo(`select:${kind}:${typeof kind === "number" ? deg : 0}`, () => {
    const size = 26;
    const white = "#F5F5F7";
    const wrap = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">${inner}</svg>`;
    if (kind === "select") {
      // Pointer tip is the glyph's top-left.
      return svgCursor(wrap(glyphMarkup(CURSOR_GLYPHS.select, white)), 5, 5, "default");
    }
    if (kind === "move") {
      return svgCursor(wrap(glyphMarkup(CURSOR_GLYPHS.move, white)), size / 2, size / 2, "move");
    }
    if (kind === "rotate") {
      return svgCursor(wrap(glyphMarkup(CURSOR_GLYPHS.rotate, white)), size / 2, size / 2, "grab");
    }
    if (kind === "grabbing") {
      return svgCursor(wrap(glyphMarkup(CURSOR_GLYPHS.grabbing, white)), size / 2, size / 2, "grabbing");
    }
    const angle = (HANDLE_ROTATION[kind] ?? 0) + deg;
    return svgCursor(
      wrap(
        `<g transform="rotate(${angle} 128 128)">${glyphMarkup(CURSOR_GLYPHS.resize, white)}</g>`,
      ),
      size / 2,
      size / 2,
      "move",
    );
  });
}

/** Apply a cursor, skipping the write when it has not changed. */
export function setCanvasCursor(canvas: HTMLElement, cursor: string): void {
  if (canvas.dataset.cursor === cursor) return;
  canvas.dataset.cursor = cursor;
  canvas.style.cursor = cursor;
}

export function toolCursor(tool: ToolId, color: string): string | null {
  if (
    tool !== "text" &&
    tool !== "pencil" &&
    tool !== "highlighter" &&
    tool !== "arrow" &&
    tool !== "rectangle" &&
    tool !== "ellipse"
  )
    return null;
  return memo(`tool:${tool}:${color}`, () => buildToolCursor(tool, color) ?? "");
}

/**
 * Ring cursor matching the eraser's reach, so it's obvious what will be rubbed
 * out. Radius is clamped because browsers refuse to render cursors past ~128px.
 */
export function eraserCursor(strokeWidth: number): string {
  const r = Math.min(48, Math.max(10, strokeWidth));
  const size = r * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${r}" cy="${r}" r="${r - 1}" fill="rgba(245,245,247,0.18)" ` +
    `stroke="#F5F5F7" stroke-width="1.5"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${r} ${r}, cell`;
}
