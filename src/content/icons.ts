/**
 * icons.ts
 *
 * SVG icon definitions for all annotation tools and UI controls.
 * Icons are defined as path data strings matching the Claude Design mockup.
 *
 * Exports:
 * - TOOL_ICONS: SVG paths for all annotation tools (pencil, highlighter, arrow, etc.)
 * - UI action icons (clear, save, handle, close, power)
 */

import type { ToolId } from '../shared/types';

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const TOOL_ICONS: Record<ToolId, string> = {
  pencil: 'M5 19l3-.8L19.2 7A2 2 0 0016.4 4.2L5.2 15.4 4.4 19 5 19z',
  highlighter: 'M6 20h5l1.5-3.5 6-7-4-4-6 7L7 17l-1 3z',
  arrow: 'M5 19L19 5M19 5h-8M19 5v8',
  rectangle: 'M4.5 6.5h15v11h-15z',
  ellipse: 'M12 4a8 8 0 100 16 8 8 0 100-16z',
  text: 'M5 6.5h14M12 6.5V19M9 19h6',
  laser: 'M12 9a3 3 0 100 6 3 3 0 100-6zM12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2',
  spotlight: 'M12 4a8 8 0 100 16 8 8 0 100-16zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 100-5z',
  eraser: 'M4 14l6-6 6 6-4 4H8l-4-4zM8 20h11',
};

export const CLEAR_ICON = svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>');
export const SAVE_ICON = svg('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>');
export const HANDLE_ICON = svg('<circle cx="8" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="18" r="1.4" fill="currentColor" stroke="none"/>');
export const CLOSE_ICON = svg('<path d="M5 5l14 14"/><path d="M19 5L5 19"/>');
export const POWER_ICON = svg('<path d="M12 3v8"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>');
