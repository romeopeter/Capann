import type {
  BackgroundToContentMessage,
  BackgroundToRecorderMessage,
  ContentToBackgroundMessage,
  RecordOptions,
  RecorderToBackgroundMessage,
  RecordingStatus,
} from "../shared/types";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
  });
});

let recordingTabId: number | null = null;
let recordingActive = false;
let recordingPaused = false;
let stopRequested: "save" | "discard" | null = null;
let latestStatus: RecordingStatus = { state: "idle" };

// Offscreen document lifecycle management.
let offscreenCreatePromise: Promise<void> | null = null;
let offscreenRequestId = 0;
let recorderPort: chrome.runtime.Port | null = null;
let recorderPortWaiter: {
  resolve: (port: chrome.runtime.Port) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
} | null = null;
const pendingRecorderRequests = new Map<
  number,
  {
    resolve: (value: RecorderCommandResult) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

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
      if (status.error.includes("Click the Capann icon while viewing the tab") || status.error.includes("Open Capann on this tab")) {
        title = "Capann needs to be opened on this tab";
      } else if (status.error.includes("This page can't be recorded")) {
        title = "This page can't be recorded";
      } else {
        title = `Capann — ${status.error}`;
      }
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

function captureStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const error = chrome.runtime.lastError;
      if (error || !streamId)
        reject(
          new Error(error?.message ?? "Chrome could not capture this tab."),
        );
      else resolve(streamId);
    });
  });
}

// Check if the offscreen document exists using Chrome 116-compatible API.
async function offscreenDocumentExists(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL("offscreen.html")],
  });
  return contexts.length > 0;
}

// Ensure the offscreen document exists, serializing concurrent creation attempts.
async function ensureOffscreen(): Promise<void> {
  if (offscreenCreatePromise) {
    await offscreenCreatePromise;
    return;
  }
  if (await offscreenDocumentExists()) return;
  offscreenCreatePromise = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [
          chrome.offscreen.Reason.USER_MEDIA,
          chrome.offscreen.Reason.BLOBS,
        ],
        justification:
          "Capture the active tab and compose a local recording with optional camera and microphone inputs.",
      });
    } catch (error) {
      offscreenCreatePromise = null;
      throw error;
    }
  })();
  await offscreenCreatePromise;
}

type RecorderCommandResult = { ok?: boolean; requestId?: number; error?: string };

function handleRecorderPort(port: chrome.runtime.Port): void {
  if (port.name !== "capann-recorder") return;
  if (port.sender?.url !== chrome.runtime.getURL("offscreen.html")) return;

  recorderPort = port;
  if (recorderPortWaiter) {
    clearTimeout(recorderPortWaiter.timeout);
    recorderPortWaiter.resolve(port);
    recorderPortWaiter = null;
  }

  port.onMessage.addListener((message: RecorderCommandResult) => {
    if (typeof message.requestId !== "number") return;
    const pending = pendingRecorderRequests.get(message.requestId);
    if (!pending) return;
    pendingRecorderRequests.delete(message.requestId);
    clearTimeout(pending.timeout);
    pending.resolve(message);
  });

  port.onDisconnect.addListener(() => {
    if (recorderPort === port) recorderPort = null;
    for (const [requestId, pending] of pendingRecorderRequests) {
      pendingRecorderRequests.delete(requestId);
      clearTimeout(pending.timeout);
      pending.reject(new Error("RECORDER_NOT_RESPONDING"));
    }
  });
}

chrome.runtime.onConnect.addListener(handleRecorderPort);

async function waitForRecorderPort(): Promise<chrome.runtime.Port> {
  if (recorderPort) return recorderPort;
  if (recorderPortWaiter) {
    return new Promise((resolve, reject) => {
      const previous = recorderPortWaiter!;
      const originalResolve = previous.resolve;
      const originalReject = previous.reject;
      previous.resolve = (port) => {
        originalResolve(port);
        resolve(port);
      };
      previous.reject = (error) => {
        originalReject(error);
        reject(error);
      };
    });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      recorderPortWaiter = null;
      reject(new Error("RECORDER_NOT_RESPONDING"));
    }, 5000);
    recorderPortWaiter = { resolve, reject, timeout };
  });
}

async function sendRecorderRequest(
  message: BackgroundToRecorderMessage,
): Promise<RecorderCommandResult> {
  const port = await waitForRecorderPort();
  const result = await new Promise<RecorderCommandResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRecorderRequests.delete(message.requestId);
      reject(new Error("RECORDER_NOT_RESPONDING"));
    }, message.kind === "offscreen-start" ? 20_000 : 5_000);
    pendingRecorderRequests.set(message.requestId, { resolve, reject, timeout });
    try {
      port.postMessage(message);
    } catch {
      pendingRecorderRequests.delete(message.requestId);
      clearTimeout(timeout);
      reject(new Error("RECORDER_NOT_RESPONDING"));
    }
  });
  if (!result.ok) throw new Error(result.error ?? "RECORDER_START_FAILED:unknown");
  return result;
}

// A connected port proves that the offscreen script has loaded and is ready to
// receive commands. It replaces the missed one-time runtime-message signal.
async function verifyRecorderReady(): Promise<void> {
  const requestId = ++offscreenRequestId;
  await sendRecorderRequest({
    kind: "offscreen-ready-check",
    requestId,
    target: "offscreen",
  } as BackgroundToRecorderMessage);
}

async function sendRecorderCommand(
  command: "pause" | "resume" | "stop" | "discard",
): Promise<void> {
  if (!(await offscreenDocumentExists())) return;
  const requestId = ++offscreenRequestId;
  await sendRecorderRequest({
    kind: `offscreen-${command}`,
    requestId,
    target: "offscreen",
  } as BackgroundToRecorderMessage);
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
    recordingTabId = null;
    // Close the offscreen document only after the recording fully finalizes.
    void closeOffscreenIfIdle();
  }
}

async function closeOffscreenIfIdle(): Promise<void> {
  if (recordingActive) return;
  if (await offscreenDocumentExists()) {
    await chrome.offscreen.closeDocument();
    offscreenCreatePromise = null;
  }
}

// Convert internal error codes to user-facing messages.
function toUserError(internalError: string): string {
  if (internalError === "RECORDER_NOT_RESPONDING" || internalError === "RECORDER_COMMAND_TIMEOUT") {
    return "Recording couldn't begin — Capann's recorder is taking longer than expected. Reload the extension, then try again.";
  }
  if (internalError === "ACTION_PERMISSION_EXPIRED") {
    return "Click the Capann icon while viewing the tab you want to record, then start again.";
  }
  if (internalError === "TAB_CAPTURE_UNAVAILABLE") {
    return "We couldn't capture this tab — try again from the tab you want to record. If it continues, reload the page.";
  }
  if (internalError === "PROTECTED_PAGE") {
    return "This page can't be recorded — Chrome protects browser pages. Open a website or web app, then try again.";
  }
  if (internalError.startsWith("PERMISSION_DENIED:")) {
    const feature = internalError.split(":")[1];
    switch (feature) {
      case "camera":
        return "Camera unavailable — your recording will continue without the camera bubble.";
      case "microphone":
        return "Microphone unavailable — your recording will continue without microphone audio.";
      case "tabAudio":
        return "Tab audio unavailable — your recording will continue without audio from this tab.";
      default:
        return "Permission denied — please check your browser settings and try again.";
    }
  }
  if (internalError === "RECORDING_STOPPED_UNEXPECTEDLY") {
    return "Recording ended unexpectedly — your video wasn't saved. Start a new recording when you're ready.";
  }
  if (internalError === "FILE_SAVE_FAILED") {
    return "Recording is ready, but couldn't be saved — check your download permissions, then record again.";
  }
  if (internalError.startsWith("RECORDER_START_FAILED:")) {
    // Fallback for any other recorder startup failure
    return "Recording couldn't begin — try again. If it continues, reload the extension.";
  }
  // Unknown internal error — log it and show generic message
  console.error("[Capann] Unknown recorder error:", internalError);
  return "Recording couldn't begin — try again. If it continues, reload the extension.";
}

// Map raw browser error messages to internal error codes.
function classifyCaptureError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Action/tab permission expired — need to invoke Capann on this tab first
  if (/not been invoked|active tab permission/i.test(message)) {
    return "ACTION_PERMISSION_EXPIRED";
  }
  // Protected Chrome page (chrome://, extension:, etc.)
  if (/chrome:\/\//i.test(message) || /extension:/i.test(message) || /protected/i.test(lower)) {
    return "PROTECTED_PAGE";
  }
  // Generic tab capture failure
  if (/cannot access|cannot capture/i.test(message)) {
    return "TAB_CAPTURE_UNAVAILABLE";
  }
  return "TAB_CAPTURE_UNAVAILABLE";
}

async function startRecording(
  options: RecordOptions,
  tabId: number,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  if (recordingActive) {
    sendResponse({ ok: false, error: "A recording is already active." });
    return;
  }
  let streamId: string;
  try {
    // Capture the tab stream ID first — this can fail on protected pages.
    streamId = await captureStreamId(tabId);
  } catch (error) {
    const internalError = classifyCaptureError(error);
    const userError = toUserError(internalError);
    const status: RecordingStatus = {
      state: "error",
      error: userError,
    };
    latestStatus = status;
    updateActionBadge(status);
    void sendToTab(tabId, { kind: "recording-status", status }).catch(() => undefined);
    sendResponse({ ok: false, error: status.error });
    return;
  }

  recordingTabId = tabId;
  recordingActive = true;
  recordingPaused = false;
  stopRequested = null;
  latestStatus = { state: "starting" };
  updateActionBadge(latestStatus);

  try {
    // Create the document first, then ask its loaded listener to confirm it
    // can receive commands. The previous one-time ready event could fire
    // before this worker attached its listener.
    await ensureOffscreen();
    await verifyRecorderReady();

    const requestId = ++offscreenRequestId;
    await sendRecorderRequest({
      kind: "offscreen-start",
      streamId,
      tabId,
      requestId,
      target: "offscreen",
      ...options,
    });

    sendResponse({ ok: true });

    if (stopRequested) {
      const command = stopRequested;
      void sendRecorderCommand(command === "save" ? "stop" : "discard");
    }
  } catch (error) {
    const internalError = error instanceof Error ? error.message : "RECORDER_START_FAILED:unknown";
    const userError = toUserError(internalError);
    const status: RecordingStatus = {
      state: "error",
      error: userError,
    };
    if (recordingTabId === tabId) recordingTabId = null;
    recordingActive = false;
    stopRequested = null;
    latestStatus = status;
    updateActionBadge(status);
    void sendToTab(tabId, { kind: "recording-status", status }).catch(() => undefined);
    // Close offscreen document only if the startup failed and no recording is active.
    await closeOffscreenIfIdle();
    sendResponse({ ok: false, error: status.error });
  }
}

function handleActionInvocation(tab?: chrome.tabs.Tab): void {
  if (recordingActive) {
    stopRequested = "save";
    if (recordingTabId !== null) void sendRecorderCommand("stop");
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
    if (message.kind === "capture-visible-tab") {
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
      void startRecording(message, tabId, sendResponse);
      return true;
    }
    if (message.kind === "record-status") {
      notifyRecordingTab(message.status);
      return false;
    }
    if (message.kind === "offscreen-new-stream-id") {
      void captureStreamId(message.tabId)
        .then((streamId) => sendResponse({ streamId }))
        .catch((error: unknown) =>
          sendResponse({
            error:
              error instanceof Error
                ? error.message
                : "Could not recapture tab.",
          }),
        );
      return true;
    }
    if (message.kind === "offscreen-close") {
      void closeOffscreenIfIdle();
      return false;
    }
    return false;
  },
);

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
  if (
    recordingActive &&
    command === "clear-annotations" &&
    (latestStatus.state === "recording" || latestStatus.state === "paused")
  ) {
    stopRequested = "discard";
    void sendRecorderCommand("discard");
    return;
  }
  if (recordingActive && command === "clear-annotations") {
    stopRequested = "discard";
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
