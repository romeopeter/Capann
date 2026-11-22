/**
 * The extension's own contracts: annotations, storage, and the messages
 * between its contexts. What crosses to the API or the website lives in
 * @capann/contract and is re-exported here where the extension names it.
 */

import type { LinkInfo } from "@capann/contract";
export type { WebsiteToExtensionMessage } from "@capann/contract";

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
  /** Free text written straight onto the page (no bubble). */
  | "write"
  | "select"
  | "laser"
  | "spotlight"
  /** Magnifier lens that follows the cursor, like the spotlight. */
  | "zoom"
  | "eraser"
  /** Drag over an area to capture it, then mark it up and frame it. */
  | "screenshot";

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
  /**
   * `start`/`end` describe the shape in its own, unrotated frame. The shape is
   * then rotated by `rotation` about the center of that box.
   */
  start: Point;
  end: Point;
  filled: boolean;
  /** Clockwise rotation in radians. Optional so older saved shapes still load. */
  rotation?: number;
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
  /**
   * Top-left of the bubble body, pinned once the tip has been dragged
   * independently of the bubble. Absent = automatic placement above/below the
   * tip (every comment before tip dragging existed, and fresh comments).
   */
  bubble?: Point;
}

/** Typeface families for free text. System fonts only: nothing is downloaded. */
export type TextFont = "sans" | "serif" | "mono" | "hand";

/** Free text: lines written directly on the page, no bubble or tail. */
export interface FreeTextAnnotation extends AnnotationBase {
  type: "freetext";
  /** Top-left of the first line, in page coordinates. */
  position: Point;
  text: string;
  fontSize: number;
  font: TextFont;
}

export type AnnotationObject =
  | StrokeAnnotation
  | ArrowAnnotation
  | ShapeAnnotation
  | TextAnnotation
  | FreeTextAnnotation;

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
  /**
   * Terminal like "saved": capture is over and every stream is released, but
   * the file went to the Premium share flow instead of straight to Downloads.
   * Its progress is reported separately as `ShareJobStatus`.
   */
  | { state: "sharing"; filename: string; sessionId: string }
  | { state: "discarded"; sessionId: string };

// ── Premium: shareable links ─────────────────────────────────────────────────

/** A recording uploaded to the Premium backend: the API's `LinkInfo`. */
export type ShareLink = LinkInfo;

/** Whether to also keep the .webm on this computer when a link is made. */
export type CopyPreference = "ask" | "always" | "never";

/** Upload failure classes; each maps to one friendly message and recovery. */
export type ShareErrorCode =
  | "PAYMENT_REQUIRED"
  | "SIGNED_OUT"
  | "TOO_LARGE"
  | "NETWORK"
  | "SERVER";

export type ShareUpload =
  | { state: "uploading"; loaded: number; total: number }
  | { state: "uploaded"; link: ShareLink }
  | { state: "failed"; code: ShareErrorCode; error: string };

/**
 * The local-copy half of a share job. "ask" waits for the presenter; a failed
 * upload always saves a copy, whatever was chosen, so a video is never lost.
 */
export type ShareCopy = "ask" | "saving" | "saved" | "skipped" | "failed";

/** One recording's trip to the backend, owned by the offscreen document. */
export interface ShareJobStatus {
  sessionId: string;
  filename: string;
  upload: ShareUpload;
  copy: ShareCopy;
  /** The blob is released; nothing more will change. */
  done: boolean;
}

/** Sent with `offscreen-stop` when the stop should produce a link. */
export interface ShareRequest {
  token: string;
  copyPreference: CopyPreference;
}

/** What the page may know about the account. Never includes the token. */
export interface AccountSummary {
  signedIn: boolean;
  email: string | null;
  paid: boolean;
  expiresAt: string | null;
  copyPreference: CopyPreference;
}

export type PremiumActionResult =
  | { ok: true }
  | { ok: false; error: string; retryAfter?: number };

/** Tabs of the side panel. "links" exists only in the premium build. */
export type SidePanelSection = "screenshot" | "links";

export type BackgroundToContentMessage =
  | { kind: "toggle-capann-ui" }
  | { kind: "clear-annotations" }
  | { kind: "cycle-tool" }
  | { kind: "recording-status"; status: RecordingStatus }
  | { kind: "recording-prepare-hide" }
  | { kind: "recording-prepare-show" }
  | { kind: "camera-preview-frame"; sessionId: string; dataUrl: string }
  | ({ kind: "recording-permission" } & MediaPermissionState)
  | { kind: "share-status"; status: ShareJobStatus }
  /** From the side panel: is a screenshot open here? Answered with ScreenshotEditingResponse. */
  | { kind: "screenshot-editing-query" };

export interface ScreenshotEditingResponse {
  editing: boolean;
}

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
  | { kind: "record-pause" }
  | { kind: "record-resume" }
  | { kind: "record-stop" }
  | { kind: "record-discard" }
  | ({ kind: "record-start" } & RecordOptions)
  /** Opens Chrome's side panel on one of its tabs (needs the click's gesture). */
  | { kind: "open-side-panel"; section: SidePanelSection }
  /**
   * Broadcast when this tab's screenshot editor opens or closes, for the side
   * panel (which checks `sender.tab`). The worker ignores it.
   */
  | { kind: "screenshot-editing"; editing: boolean }
  // Premium only; the free build never sends these.
  /** `refresh` re-checks `paid` with the server (throttled unless `force`). */
  | { kind: "premium-account"; refresh: boolean; force?: boolean }
  | { kind: "premium-sign-in"; email: string }
  | { kind: "premium-sign-out" }
  | { kind: "premium-upgrade" }
  /** Premium: opens the side panel on its Links tab. */
  | { kind: "premium-open-links" }
  | { kind: "premium-copy-preference"; preference: CopyPreference }
  | { kind: "share-copy-choice"; sessionId: string; save: boolean; remember: boolean };

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
  | {
      kind: "offscreen-stop";
      sessionId: string;
      target: "offscreen";
      /** Present only for a paid Premium session: upload instead of download. */
      share?: ShareRequest;
    }
  | { kind: "offscreen-discard"; sessionId: string; target: "offscreen" }
  | { kind: "offscreen-share-copy"; sessionId: string; save: boolean; target: "offscreen" };

/** Offscreen-to-worker messages (typed responses + progress). */
export type RecorderToBackgroundMessage =
  | { kind: "offscreen-ready"; target: "offscreen" }
  | { kind: "offscreen-progress"; sessionId: string; stage: RecordingStage }
  | { kind: "record-status"; status: RecordingStatus }
  | {
      kind: "recorder-camera-frame";
      sessionId: string;
      dataUrl: string;
      target: "offscreen";
    }
  | { kind: "recorder-download-request"; blobUrl: string; filename: string; mimeType: string; sessionId: string }
  | { kind: "recorder-final-status"; status: RecordingStatus }
  | { kind: "offscreen-close"; target: "offscreen" }
  // Share jobs outlive the recording session, so they carry their own tab id
  // instead of relying on the worker's (in-memory, per-session) state.
  | { kind: "recorder-share-status"; tabId: number; status: ShareJobStatus; target: "offscreen" }
  | { kind: "recorder-copy-download"; blobUrl: string; filename: string; target: "offscreen" }
  | { kind: "recorder-share-finished"; sessionId: string; target: "offscreen" }
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
  text: "Comment",
  write: "Text",
  select: "Select",
  laser: "Laser pointer",
  spotlight: "Spotlight",
  zoom: "Zoom lens",
  eraser: "Eraser",
  screenshot: "Screenshot",
};

/**
 * One line on what each tool does, shown under its name in the panel header
 * while it is active. Kept short: the header shares its row with the undo,
 * redo, duplicate, and delete buttons.
 */
export const TOOL_CAPTIONS: Record<ToolId, string> = {
  pencil: "Draw freehand lines",
  highlighter: "Highlight with a see-through stroke",
  arrow: "Drag to point at something",
  rectangle: "Drag to draw a box",
  ellipse: "Drag to draw a circle",
  text: "Click to add a comment bubble",
  write: "Click anywhere and type",
  select: "Move, resize, or rotate a mark",
  laser: "Point with a fading red trail",
  spotlight: "Dim everything but the cursor",
  zoom: "Magnify what's under the cursor",
  eraser: "Drag over marks to remove them",
  screenshot: "Drag over an area to capture it",
};

export const STORAGE_KEY_PREFIX = "capann_tab_";
