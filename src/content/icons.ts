import type { ToolId } from '../shared/types';

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const TOOL_ICONS: Record<ToolId, string> = {
  pencil: svg('<path d="M3 21l1.6-5.6L16.4 3.6a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L8.6 19.4 3 21z"/><path d="M14.5 5.5l4 4"/>'),
  highlighter: svg('<path d="M6 20h12"/><path d="M9 14l-3 3 1 3 3-1 8-8-4-4z"/><path d="M13 5l4 4"/>'),
  arrow: svg('<path d="M4 20L20 4"/><path d="M20 4h-7"/><path d="M20 4v7"/>'),
  rectangle: svg('<rect x="4" y="6" width="16" height="12" rx="1.5"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
  text: svg('<path d="M5 6h14"/><path d="M12 6v12"/><path d="M9 18h6"/>'),
  laser: svg('<circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7" stroke-dasharray="2 3"/>'),
  spotlight: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'),
  eraser: svg('<path d="M20 20H9l-6-6a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L13 18"/>'),
};

export const CLEAR_ICON = svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>');
export const SAVE_ICON = svg('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>');
export const HANDLE_ICON = svg('<circle cx="8" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="18" r="1.4" fill="currentColor" stroke="none"/>');
export const CLOSE_ICON = svg('<path d="M5 5l14 14"/><path d="M19 5L5 19"/>');
export const POWER_ICON = svg('<path d="M12 3v8"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>');
