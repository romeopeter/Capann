import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  RecordOptions,
  RecorderToBackgroundMessage,
  RecordingStatus,
} from "../shared/types";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
});

let recordingTabId: number | null = null;
let recordingActive = false;
let recordingPaused = false;
let stopRequested: "save" | "discard" | null = null;
let latestStatus: RecordingStatus = { state: "idle" };

function updateActionBadge(status: RecordingStatus): void {
  if (status.state === "starting") {
    void chrome.action.setBadgeText({ text: "REC" });
    void chrome.action.setBadgeBackgroundColor({ color: "#DC2626" });
    void chrome.action.setTitle({ title: "Capann is preparing a recording" });
  } else if (status.state === "recording") {
    void chrome.action.setBadgeText({ text: "REC" });
    void chrome.action.setBadgeBackgroundColor({ color: "#DC2626" });
    const elapsed = Math.max(0, Math.floor((Date.now() - status.startedAt) / 1000));
    const time = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
    void chrome.action.setTitle({ title: `Capann recording ${time} — click to stop and save` });
  } else if (status.state === "paused") {
    void chrome.action.setBadgeText({ text: "PAUS" });
    void chrome.action.setBadgeBackgroundColor({ color: "#A78BFA" });
    const elapsed = Math.floor(status.elapsedMs / 1000);
    const time = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
    void chrome.action.setTitle({ title: `Capann recording paused at ${time} — click to save` });
  } else {
    void chrome.action.setBadgeText({ text: "" });
    const title = status.state === "error" ? `Capann — ${status.error}` : status.state === "saved" ? `Capann — Saved ${status.filename}` : "Open Capann on this page";
    void chrome.action.setTitle({ title });
  }
}

function sendToTab(tabId: number, message: BackgroundToContentMessage): Promise<void> {
  return chrome.tabs.sendMessage(tabId, message).then(() => undefined);
}

function captureStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const error = chrome.runtime.lastError;
      if (error || !streamId) reject(new Error(error?.message ?? "Chrome could not capture this tab."));
      else resolve(streamId);
    });
  });
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.BLOBS],
    justification: "Capture the active tab and compose a local recording with optional camera and microphone inputs.",
  });
}

async function sendRecorderCommand(command: "pause" | "resume" | "stop" | "discard"): Promise<void> {
  if (!(await chrome.offscreen.hasDocument())) return;
  await chrome.runtime.sendMessage({ kind: `offscreen-${command}` });
}

function notifyRecordingTab(status: RecordingStatus): void {
  latestStatus = status;
  recordingPaused = status.state === "paused";
  updateActionBadge(status);
  if (recordingTabId === null) return;
  const tabId = recordingTabId;
  void sendToTab(tabId, { kind: "recording-status", status }).catch(() => undefined);
  if (status.state === "saved" || status.state === "discarded" || status.state === "error") {
    recordingActive = false;
    recordingPaused = false;
    stopRequested = null;
    recordingTabId = null;
  }
}

async function startRecording(options: RecordOptions, tabId: number, sendResponse: (response: unknown) => void): Promise<void> {
  if (recordingActive) {
    sendResponse({ ok: false, error: "A recording is already active." });
    return;
  }
  try {
    // Run directly from a command sent by the content UI opened by the action.
    const streamId = await captureStreamId(tabId);
    recordingTabId = tabId;
    recordingActive = true;
    recordingPaused = false;
    stopRequested = null;
    latestStatus = { state: "starting" };
    updateActionBadge(latestStatus);
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({ kind: "offscreen-start", streamId, tabId, ...options }) as { ok?: boolean; error?: string };
    if (!response?.ok) throw new Error(response?.error ?? "The recorder could not start.");
    sendResponse({ ok: true });
    if (stopRequested) {
      const command = stopRequested;
      void sendRecorderCommand(command === "save" ? "stop" : "discard");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Chrome could not capture this tab.";
    const requiresInvocation = /not been invoked|activeTab|cannot access|cannot capture/i.test(detail);
    const status: RecordingStatus = {
      state: "error",
      error: requiresInvocation
        ? "Click the Capann toolbar icon on this tab, then start recording again. Chrome pages cannot be captured."
        : detail,
    };
    if (recordingTabId === tabId) recordingTabId = null;
    recordingActive = false;
    stopRequested = null;
    latestStatus = status;
    updateActionBadge(status);
    void sendToTab(tabId, { kind: "recording-status", status }).catch(() => undefined);
    if (await chrome.offscreen.hasDocument()) void chrome.offscreen.closeDocument();
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
  void sendToTab(tab.id, { kind: "toggle-capann-ui" }).then(() => {
    void chrome.action.setBadgeText({ text: "" });
    void chrome.action.setBadgeText({ text: "", tabId: tab.id });
    void chrome.action.setTitle({ title: "Open Capann on this page" });
    void chrome.action.setTitle({ tabId: tab.id, title: "Open Capann on this page" });
  }).catch(() => {
    void chrome.action.setBadgeText({ text: "!", tabId: tab.id });
    void chrome.action.setBadgeBackgroundColor({ color: "#DC2626", tabId: tab.id });
    void chrome.action.setTitle({
      tabId: tab.id,
      title: "Capann is unavailable on Chrome pages. Open a regular website to annotate or record.",
    });
  });
}

chrome.action.onClicked.addListener(handleActionInvocation);

chrome.runtime.onMessage.addListener(
  (message: ContentToBackgroundMessage | RecorderToBackgroundMessage, sender, sendResponse) => {
    if (message.kind === "get-tab-id") {
      const tabId = sender.tab?.id ?? -1;
      sendResponse({
        tabId,
        recordingStatus: sender.tab?.id === recordingTabId ? latestStatus : { state: "idle" },
      });
      return false;
    }
    if (message.kind === "get-recording-status") {
      sendResponse(sender.tab?.id === recordingTabId ? latestStatus : { state: "idle" });
      return false;
    }
    if (message.kind === "capture-visible-tab") {
      const callback = (dataUrl: string) => {
        if (chrome.runtime.lastError || !dataUrl) {
          sendResponse({ kind: "capture-visible-tab-error", error: chrome.runtime.lastError?.message ?? "Capture failed" });
        } else {
          sendResponse({ kind: "capture-visible-tab-result", dataUrl });
        }
      };
      if (sender.tab?.windowId !== undefined) chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, callback);
      else chrome.tabs.captureVisibleTab({ format: "png" }, callback);
      return true;
    }
    if (message.kind === "download-png") {
      chrome.downloads.download({ url: message.dataUrl, filename: message.filename, saveAs: false });
      return false;
    }
    if (message.kind === "record-start") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        sendResponse({ ok: false, error: "Start recording from the Capann overlay on the tab you want to capture." });
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
        .catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : "Could not recapture tab." }));
      return true;
    }
    if (message.kind === "offscreen-close") {
      void chrome.offscreen.closeDocument();
      return false;
    }
    return false;
  },
);

chrome.commands.onCommand.addListener((command) => {
  if (recordingActive && command === "cycle-tool" && (latestStatus.state === "recording" || latestStatus.state === "paused")) {
    recordingPaused = !recordingPaused;
    void sendRecorderCommand(recordingPaused ? "pause" : "resume");
    return;
  }
  if (recordingActive && command === "clear-annotations" && (latestStatus.state === "recording" || latestStatus.state === "paused")) {
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
      if (tabs[0]?.id !== undefined) void chrome.tabs.sendMessage(tabs[0].id, { kind: "clear-annotations" }).catch(() => undefined);
    });
  } else if (command === "cycle-tool") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id !== undefined) void chrome.tabs.sendMessage(tabs[0].id, { kind: "cycle-tool" }).catch(() => undefined);
    });
  }
});
