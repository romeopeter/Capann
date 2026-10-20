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

export type ArrowHeadStyle = "triangle" | "chevron" | "stick" | "bender";

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
  /**
   * Perpendicular offset (px) of the quadratic control point from the
   * start→end chord midpoint. Present only for the "Bender" curved
   * connector; straight arrows omit it (treated as 0).
   */
  bend?: number;
}

export interface ShapeAnnotation extends AnnotationBase {
  type: "rectangle" | "ellipse";
  start: Point;
  end: Point;
  filled: boolean;
}

export interface TextAnnotation extends AnnotationBase {
  type: "text";
  /** Tail tip: the point on the page the note was anchored to. */
  position: Point;
  text: string;
  fontSize: number;
  /**
   * Bubble body width in CSS pixels. Optional because notes stored before
   * text bubbles existed only carried a font size; layout falls back to the
   * default width when it is missing.
   */
  width?: number;
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

/**
 * Camera and microphone permission for the extension origin. Offscreen
 * documents cannot show a permission prompt, so the state is checked here and
 * granted once from a visible extension page.
 */
export interface MediaPermissionState {
  camera: PermissionState;
  microphone: PermissionState;
}

export type MediaPermissionResponse =
  | ({ ok: true } & MediaPermissionState)
  | { ok: false; error?: string };

/** Startup stage names for console tracing and recovery mapping. */
export type RecordingStage =
  | "preparing-recorder"
  | "acquiring-tab-stream"
  | "preparing-video"
  | "starting-recorder"
  | "recording"
  | "paused"
  | "stopping"
  | "finalizing"
  | "idle";

/** Stable internal failure codes for logging and recovery (not shown to users). */
export type RecordingErrorCode =
  | "TAB_CAPTURE_UNAVAILABLE"
  | "TAB_STREAM_ACQUISITION_FAILED"
  | "NO_VIDEO_TRACK"
  | "RECORDER_STARTUP_FAILED"
  | "OFFSCREEN_SETUP_FAILED"
  | "PERMISSION_DENIED_CAMERA"
  | "PERMISSION_DENIED_MICROPHONE"
  | "PERMISSION_DENIED_TAB_AUDIO"
  | "PROTECTED_PAGE"
  | "RECORDING_STOPPED_UNEXPECTEDLY"
  | "FILE_SAVE_FAILED";

export type RecordingStatus =
  | { state: "idle" }
  | { state: "starting"; stage: RecordingStage; sessionId: string }
  | { state: "recording"; startedAt: number; camera: boolean; microphone: boolean; tabAudio: boolean; unavailable: string[]; sessionId: string }
  | { state: "paused"; elapsedMs: number; camera: boolean; microphone: boolean; tabAudio: boolean; unavailable: string[]; sessionId: string }
  | { state: "error"; error: string; code: RecordingErrorCode; sessionId?: string }
  | { state: "saved"; filename: string; sessionId: string }
  | { state: "discarded"; sessionId: string };

export type BackgroundToContentMessage =
  | { kind: "toggle-capann-ui" }
  | { kind: "clear-annotations" }
  | { kind: "cycle-tool" }
  | { kind: "recording-status"; status: RecordingStatus }
  | { kind: "recording-prepare-hide" }
  | { kind: "recording-prepare-show" }
  | ({ kind: "recording-permission" } & MediaPermissionState);

export type CaptureVisibleTabResponse =
  | { kind: "capture-visible-tab-result"; dataUrl: string }
  | { kind: "capture-visible-tab-error"; error: string };

export type ContentToBackgroundMessage =
  | { kind: "get-tab-id" }
  | { kind: "get-recording-status" }
  | { kind: "record-prewarm" }
  | { kind: "record-permission-state" }
  | {
      kind: "record-request-permission";
      camera: boolean;
      microphone: boolean;
    }
  | { kind: "capture-visible-tab" }
  | { kind: "download-png"; dataUrl: string; filename: string }
  | ({ kind: "record-start" } & RecordOptions);

/** Worker-to-offscreen commands (typed request/response via sendMessage). */
export type BackgroundToRecorderMessage =
  | { kind: "offscreen-ping"; target: "offscreen" }
  | { kind: "offscreen-permission-state"; target: "offscreen" }
  | ({
      kind: "offscreen-start";
      sessionId: string;
      streamId: string;
      tabId: number;
      target: "offscreen";
    } & RecordOptions)
  | { kind: "offscreen-pause"; sessionId: string; target: "offscreen" }
  | { kind: "offscreen-resume"; sessionId: string; target: "offscreen" }
  | { kind: "offscreen-stop"; sessionId: string; target: "offscreen" }
  | { kind: "offscreen-discard"; sessionId: string; target: "offscreen" };

/** Offscreen-to-worker messages (typed responses + progress). */
export type RecorderToBackgroundMessage =
  | { kind: "offscreen-ready"; target: "offscreen" }
  | { kind: "offscreen-progress"; sessionId: string; stage: RecordingStage }
  | { kind: "record-status"; status: RecordingStatus }
  | { kind: "recorder-download-request"; blobUrl: string; filename: string; mimeType: string; sessionId: string }
  | { kind: "recorder-final-status"; status: RecordingStatus }
  | { kind: "offscreen-close"; target: "offscreen" }
  | ({
      kind: "permission-granted";
      tabId: number;
    } & MediaPermissionState);

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
