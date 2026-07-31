export interface Point {
  x: number;
  y: number;
}

export type ToolId =
  | 'pencil'
  | 'highlighter'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'laser'
  | 'spotlight'
  | 'eraser';

export type ArrowHeadStyle = 'triangle' | 'chevron' | 'stick';

interface AnnotationBase {
  id: string;
  color: string;
  strokeWidth: number;
  createdAt: number;
}

export interface StrokeAnnotation extends AnnotationBase {
  type: 'pencil' | 'highlighter';
  points: Point[];
}

export interface ArrowAnnotation extends AnnotationBase {
  type: 'arrow';
  start: Point;
  end: Point;
  headStyle: ArrowHeadStyle;
}

export interface ShapeAnnotation extends AnnotationBase {
  type: 'rectangle' | 'ellipse';
  start: Point;
  end: Point;
  filled: boolean;
}

export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  position: Point;
  text: string;
  fontSize: number;
}

export type AnnotationObject =
  | StrokeAnnotation
  | ArrowAnnotation
  | ShapeAnnotation
  | TextAnnotation;

export interface TabAnnotationState {
  objects: AnnotationObject[];
}

/** Messages sent from the background service worker into a content script. */
export type BackgroundToContentMessage =
  | { kind: 'toggle-draw-mode' }
  | { kind: 'clear-annotations' }
  | { kind: 'cycle-tool' }
  | { kind: 'capture-visible-tab-result'; dataUrl: string }
  | { kind: 'capture-visible-tab-error'; error: string };

/** Messages sent from a content script into the background service worker. */
export type ContentToBackgroundMessage =
  | { kind: 'get-tab-id' }
  | { kind: 'capture-visible-tab' }
  | { kind: 'download-png'; dataUrl: string; filename: string };

export interface GetTabIdResponse {
  tabId: number;
}

export const TOOL_LABELS: Record<ToolId, string> = {
  pencil: 'Pencil',
  highlighter: 'Highlighter',
  arrow: 'Arrow',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Text',
  laser: 'Laser pointer',
  spotlight: 'Spotlight',
  eraser: 'Eraser',
};

export const STORAGE_KEY_PREFIX = 'screenslate_tab_';
