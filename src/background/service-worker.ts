import type {
  BackgroundToContentMessage,
  BackgroundToRecorderMessage,
  ContentToBackgroundMessage,
  GetTabIdResponse,
  RecordOptions,
  RecorderToBackgroundMessage,
  RecordingErrorCode,
  RecordingStatus,
  RecordingStage,
} from "../shared/types";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
  });
});

let recordingTabId: number | null = null;
let recordingActive = false;
let recordingPaused = false;
let startInFlight = false;
let stopRequested: "save" | "discard" | null = null;
// One terminal command per recording. Without this, clicking Stop and then
// Discard while the first command finalizes could turn a save into a discard.
let stopCommandSent = false;
let latestStatus: RecordingStatus = { state: "idle" };
let currentSessionId: string | null = null;

// Offscreen document lifecycle management.
let offscreenCreatePromise: Promise<void> | null = null;
let offscreenReady: boolean = false;
let offscreenReadyResolver: ((value: void) => void) | null = null;
let offscreenReadyPromise: Promise<void> | null = null;

class RecordingStartupError extends Error {
  constructor(
    readonly code: RecordingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RecordingStartupError";
  }
}

function makeSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logStage(sessionId: string, stage: RecordingStage, extra?: Record<string, unknown>): void {
  console.log(
    `[Capann] session=${sessionId} stage=${stage}`,
    extra ? JSON.stringify(extra) : "",
  );
}

function logError(
  sessionId: string,
  stage: RecordingStage,
  error: unknown,
  code: RecordingErrorCode,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";
  console.error(
    `[Capann] session=${sessionId} stage=${stage} code=${code} error=${name}: ${message}`,
  );
}

function startupErrorCode(
  error: unknown,
  fallback: RecordingErrorCode,
): RecordingErrorCode {
  return error instanceof RecordingStartupError ? error.code : fallback;
}

function updateActionBadge(status: RecordingStatus): void {
  if (status.state === "starting") {
    void chrome.action.setBadgeText({ text: "REC" });
    void chrome.action.setBadgeBackgroundColor({ color: "#DC2626" });
    void chrome.action.setTitle({ title: "Capann is preparing a recording" });
  } else if (status.state === "recording") {
    void chrome.action.setBadgeText({ text: "REC" });
    void chrome.action.setBadgeBackgroundColor({ color: "#DC2626" });
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - status.startedAt) / 1000),
    );
    const time = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
    void chrome.action.setTitle({
      title: `Capann recording ${time} — click to stop and save`,
    });
  } else if (status.state === "paused") {
    void chrome.action.setBadgeText({ text: "PAUS" });
    void chrome.action.setBadgeBackgroundColor({ color: "#A78BFA" });
    const elapsed = Math.floor(status.elapsedMs / 1000);
    const time = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
    void chrome.action.setTitle({
      title: `Capann recording paused at ${time} — click to save`,
    });
  } else {
    void chrome.action.setBadgeText({ text: "" });
    let title = "Open Capann on this page";
    if (status.state === "error") {
      title = `Capann — ${status.error}`;
    } else if (status.state === "saved") {
      title = `Capann — Saved ${status.filename}`;
    }
    void chrome.action.setTitle({ title });
  }
}

function sendToTab(
  tabId: number,
  message: BackgroundToContentMessage,
): Promise<void> {
  return chrome.tabs.sendMessage(tabId, message).then(() => undefined);
}

// Request a stream ID for the tab that hosts the Capann overlay. The ID is
// consumed by the extension's own offscreen document, which is allowed
// because Chrome 116+ lets a service worker obtain a tab-capture ID that any
// frame in the extension process can use.
//
// No `consumerTabId`: that would scope the stream to frames of another tab.
function getTabStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tabId },
        (streamId) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(
              new RecordingStartupError(
                "TAB_CAPTURE_UNAVAILABLE",
                error.message ?? "Chrome could not capture this tab.",
              ),
            );
            return;
          }
          if (!streamId) {
            reject(
              new RecordingStartupError(
                "TAB_CAPTURE_UNAVAILABLE",
                "Chrome returned no stream for this tab.",
              ),
            );
            return;
          }
          resolve(streamId);
        },
      );
    } catch (error) {
      reject(
        new RecordingStartupError(
          "TAB_CAPTURE_UNAVAILABLE",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  });
}

// Check for ANY offscreen document owned by this extension. Chrome allows only
// one at a time, so filtering by our URL would miss a leftover document (from
// an older build, or a failed load) and then createDocument() would refuse.
async function offscreenDocumentExists(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
  });
  return contexts.length > 0;
}

// Close the offscreen document and wait until Chrome reports it gone.
async function closeOffscreen(): Promise<void> {
  if (!(await offscreenDocumentExists())) return;
  await chrome.offscreen.closeDocument().catch(() => undefined);
  for (let i = 0; i < 40; i++) {
    if (!(await offscreenDocumentExists())) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Chrome's offscreen API rejects with this message when a document we did not
// observe is still open; close it and try once more.
function isSingleOffscreenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /single offscreen document/i.test(message);
}

// Verify a pre-existing offscreen document actually has its listener
// registered. A document whose script failed to load still exists in
// getContexts() but never answers.
function pingOffscreen(): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 1_500);
    try {
      chrome.runtime.sendMessage(
        { kind: "offscreen-ping", target: "offscreen" },
        (response) => {
          clearTimeout(timeout);
          resolve(Boolean(response?.ok));
        },
      );
    } catch {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

// Set while the recorder is being replaced (after a permission grant). Other
// callers wait for the replacement so they never address the closing document.
let offscreenReset: Promise<void> | null = null;

// Ensure the offscreen document exists, serializing concurrent creation attempts.
// Waits for the offscreen to signal readiness via offscreen-ready message.
async function ensureOffscreen(): Promise<void> {
  if (offscreenReset) await offscreenReset;
  if (offscreenCreatePromise) {
    await offscreenCreatePromise;
    if (offscreenReadyPromise) await offscreenReadyPromise;
    return;
  }
  if (await offscreenDocumentExists()) {
    if (await pingOffscreen()) {
      offscreenReady = true;
      return;
    }
    // Stale or broken document: replace it.
    await closeOffscreen();
    offscreenReady = false;
  }
  offscreenReadyPromise = new Promise<void>((resolve) => {
    offscreenReadyResolver = resolve;
  });
  offscreenCreatePromise = (async () => {
    const options: chrome.offscreen.CreateParameters = {
      url: "offscreen.html",
      reasons: [
        chrome.offscreen.Reason.USER_MEDIA,
        chrome.offscreen.Reason.BLOBS,
      ],
      justification:
        "Capture the active tab and compose a local recording with optional camera and microphone inputs.",
    };
    try {
      try {
        await chrome.offscreen.createDocument(options);
      } catch (error) {
        if (!isSingleOffscreenError(error)) throw error;
        await closeOffscreen();
        await chrome.offscreen.createDocument(options);
      }
    } catch (error) {
      offscreenCreatePromise = null;
      offscreenReadyPromise = null;
      offscreenReadyResolver = null;
      throw error;
    }
  })();
  await offscreenCreatePromise;
  // Wait for offscreen to signal it's ready (up to 10s).
  try {
    await Promise.race([
      offscreenReadyPromise!,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Offscreen ready timeout")), 10_000),
      ),
    ]);
    offscreenReady = true;
  } catch (error) {
    offscreenReady = false;
    offscreenCreatePromise = null;
    await closeOffscreen();
    throw new RecordingStartupError(
      "OFFSCREEN_SETUP_FAILED",
      "The recording component did not become ready in time.",
    );
  } finally {
    offscreenReadyPromise = null;
    offscreenReadyResolver = null;
  }
}

type OffscreenResponse = {
  ok: boolean;
  errorCode?: RecordingErrorCode;
  camera?: PermissionState;
  microphone?: PermissionState;
};

async function sendOffscreenCommand(
  message: BackgroundToRecorderMessage,
): Promise<OffscreenResponse> {
  if (!offscreenReady) {
    await ensureOffscreen();
  }
  return new Promise((resolve, reject) => {
    // A start timeout means the recorder answered but never finished starting,
    // so report it as a startup failure rather than a missing document.
    const timeoutCode: RecordingErrorCode =
      message.kind === "offscreen-start"
        ? "RECORDER_STARTUP_FAILED"
        : "OFFSCREEN_SETUP_FAILED";
    const timeout = setTimeout(() => {
      reject(
        new RecordingStartupError(
          timeoutCode,
          "The recording component did not respond.",
        ),
      );
    }, message.kind === "offscreen-start" ? 30_000 : 5_000);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          clearTimeout(timeout);
          reject(
            new RecordingStartupError(
              "OFFSCREEN_SETUP_FAILED",
              error.message ?? "The recording component could not be reached.",
            ),
          );
          return;
        }
        clearTimeout(timeout);
        if (response && typeof response === "object" && "ok" in response) {
          resolve(response as OffscreenResponse);
        } else {
          reject(
            new RecordingStartupError(
              "OFFSCREEN_SETUP_FAILED",
              "The recording component returned an invalid response.",
            ),
          );
        }
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(
        new RecordingStartupError(
          "OFFSCREEN_SETUP_FAILED",
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  });
}

async function ensureRecorderReady(): Promise<void> {
  try {
    await ensureOffscreen();
  } catch (error) {
    offscreenReady = false;
    throw new RecordingStartupError(
      "OFFSCREEN_SETUP_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function sendRecorderCommand(
  command: "pause" | "resume" | "stop" | "discard",
): Promise<void> {
  if (!(await offscreenDocumentExists())) return;
  if (!currentSessionId) return;
  await sendOffscreenCommand({
    kind: `offscreen-${command}`,
    sessionId: currentSessionId,
    target: "offscreen",
  } as BackgroundToRecorderMessage);
}

// Serialize the two terminal commands. A stop/discard clicked before the
// recorder is live is remembered and delivered by the post-start check or the
// first live status; once sent, later terminal commands are ignored.
function requestStop(command: "save" | "discard"): void {
  if (!recordingActive || stopCommandSent) return;
  stopCommandSent = true;
  if (latestStatus.state === "recording" || latestStatus.state === "paused") {
    stopRequested = null;
    void sendRecorderCommand(command === "save" ? "stop" : "discard");
    return;
  }
  stopRequested = command;
}

function notifyRecordingTab(status: RecordingStatus): void {
  latestStatus = status;
  recordingPaused = status.state === "paused";
  updateActionBadge(status);
  if (recordingTabId === null) return;
  const tabId = recordingTabId;
  void sendToTab(tabId, { kind: "recording-status", status }).catch(
    () => undefined,
  );
  if (
    status.state === "saved" ||
    status.state === "discarded" ||
    status.state === "error"
  ) {
    recordingActive = false;
    recordingPaused = false;
    stopRequested = null;
    stopCommandSent = false;
    recordingTabId = null;
    currentSessionId = null;
    // Close the offscreen document only after the recording fully finalizes.
    void closeOffscreenIfIdle();
  }
}

async function closeOffscreenIfIdle(): Promise<void> {
  if (recordingActive) return;
  if (await offscreenDocumentExists()) {
    await closeOffscreen();
    offscreenCreatePromise = null;
    offscreenReady = false;
  }
}

// Convert internal error codes to user-facing messages.
function toUserError(internalError: string, code: RecordingErrorCode): string {
  switch (code) {
    case "TAB_CAPTURE_UNAVAILABLE":
      return "Capann can't record this tab. Open Capann on a regular webpage or web app, then try again.";
    case "TAB_STREAM_ACQUISITION_FAILED":
      return "Chrome started capturing the tab but Capann couldn't use it. Try again.";
    case "NO_VIDEO_TRACK":
      return "That tab can't be recorded. Choose another webpage or web app.";
    case "RECORDER_STARTUP_FAILED":
      return "Capann could see the tab but couldn't start the recording. Try again.";
    case "OFFSCREEN_SETUP_FAILED":
      return "Capann couldn't prepare recording. Try again.";
    case "PERMISSION_DENIED_CAMERA":
      return "Camera unavailable — your recording will continue without the camera bubble.";
    case "PERMISSION_DENIED_MICROPHONE":
      return "Microphone unavailable — your recording will continue without microphone audio.";
    case "PERMISSION_DENIED_TAB_AUDIO":
      return "Tab audio unavailable — your recording will continue without audio from this tab.";
    case "PROTECTED_PAGE":
      return "This page can't be recorded — Chrome protects browser pages. Open a website or web app, then try again.";
    case "RECORDING_STOPPED_UNEXPECTEDLY":
      return "Recording ended unexpectedly — your video wasn't saved. Start a new recording when you're ready.";
    case "FILE_SAVE_FAILED":
      return "Recording is ready, but couldn't be saved — check your download permissions, then record again.";
    default:
      console.error("[Capann] Unknown recorder error code:", code, internalError);
      return "Capann couldn't begin the recording. Try again.";
  }
}

async function prewarmRecorder(
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    await ensureRecorderReady();
    sendResponse({ ok: true });
  } catch (error) {
    const code = startupErrorCode(error, "OFFSCREEN_SETUP_FAILED");
    logError("prewarm", "preparing-recorder", error, code);
    sendResponse({
      ok: false,
      error: toUserError(
        error instanceof Error ? error.message : String(error),
        code,
      ),
    });
  }
}

// Ask the recorder document for the extension origin's camera/microphone
// permission. Offscreen documents cannot prompt, so this only reports state.
async function reportPermissions(
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    await ensureRecorderReady();
    const response = await sendOffscreenCommand({
      kind: "offscreen-permission-state",
      target: "offscreen",
    });
    if (!response.ok) throw new Error("Permission check failed.");
    sendResponse({
      ok: true,
      camera: response.camera ?? "prompt",
      microphone: response.microphone ?? "prompt",
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// A visible extension page is the only place Chrome can show the camera and
// microphone prompt for the extension origin.
let permissionWindowId: number | null = null;

async function openPermissionPage(
  tabId: number,
  options: { camera: boolean; microphone: boolean },
): Promise<boolean> {
  // Keep a single permission window even if the user clicks Allow twice.
  if (permissionWindowId !== null) {
    await chrome.windows
      .remove(permissionWindowId)
      .catch(() => undefined);
    permissionWindowId = null;
  }
  const params = new URLSearchParams({ tabId: String(tabId) });
  if (options.camera) params.set("camera", "1");
  if (options.microphone) params.set("microphone", "1");
  try {
    const window = await chrome.windows.create({
      url: chrome.runtime.getURL(`permissions.html?${params.toString()}`),
      type: "popup",
      width: 460,
      height: 420,
    });
    permissionWindowId = window.id ?? null;
    return true;
  } catch {
    return false;
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === permissionWindowId) permissionWindowId = null;
});

async function startRecording(
  options: RecordOptions,
  tabId: number,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  if (recordingActive || startInFlight) {
    sendResponse({ ok: false, error: "A recording is already active." });
    return;
  }
  startInFlight = true;
  stopRequested = null;
  stopCommandSent = false;

  const sessionId = makeSessionId();
  currentSessionId = sessionId;

  try {
    // 1. The recorder must be ready before a stream ID exists, because an
    //    unused tab-capture ID expires within seconds. Awaiting here is safe:
    //    tabCapture does not need a transient user activation.
    logStage(sessionId, "preparing-recorder");
    if (!offscreenReady) await ensureRecorderReady();
    logStage(sessionId, "preparing-recorder", { ready: true });

    // 2. Keep Capann's UI out of the capture. The content script already hid
    //    the host synchronously on click; this also covers a stale render.
    void sendToTab(tabId, { kind: "recording-prepare-hide" }).catch(
      () => undefined,
    );

    // 3. Create the tab stream ID, then hand it to the recorder with no
    //    intermediate awaits so it cannot expire.
    logStage(sessionId, "acquiring-tab-stream");
    const streamId = await getTabStreamId(tabId);
    logStage(sessionId, "acquiring-tab-stream", { hasStreamId: true });

    recordingTabId = tabId;
    recordingActive = true;
    recordingPaused = false;
    stopRequested = null;
    latestStatus = { state: "starting", stage: "acquiring-tab-stream", sessionId };
    updateActionBadge(latestStatus);
    void sendToTab(tabId, { kind: "recording-status", status: latestStatus }).catch(
      () => undefined,
    );

    // List the fields explicitly. A spread here would carry any extra runtime
    // property (notably `kind`) over the discriminated union and make the
    // recorder ignore the command.
    const response = await sendOffscreenCommand({
      kind: "offscreen-start",
      sessionId,
      streamId,
      tabId,
      target: "offscreen",
      camera: options.camera,
      microphone: options.microphone,
      tabAudio: options.tabAudio,
    });

    if (!response.ok) {
      const code = response.errorCode ?? "RECORDER_STARTUP_FAILED";
      throw new RecordingStartupError(code, code);
    }

    logStage(sessionId, "starting-recorder", { ok: true });
    sendResponse({ ok: true });

    if (stopRequested) {
      const command = stopRequested;
      stopRequested = null;
      void sendRecorderCommand(command === "save" ? "stop" : "discard");
    }
  } catch (error) {
    const code = startupErrorCode(error, "RECORDER_STARTUP_FAILED");
    const stage: RecordingStage =
      code === "OFFSCREEN_SETUP_FAILED"
        ? "preparing-recorder"
        : code === "TAB_CAPTURE_UNAVAILABLE"
          ? "acquiring-tab-stream"
          : "starting-recorder";
    logError(sessionId, stage, error, code);
    const userError = toUserError(
      error instanceof Error ? error.message : String(error),
      code,
    );
    const status: RecordingStatus = {
      state: "error",
      error: userError,
      code,
      sessionId,
    };
    if (recordingTabId === tabId) recordingTabId = null;
    recordingActive = false;
    recordingPaused = false;
    stopRequested = null;
    stopCommandSent = false;
    latestStatus = status;
    updateActionBadge(status);
    // Stop accepting status from this session, then restore the UI before
    // doing any cleanup work.
    currentSessionId = null;
    void sendToTab(tabId, { kind: "recording-prepare-show" }).catch(
      () => undefined,
    );
    void sendToTab(tabId, { kind: "recording-status", status }).catch(
      () => undefined,
    );
    // Closing the offscreen document stops any capture a timed-out startup
    // managed to create, so the tab is not left muted.
    void closeOffscreenIfIdle();
    sendResponse({ ok: false, error: status.error });
  } finally {
    startInFlight = false;
  }
}

function handleActionInvocation(tab?: chrome.tabs.Tab): void {
  if (recordingActive) {
    requestStop("save");
    return;
  }
  if (tab?.id === undefined) return;
  void sendToTab(tab.id, { kind: "toggle-capann-ui" })
    .then(() => {
      void chrome.action.setBadgeText({ text: "" });
      void chrome.action.setBadgeText({ text: "", tabId: tab.id });
      void chrome.action.setTitle({ title: "Open Capann on this page" });
      void chrome.action.setTitle({
        tabId: tab.id,
        title: "Open Capann on this page",
      });
    })
    .catch(() => {
      void chrome.action.setBadgeText({ text: "!", tabId: tab.id });
      void chrome.action.setBadgeBackgroundColor({
        color: "#DC2626",
        tabId: tab.id,
      });
      void chrome.action.setTitle({
        tabId: tab.id,
        title: "This page can't be recorded",
      });
    });
}

chrome.action.onClicked.addListener(handleActionInvocation);

chrome.runtime.onMessage.addListener(
  (
    message: ContentToBackgroundMessage | RecorderToBackgroundMessage,
    sender,
    sendResponse,
  ) => {
    if (message.kind === "get-tab-id") {
      const tabId = sender.tab?.id ?? -1;
      sendResponse({
        tabId,
        recordingStatus:
          sender.tab?.id === recordingTabId ? latestStatus : { state: "idle" },
      });
      return false;
    }
    if (message.kind === "get-recording-status") {
      sendResponse(
        sender.tab?.id === recordingTabId ? latestStatus : { state: "idle" },
      );
      return false;
    }
    if (message.kind === "record-prewarm") {
      void prewarmRecorder(sendResponse);
      return true;
    }
    if (message.kind === "record-permission-state") {
      void reportPermissions(sendResponse);
      return true;
    }
    if (message.kind === "record-request-permission") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        sendResponse({
          ok: false,
          error: "Open Capann on the tab you want to record.",
        });
        return false;
      }
      void openPermissionPage(tabId, message).then((opened) =>
        sendResponse(
          opened
            ? { ok: true }
            : { ok: false, error: "Capann couldn't open the permission window." },
        ),
      );
      return true;
    }
    if (message.kind === "permission-granted") {
      if (recordingActive) return false;
      // Chrome applies a new grant only to documents loaded afterwards, so
      // replace the recorder before the page prepares it again. Close first so
      // a prewarm started right after this message creates a fresh document.
      void (async () => {
        offscreenCreatePromise = null;
        offscreenReady = false;
        const reset = closeOffscreen();
        offscreenReset = reset;
        try {
          await reset;
        } finally {
          offscreenReset = null;
        }
        await sendToTab(message.tabId, {
          kind: "recording-permission",
          camera: message.camera,
          microphone: message.microphone,
        }).catch(() => undefined);
      })();
      return false;
    }
    if (message.kind === "capture-visible-tab") {
      // Contract: the content script hides #capann-host before sending this,
      // so the returned pixels contain the page only. The worker must not
      // composite annotations — export draws them client-side, exactly once.
      const callback = (dataUrl: string) => {
        if (chrome.runtime.lastError || !dataUrl) {
          sendResponse({
            kind: "capture-visible-tab-error",
            error: chrome.runtime.lastError?.message ?? "Capture failed",
          });
        } else {
          sendResponse({ kind: "capture-visible-tab-result", dataUrl });
        }
      };
      if (sender.tab?.windowId !== undefined)
        chrome.tabs.captureVisibleTab(
          sender.tab.windowId,
          { format: "png" },
          callback,
        );
      else chrome.tabs.captureVisibleTab({ format: "png" }, callback);
      return true;
    }
    if (message.kind === "download-png") {
      chrome.downloads.download({
        url: message.dataUrl,
        filename: message.filename,
        saveAs: false,
      });
      return false;
    }
    if (message.kind === "record-start") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        sendResponse({
          ok: false,
          error:
            "Start recording from the Capann overlay on the tab you want to capture.",
        });
        return false;
      }
      // Pass only the three toggles. `message` is the whole record-start
      // envelope, so forwarding it would let its `kind: "record-start"` leak
      // into the offscreen command and overwrite `kind: "offscreen-start"`.
      void startRecording(
        {
          camera: message.camera,
          microphone: message.microphone,
          tabAudio: message.tabAudio,
        },
        tabId,
        sendResponse,
      );
      return true;
    }
    if (message.kind === "record-pause" || message.kind === "record-resume") {
      // The chip targets states, not a toggle: a double click must not bounce
      // the recorder out of the state the presenter asked for.
      if (!recordingActive) return false;
      if (latestStatus.state !== "recording" && latestStatus.state !== "paused")
        return false;
      const paused = message.kind === "record-pause";
      if (recordingPaused !== paused) {
        recordingPaused = paused;
        void sendRecorderCommand(paused ? "pause" : "resume");
      }
      return false;
    }
    if (message.kind === "record-stop" || message.kind === "record-discard") {
      requestStop(message.kind === "record-stop" ? "save" : "discard");
      return false;
    }
    if (message.kind === "record-status") {
      // Ignore status from any session other than the current one, including
      // late messages after a session was abandoned, so a stale
      // "error"/"saved"/"recording" cannot clobber a new recording.
      if (
        message.status.state !== "idle" &&
        "sessionId" in message.status &&
        message.status.sessionId !== currentSessionId
      ) {
        return false;
      }
      // Second delivery point for a stop/discard clicked during startup: if it
      // landed after `startRecording`'s post-start check, the first live status
      // still honors it. Clear as soon as it is sent so a late status cannot
      // turn a save into a discard.
      if (
        (message.status.state === "recording" ||
          message.status.state === "paused") &&
        stopRequested
      ) {
        const command = stopRequested;
        stopRequested = null;
        void sendRecorderCommand(command === "save" ? "stop" : "discard");
      }
      notifyRecordingTab(message.status);
      return false;
    }
    if (message.kind === "recorder-camera-frame") {
      // The page chip renders the camera bubble, so the recorder streams small
      // preview frames instead of compositing its own bubble. Relay only while
      // the frame belongs to the live session and the recording tab is known.
      if (
        message.sessionId === currentSessionId &&
        recordingActive &&
        recordingTabId !== null
      ) {
        void sendToTab(recordingTabId, {
          kind: "camera-preview-frame",
          sessionId: message.sessionId,
          dataUrl: message.dataUrl,
        }).catch(() => undefined);
      }
      return false;
    }
    if (message.kind === "offscreen-progress") {
      // Progress update from offscreen during startup.
      if (currentSessionId === message.sessionId && recordingActive) {
        latestStatus = { state: "starting", stage: message.stage, sessionId: message.sessionId };
        updateActionBadge(latestStatus);
        if (recordingTabId !== null) {
          void sendToTab(recordingTabId, { kind: "recording-status", status: latestStatus }).catch(() => undefined);
        }
      }
      return false;
    }
    if (message.kind === "recorder-download-request") {
      const { blobUrl, filename, mimeType, sessionId } = message;
      if (sessionId !== currentSessionId) return false;
      chrome.downloads.download({ url: blobUrl, filename, saveAs: false }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          notifyRecordingTab({
            state: "error",
            error: "FILE_SAVE_FAILED",
            code: "FILE_SAVE_FAILED",
            sessionId,
          });
        } else {
          notifyRecordingTab({ state: "saved", filename, sessionId });
        }
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
        // Instruct the recorder to release resources and close.
        void chrome.runtime.sendMessage({ kind: "offscreen-close", target: "offscreen" });
      });
      return false;
    }
    if (message.kind === "recorder-final-status") {
      // The recorder has finished (saved/discarded/error) and resources cleaned up.
      notifyRecordingTab(message.status);
      return false;
    }
    if (message.kind === "offscreen-close") {
      void closeOffscreenIfIdle();
      return false;
    }
    if (message.kind === "offscreen-ready") {
      // Offscreen document signals it's loaded and listening.
      if (offscreenReadyResolver) {
        offscreenReadyResolver();
      }
      offscreenReady = true;
      return false;
    }
    return false;
  },
);

// Fusion seam: every shortcut means one thing while idle and another while a
// recording is active. When adding a command, handle both halves here — a
// command that falls through to the annotation branch during a recording would
// act on a tab whose overlay is deliberately hidden.
chrome.commands.onCommand.addListener((command) => {
  if (
    recordingActive &&
    command === "cycle-tool" &&
    (latestStatus.state === "recording" || latestStatus.state === "paused")
  ) {
    recordingPaused = !recordingPaused;
    void sendRecorderCommand(recordingPaused ? "pause" : "resume");
    return;
  }
  if (recordingActive && command === "clear-annotations") {
    requestStop("discard");
    return;
  }
  if (command === "clear-annotations") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id !== undefined)
        void chrome.tabs
          .sendMessage(tabs[0].id, { kind: "clear-annotations" })
          .catch(() => undefined);
    });
  } else if (command === "cycle-tool") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id !== undefined)
        void chrome.tabs
          .sendMessage(tabs[0].id, { kind: "cycle-tool" })
          .catch(() => undefined);
    });
  }
});
