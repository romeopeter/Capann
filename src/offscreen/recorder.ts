import type {
  RecordingStatus,
  BackgroundToRecorderMessage,
} from "../shared/types";

type StartMessage = {
  kind: "offscreen-start";
  streamId: string;
  tabId: number;
  requestId: number;
  camera: boolean;
  microphone: boolean;
  tabAudio: boolean;
};

const OFFSCREEN_TARGET = "offscreen" as const;

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let tabStream: MediaStream | null = null;
let cameraStream: MediaStream | null = null;
let microphoneStream: MediaStream | null = null;
let outputStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let animationFrame = 0;
let videoFrameCallback = 0;
let activeTabVideo: HTMLVideoElement | null = null;
let statusTimer = 0;
let startedAt = 0;
let accumulatedMs = 0;
let activeStart = 0;
let discardRequested = false;
let missingInputs: string[] = [];

function emit(status: RecordingStatus): void {
  void chrome.runtime
    .sendMessage({ kind: "record-status", status, target: OFFSCREEN_TARGET })
    .catch(() => undefined);
}

function currentStatus(paused = false): RecordingStatus {
  const flags = {
    camera: Boolean(cameraStream?.getVideoTracks().length),
    microphone: Boolean(microphoneStream?.getAudioTracks().length),
    tabAudio: Boolean(tabStream?.getAudioTracks().length),
    unavailable: missingInputs,
  };
  if (paused) return { state: "paused", elapsedMs: accumulatedMs, ...flags };
  return {
    state: "recording",
    startedAt: Date.now() - accumulatedMs,
    ...flags,
  };
}

function tabConstraints(
  streamId: string,
  audio: boolean,
): MediaStreamConstraints {
  const video = {
    mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
  } as MediaTrackConstraints;
  const audioConstraints = audio
    ? ({
        mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
      } as MediaTrackConstraints)
    : false;
  return { video, audio: audioConstraints };
}

async function getTabStream(message: StartMessage): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(
      tabConstraints(message.streamId, message.tabAudio),
    );
  } catch (error) {
    if (!message.tabAudio) throw error;
    // Audio capture can fail independently on some tabs. A fresh stream token is
    // required after Chrome consumes the first one, so retry with video only.
    const result = (await chrome.runtime.sendMessage({
      kind: "offscreen-new-stream-id",
      tabId: message.tabId,
    })) as { streamId?: string; error?: string };
    if (!result?.streamId)
      throw new Error(result?.error ?? "Tab audio could not be captured.");
    missingInputs.push("tab audio");
    return navigator.mediaDevices.getUserMedia(
      tabConstraints(result.streamId, false),
    );
  }
}

async function optionalMedia(
  constraints: MediaStreamConstraints,
  name: string,
): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    missingInputs.push(name);
    return null;
  }
}

async function start(message: StartMessage): Promise<void> {
  if (recorder && recorder.state !== "inactive")
    throw new Error("A recording is already active.");
  chunks = [];
  missingInputs = [];
  discardRequested = false;
  emit({ state: "starting" });

  // Tab video is mandatory. A failure exits before a MediaRecorder exists, so
  // unsupported pages never leave behind an empty download.
  try {
    tabStream = await getTabStream(message);
  } catch (error) {
    throw new Error(toInternalError(error));
  }
  if (!tabStream.getVideoTracks().length)
    throw new Error("RECORDER_START_FAILED:no-video");
  if (message.camera)
    cameraStream = await optionalMedia(
      { video: { aspectRatio: 16 / 9 }, audio: false },
      "camera",
    );
  if (message.microphone)
    microphoneStream = await optionalMedia(
      { audio: true, video: false },
      "microphone",
    );

  const videoTrack = tabStream.getVideoTracks()[0]!;
  const video = document.createElement("video");
  activeTabVideo = video;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([videoTrack]);
  try {
    await video.play();
    await new Promise<void>((resolve) => {
      if (video.videoWidth > 0) resolve();
      else
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
  } catch (error) {
    throw new Error(toInternalError(error));
  }

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("RECORDER_START_FAILED:compositor");
  const cameraVideo = document.createElement("video");
  if (cameraStream) {
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play().catch(() => undefined);
  }
  const draw = () => {
    ctx.drawImage(video, 0, 0, width, height);
    if (cameraStream && cameraVideo.videoWidth) {
      const bubbleWidth = Math.round(width * 0.24);
      const bubbleHeight = Math.round((bubbleWidth * 9) / 16);
      const margin = Math.round(width * 0.025);
      const x = width - bubbleWidth - margin;
      const y = height - bubbleHeight - margin;
      const radius = Math.round(bubbleHeight * 0.12);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, bubbleWidth, bubbleHeight, radius);
      ctx.clip();
      const sourceRatio = cameraVideo.videoWidth / cameraVideo.videoHeight;
      const boxRatio = 16 / 9;
      const cropWidth =
        sourceRatio > boxRatio
          ? cameraVideo.videoHeight * boxRatio
          : cameraVideo.videoWidth;
      const cropHeight =
        sourceRatio > boxRatio
          ? cameraVideo.videoHeight
          : cameraVideo.videoWidth / boxRatio;
      ctx.drawImage(
        cameraVideo,
        (cameraVideo.videoWidth - cropWidth) / 2,
        (cameraVideo.videoHeight - cropHeight) / 2,
        cropWidth,
        cropHeight,
        x,
        y,
        bubbleWidth,
        bubbleHeight,
      );
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.92)";
      ctx.lineWidth = Math.max(2, width * 0.002);
      ctx.beginPath();
      ctx.roundRect(x, y, bubbleWidth, bubbleHeight, radius);
      ctx.stroke();
      ctx.restore();
    }
    if (typeof video.requestVideoFrameCallback === "function")
      videoFrameCallback = video.requestVideoFrameCallback(draw);
    else animationFrame = requestAnimationFrame(draw);
  };
  draw();

  const mixedTracks: MediaStreamTrack[] = [
    ...canvas.captureStream(30).getVideoTracks(),
  ];
  const tabAudioTrack = tabStream.getAudioTracks()[0];
  if (tabAudioTrack || microphoneStream?.getAudioTracks().length) {
    try {
      audioContext = new AudioContext();
    } catch (error) {
      throw new Error(toInternalError(error));
    }
    const destination = audioContext.createMediaStreamDestination();
    if (tabAudioTrack) {
      const source = audioContext.createMediaStreamSource(
        new MediaStream([tabAudioTrack]),
      );
      source.connect(destination);
      // tabCapture disconnects the tab's normal output; route it back so it
      // remains audible to the person recording.
      source.connect(audioContext.destination);
    }
    const micTrack = microphoneStream?.getAudioTracks()[0];
    if (micTrack)
      audioContext
        .createMediaStreamSource(new MediaStream([micTrack]))
        .connect(destination);
    mixedTracks.push(...destination.stream.getAudioTracks());
    try {
      await audioContext.resume();
    } catch (error) {
      throw new Error(toInternalError(error));
    }
  }
  outputStream = new MediaStream(mixedTracks);
  const mimeType = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  try {
    recorder = new MediaRecorder(
      outputStream,
      mimeType ? { mimeType } : undefined,
    );
  } catch (error) {
    throw new Error(toInternalError(error));
  }
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    void finalize(discardRequested);
  };
  recorder.onerror = () => {
    emit({
      state: "error",
      error: "RECORDING_STOPPED_UNEXPECTEDLY",
    });
    void cleanup();
  };
  startedAt = Date.now();
  activeStart = performance.now();
  accumulatedMs = 0;
  try {
    recorder.start(1000);
  } catch (error) {
    throw new Error(toInternalError(error));
  }
  emit(currentStatus());
  statusTimer = window.setInterval(() => emit(currentStatus()), 1000);
}

// Internal error codes for the service worker to translate to user-facing messages.
function toInternalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Errors are converted at the boundary that first understands them. Keep a
  // known code intact when it crosses another async boundary.
  if (/^(PERMISSION_DENIED:|RECORDER_START_FAILED:|RECORDING_STOPPED_UNEXPECTEDLY|FILE_SAVE_FAILED)/.test(message)) {
    return message;
  }

  // getUserMedia failures for specific inputs
  if (lower.includes("permission denied") || lower.includes("notallowed")) {
    if (lower.includes("video") || lower.includes("camera")) {
      return "PERMISSION_DENIED:camera";
    }
    if (lower.includes("audio") || lower.includes("microphone")) {
      return "PERMISSION_DENIED:microphone";
    }
    return "PERMISSION_DENIED:unknown";
  }
  if (lower.includes("not found") || lower.includes("notfound") || lower.includes("no.*device")) {
    if (lower.includes("video") || lower.includes("camera")) {
      return "PERMISSION_DENIED:camera";
    }
    if (lower.includes("audio") || lower.includes("microphone")) {
      return "PERMISSION_DENIED:microphone";
    }
    return "PERMISSION_DENIED:unknown";
  }
  // Tab audio capture failure
  if (lower.includes("tab audio could not be captured") || (lower.includes("audio") && lower.includes("tab"))) {
    return "PERMISSION_DENIED:tabAudio";
  }
  // Compositor/canvas failures
  if (lower.includes("compositor") || lower.includes("canvas") || lower.includes("context")) {
    return "RECORDER_START_FAILED:compositor";
  }
  // AudioContext failures
  if (lower.includes("audiocontext") || lower.includes("audio context")) {
    return "RECORDER_START_FAILED:audio-context";
  }
  // MediaRecorder failures
  if (lower.includes("mediarecorder") || lower.includes("media recorder") || lower.includes("mime") || lower.includes("codec")) {
    return "RECORDER_START_FAILED:mediarecorder";
  }
  // Video playback/stream failures
  if (lower.includes("video") && (lower.includes("play") || lower.includes("load") || lower.includes("stream"))) {
    return "RECORDER_START_FAILED:video-stream";
  }
  // Generic recorder startup failures
  if (lower.includes("recording is already active")) {
    return "RECORDER_START_FAILED:already-active";
  }
  if (lower.includes("no video for this tab") || lower.includes("chrome returned no video")) {
    return "RECORDER_START_FAILED:no-video";
  }
  return "RECORDER_START_FAILED:unknown";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function cleanup(): Promise<void> {
  clearInterval(statusTimer);
  cancelAnimationFrame(animationFrame);
  if (
    activeTabVideo &&
    videoFrameCallback &&
    typeof activeTabVideo.cancelVideoFrameCallback === "function"
  )
    activeTabVideo.cancelVideoFrameCallback(videoFrameCallback);
  activeTabVideo = null;
  videoFrameCallback = 0;
  for (const stream of [
    tabStream,
    cameraStream,
    microphoneStream,
    outputStream,
  ])
    stream?.getTracks().forEach((track) => track.stop());
  tabStream = cameraStream = microphoneStream = outputStream = null;
  if (audioContext) await audioContext.close().catch(() => undefined);
  audioContext = null;
  recorder = null;
}

async function finalize(discard: boolean): Promise<void> {
  const blob = new Blob(chunks, { type: recorder?.mimeType || "video/webm" });
  chunks = [];
  const wasValid = blob.size > 0;
  await cleanup();
  if (discard || !wasValid) {
    emit(
      discard
        ? { state: "discarded" }
        : { state: "error", error: "RECORDER_START_FAILED:no-video-data" },
    );
  } else {
    const filename = `capann-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: false }, () => {
      const error = chrome.runtime.lastError;
      if (error)
        emit({
          state: "error",
          error: "FILE_SAVE_FAILED",
        });
      else emit({ state: "saved", filename });
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      void chrome.runtime.sendMessage({ kind: "offscreen-close", target: OFFSCREEN_TARGET });
    });
  }
  if (discard) void chrome.runtime.sendMessage({ kind: "offscreen-close", target: OFFSCREEN_TARGET });
}

function respond(
  port: chrome.runtime.Port,
  requestId: number,
  response: { ok: boolean; error?: string },
): void {
  port.postMessage({ ...response, requestId });
}

function handleRecorderCommand(
  message: BackgroundToRecorderMessage,
  port: chrome.runtime.Port,
): void {
  if (message.target !== OFFSCREEN_TARGET) return;
  const { requestId } = message;

  if (message.kind === "offscreen-ready-check") {
    respond(port, requestId, { ok: true });
    return;
  }
  if (message.kind === "offscreen-start") {
    void start(message as StartMessage)
      .then(() => respond(port, requestId, { ok: true }))
      .catch(async (error: unknown) => {
        await cleanup();
        const internalError = toInternalError(error);
        emit({ state: "error", error: internalError });
        respond(port, requestId, { ok: false, error: internalError });
        void chrome.runtime.sendMessage({
          kind: "offscreen-close",
          target: OFFSCREEN_TARGET,
        });
      });
    return;
  }
  if (message.kind === "offscreen-pause") {
    if (recorder?.state === "recording") {
      accumulatedMs += performance.now() - activeStart;
      recorder.pause();
      clearInterval(statusTimer);
      emit(currentStatus(true));
    }
    respond(port, requestId, { ok: true });
    return;
  }
  if (message.kind === "offscreen-resume") {
    if (recorder?.state === "paused") {
      activeStart = performance.now();
      recorder.resume();
      statusTimer = window.setInterval(() => emit(currentStatus()), 1000);
      emit(currentStatus());
    }
    respond(port, requestId, { ok: true });
    return;
  }
  if (message.kind === "offscreen-stop") {
    if (recorder && recorder.state !== "inactive") {
      if (recorder.state === "recording")
        accumulatedMs += performance.now() - activeStart;
      recorder.stop();
    }
    respond(port, requestId, { ok: true });
    return;
  }
  if (message.kind === "offscreen-discard") {
    discardRequested = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else void finalize(true);
    respond(port, requestId, { ok: true });
  }
}

// The port opens from the offscreen document, which wakes the MV3 service
// worker and proves this script is loaded before it accepts recorder commands.
// Reconnect if Chrome suspends and restarts the service worker while this
// document is still active.
function connectRecorderPort(): void {
  const recorderPort = chrome.runtime.connect({ name: "capann-recorder" });
  recorderPort.onMessage.addListener((message: BackgroundToRecorderMessage) => {
    handleRecorderCommand(message, recorderPort);
  });
  recorderPort.onDisconnect.addListener(() => {
    window.setTimeout(connectRecorderPort, 250);
  });
}

connectRecorderPort();
