/** Shared annotation, storage, and extension message contracts. */

export interface Point {
  x: number;
  y: number;
}

export type ToolId =
  | "pencil"
  | "highlighter"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "text"
  | "select"
  | "laser"
  | "spotlight"
  | "eraser";

export type ArrowHeadStyle = "triangle" | "chevron" | "stick";

interface AnnotationBase {
  id: string;
  color: string;
  strokeWidth: number;
  createdAt: number;
}

export interface StrokeAnnotation extends AnnotationBase {
  type: "pencil" | "highlighter";
  points: Point[];
}

export interface ArrowAnnotation extends AnnotationBase {
  type: "arrow";
  start: Point;
  end: Point;
  headStyle: ArrowHeadStyle;
}

export interface ShapeAnnotation extends AnnotationBase {
  type: "rectangle" | "ellipse";
  start: Point;
  end: Point;
  filled: boolean;
}

export interface TextAnnotation extends AnnotationBase {
  type: "text";
  position: Point;
  text: string;
  fontSize: number;
}

export type AnnotationObject = StrokeAnnotation | ArrowAnnotation | ShapeAnnotation | TextAnnotation;

export interface TabAnnotationState {
  objects: AnnotationObject[];
}

export interface RecordOptions {
  camera: boolean;
  microphone: boolean;
  tabAudio: boolean;
}

export type RecordingStatus =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "recording"; startedAt: number; camera: boolean; microphone: boolean; tabAudio: boolean; unavailable: string[] }
  | { state: "paused"; elapsedMs: number; camera: boolean; microphone: boolean; tabAudio: boolean; unavailable: string[] }
  | { state: "error"; error: string }
  | { state: "saved"; filename: string }
  | { state: "discarded" };

export type BackgroundToContentMessage =
  | { kind: "toggle-capann-ui" }
  | { kind: "clear-annotations" }
  | { kind: "cycle-tool" }
  | { kind: "recording-status"; status: RecordingStatus };

export type CaptureVisibleTabResponse =
  | { kind: "capture-visible-tab-result"; dataUrl: string }
  | { kind: "capture-visible-tab-error"; error: string };

export type ContentToBackgroundMessage =
  | { kind: "get-tab-id" }
  | { kind: "get-recording-status" }
  | { kind: "capture-visible-tab" }
  | { kind: "download-png"; dataUrl: string; filename: string }
  | ({ kind: "record-start" } & RecordOptions);

export type BackgroundToRecorderMessage =
  | ({ kind: "offscreen-start"; streamId: string; tabId: number } & RecordOptions)
  | { kind: "offscreen-pause" }
  | { kind: "offscreen-resume" }
  | { kind: "offscreen-stop" }
  | { kind: "offscreen-discard" };

export type RecorderToBackgroundMessage =
  | { kind: "record-status"; status: RecordingStatus }
  | { kind: "offscreen-new-stream-id"; tabId: number }
  | { kind: "offscreen-close" };

export interface GetTabIdResponse {
  tabId: number;
  recordingStatus: RecordingStatus;
}

export const TOOL_LABELS: Record<ToolId, string> = {
  pencil: "Pencil",
  highlighter: "Highlighter",
  arrow: "Arrow",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  select: "Select",
  laser: "Laser pointer",
  spotlight: "Spotlight",
  eraser: "Eraser",
};

export const STORAGE_KEY_PREFIX = "capann_tab_";
