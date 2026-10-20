import type {
  RecordingErrorCode,
  RecordingStage,
  RecordingStatus,
  BackgroundToRecorderMessage,
} from "../shared/types";

const OFFSCREEN_TARGET = "offscreen" as const;

type StartMessage = {
  kind: "offscreen-start";
  sessionId: string;
  streamId: string;
  tabId: number;
  camera: boolean;
  microphone: boolean;
  tabAudio: boolean;
};

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let tabStream: MediaStream | null = null;
let cameraStream: MediaStream | null = null;
let microphoneStream: MediaStream | null = null;
let outputStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let frameTimer = 0;
let activeTabVideo: HTMLVideoElement | null = null;
let statusTimer = 0;
let startedAt = 0;
let accumulatedMs = 0;
let activeStart = 0;
let discardRequested = false;
let missingInputs: string[] = [];
let currentSessionId: string | null = null;

// Signal readiness immediately when the offscreen document loads.
void chrome.runtime
  .sendMessage({
    kind: "offscreen-ready",
    target: OFFSCREEN_TARGET,
  })
  .catch(() => undefined);

class RecorderStartupError extends Error {
  constructor(
    readonly code: RecordingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RecorderStartupError";
  }
}

// Offscreen documents never show permission prompts, so Chrome leaves
// getUserMedia() pending forever when camera or microphone access has not been
// granted. Every startup step is bounded so the worker always gets an answer.
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function queryPermission(
  name: "camera" | "microphone",
): Promise<PermissionState> {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    // No Permissions API entry: let getUserMedia decide (with a timeout).
    return "granted";
  }
}

function emit(status: RecordingStatus): void {
  void chrome.runtime
    .sendMessage({ kind: "record-status", status, target: OFFSCREEN_TARGET })
    .catch(() => undefined);
}

function emitProgress(sessionId: string, stage: RecordingStage): void {
  void chrome.runtime
    .sendMessage(
      { kind: "offscreen-progress", sessionId, stage, target: OFFSCREEN_TARGET },
    )
    .catch(() => undefined);
}

function currentStatus(paused = false): RecordingStatus {
  const flags = {
    camera: Boolean(cameraStream?.getVideoTracks().length),
    microphone: Boolean(microphoneStream?.getAudioTracks().length),
    tabAudio: Boolean(tabStream?.getAudioTracks().length),
    unavailable: missingInputs,
    sessionId: currentSessionId!,
  };
  if (paused) return { state: "paused", elapsedMs: accumulatedMs, ...flags };
  return {
    state: "recording",
    startedAt: Date.now() - accumulatedMs,
    ...flags,
  };
}

// Chrome's tab-capture stream ID is issued by the service worker and redeemed
// here with the legacy `chromeMediaSource: "tab"` constraints.
function tabConstraints(
  streamId: string,
  audio: boolean,
): MediaStreamConstraints {
  const video = {
    mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
  } as MediaTrackConstraints;

  if (!audio) return { video, audio: false };

  const audioConstraints = {
    mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
  } as MediaTrackConstraints;
  return { video, audio: audioConstraints };
}

async function getTabStream(message: StartMessage): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(
      tabConstraints(message.streamId, message.tabAudio),
    );
  } catch (error) {
    if (!message.tabAudio) {
      throw new RecorderStartupError(
        "TAB_STREAM_ACQUISITION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
    // The tab may expose no audio at all. Most failures here are video
    // failures, so retrying cannot hurt; a consumed ID just fails again.
    missingInputs.push("tab audio");
    try {
      return await navigator.mediaDevices.getUserMedia(
        tabConstraints(message.streamId, false),
      );
    } catch {
      throw new RecorderStartupError(
        "TAB_STREAM_ACQUISITION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

async function optionalMedia(
  constraints: MediaStreamConstraints,
  name: "camera" | "microphone",
): Promise<MediaStream | null> {
  // Skip rather than wait: an ungrants prompt can never be answered from an
  // offscreen document, so getUserMedia() would hang the whole startup.
  if ((await queryPermission(name)) !== "granted") {
    missingInputs.push(name);
    return null;
  }
  try {
    return await withTimeout(
      navigator.mediaDevices.getUserMedia(constraints),
      6_000,
      `The ${name} did not start in time.`,
    );
  } catch {
    missingInputs.push(name);
    return null;
  }
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(
        new RecorderStartupError(
          "RECORDER_STARTUP_FAILED",
          "The selected tab did not provide video metadata in time.",
        ),
      );
    }, 8_000);
    const done = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    const failed = () => {
      window.clearTimeout(timeout);
      reject(
        new RecorderStartupError(
          "RECORDER_STARTUP_FAILED",
          "The selected tab video could not be played.",
        ),
      );
    };
    video.addEventListener("loadedmetadata", done, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

async function start(message: StartMessage): Promise<void> {
  currentSessionId = message.sessionId;
  if (recorder && recorder.state !== "inactive")
    throw new Error("A recording is already active.");
  chunks = [];
  missingInputs = [];
  discardRequested = false;

  emitProgress(message.sessionId, "acquiring-tab-stream");

  // Tab video is mandatory.
  try {
    tabStream = await withTimeout(
      getTabStream(message),
      8_000,
      "The tab stream did not start in time.",
    );
  } catch (error) {
    if (error instanceof RecorderStartupError) throw error;
    throw new RecorderStartupError(
      "TAB_STREAM_ACQUISITION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!tabStream.getVideoTracks().length)
    throw new RecorderStartupError(
      "NO_VIDEO_TRACK",
      "The selected source did not include a video track.",
    );
  // Camera and microphone are optional and independent: start them together
  // so one unavailable device cannot delay the other.
  [cameraStream, microphoneStream] = await Promise.all([
    message.camera
      ? optionalMedia(
          { video: { aspectRatio: 16 / 9 }, audio: false },
          "camera",
        )
      : Promise.resolve(null),
    message.microphone
      ? optionalMedia({ audio: true, video: false }, "microphone")
      : Promise.resolve(null),
  ]);

  emitProgress(message.sessionId, "preparing-video");

  const videoTrack = tabStream.getVideoTracks()[0]!;
  const video = document.createElement("video");
  activeTabVideo = video;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([videoTrack]);
  try {
    await withTimeout(video.play(), 6_000, "The tab video did not start in time.");
    await waitForVideoMetadata(video);
  } catch (error) {
    if (error instanceof RecorderStartupError) throw error;
    throw new RecorderStartupError(
      "RECORDER_STARTUP_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new RecorderStartupError(
      "RECORDER_STARTUP_FAILED",
      "The video compositor could not be created.",
    );
  const cameraVideo = document.createElement("video");
  if (cameraStream) {
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    cameraVideo.srcObject = cameraStream;
    // The bubble is optional; never let its playback hold up startup.
    await withTimeout(
      cameraVideo.play(),
      3_000,
      "The camera video did not start in time.",
    ).catch(() => undefined);
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
  };
  draw();
  // Offscreen documents are never rendered, so requestAnimationFrame does not
  // run and requestVideoFrameCallback is unreliable. A timer keeps frames
  // flowing; without it MediaRecorder never receives a frame and never starts.
  frameTimer = window.setInterval(draw, 33);

  const mixedTracks: MediaStreamTrack[] = [
    ...canvas.captureStream(30).getVideoTracks(),
  ];
  const tabAudioTrack = tabStream.getAudioTracks()[0];
  if (tabAudioTrack || microphoneStream?.getAudioTracks().length) {
    try {
      audioContext = new AudioContext();
    } catch (error) {
      throw new RecorderStartupError(
        "RECORDER_STARTUP_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
    const destination = audioContext.createMediaStreamDestination();
    if (tabAudioTrack) {
      const source = audioContext.createMediaStreamSource(
        new MediaStream([tabAudioTrack]),
      );
      source.connect(destination);
      source.connect(audioContext.destination);
    }
    const micTrack = microphoneStream?.getAudioTracks()[0];
    if (micTrack)
      audioContext
        .createMediaStreamSource(new MediaStream([micTrack]))
        .connect(destination);
    mixedTracks.push(...destination.stream.getAudioTracks());
    try {
      await withTimeout(
        audioContext.resume(),
        3_000,
        "The audio mixer did not start in time.",
      );
    } catch (error) {
      throw new RecorderStartupError(
        "RECORDER_STARTUP_FAILED",
        error instanceof Error ? error.message : String(error),
      );
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
    throw new RecorderStartupError(
      "RECORDER_STARTUP_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    void finalize(discardRequested);
  };
  startedAt = Date.now();
  activeStart = performance.now();
  accumulatedMs = 0;

  emitProgress(message.sessionId, "starting-recorder");

  // Confirm startup only after MediaRecorder.onstart fires. Assign handlers
  // before start(), so a fast browser cannot win the race.
  await new Promise<void>((resolve, reject) => {
    const activeRecorder = recorder;
    if (!activeRecorder) {
      reject(new RecorderStartupError("RECORDER_STARTUP_FAILED", "MediaRecorder was unavailable."));
      return;
    }
    const timeout = window.setTimeout(() => {
      reject(
        new RecorderStartupError(
          "RECORDER_STARTUP_FAILED",
          "MediaRecorder did not start in time.",
        ),
      );
    }, 5_000);
    activeRecorder.onstart = () => {
      window.clearTimeout(timeout);
      activeRecorder.onerror = () => {
        const sessionId = currentSessionId;
        if (!sessionId) return;
        const status: RecordingStatus = {
          state: "error",
          error: "Recording ended unexpectedly — your video wasn't saved. Start a new recording when you're ready.",
          code: "RECORDING_STOPPED_UNEXPECTEDLY",
          sessionId,
        };
        emit(status);
        void chrome.runtime.sendMessage({
          kind: "recorder-final-status",
          status,
          target: OFFSCREEN_TARGET,
        });
        void cleanup();
      };
      resolve();
    };
    activeRecorder.onerror = () => {
      window.clearTimeout(timeout);
      reject(
        new RecorderStartupError(
          "RECORDER_STARTUP_FAILED",
          "MediaRecorder reported an error while starting.",
        ),
      );
    };
    try {
      activeRecorder.start(1000);
    } catch (error) {
      window.clearTimeout(timeout);
      reject(
        new RecorderStartupError(
          "RECORDER_STARTUP_FAILED",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  });

  emit(currentStatus());
  statusTimer = window.setInterval(() => emit(currentStatus()), 1000);
}

async function cleanup(): Promise<void> {
  clearInterval(statusTimer);
  clearInterval(frameTimer);
  frameTimer = 0;
  if (activeTabVideo) activeTabVideo.srcObject = null;
  activeTabVideo = null;
  const activeRecorder = recorder;
  if (activeRecorder && activeRecorder.state !== "inactive") {
    activeRecorder.onstop = null;
    activeRecorder.onerror = null;
    try {
      activeRecorder.stop();
    } catch {
      // The recorder may already be stopping because a source ended.
    }
  }
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
  const sessionId = currentSessionId;
  const mimeType = recorder?.mimeType || "video/webm";
  const blob = new Blob(chunks, { type: mimeType });
  chunks = [];
  const wasValid = blob.size > 0;
  await cleanup();
  if (!sessionId) return;
  if (discard || !wasValid) {
    const status = discard
      ? { state: "discarded" as const, sessionId }
      : {
          state: "error" as const,
          error: "Capann could see the tab but couldn't start the recording. Try again.",
          code: "RECORDER_STARTUP_FAILED" as RecordingErrorCode,
          sessionId,
        };
    emit(status);
    void chrome.runtime.sendMessage({
      kind: "recorder-final-status",
      status,
      target: OFFSCREEN_TARGET,
    });
  } else {
    const filename = `capann-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    const blobUrl = URL.createObjectURL(blob);
    void chrome.runtime.sendMessage({
      kind: "recorder-download-request",
      blobUrl,
      filename,
      mimeType,
      sessionId,
      target: OFFSCREEN_TARGET,
    });
  }
}

type RecorderResponse = {
  ok: boolean;
  errorCode?: RecordingErrorCode;
  camera?: PermissionState;
  microphone?: PermissionState;
};

function respond(
  sendResponse: (response: RecorderResponse) => void,
  ok: boolean,
  errorCode?: RecordingErrorCode,
): void {
  sendResponse({ ok, errorCode });
}

function handleRecorderCommand(
  message: BackgroundToRecorderMessage,
  sendResponse: (response: RecorderResponse) => void,
): void {
  if (message.target !== OFFSCREEN_TARGET) return;

  if (message.kind === "offscreen-ping") {
    respond(sendResponse, true);
    return;
  }

  if (message.kind === "offscreen-permission-state") {
    void Promise.all([
      queryPermission("camera"),
      queryPermission("microphone"),
    ]).then(([camera, microphone]) =>
      sendResponse({ ok: true, camera, microphone }),
    );
    return;
  }

  const { sessionId } = message;

  if (message.kind === "offscreen-start") {
    void start(message as StartMessage)
      .then(() => respond(sendResponse, true))
      .catch(async (error: unknown) => {
        await cleanup();
        currentSessionId = null;
        const code =
          error instanceof RecorderStartupError
            ? error.code
            : "RECORDER_STARTUP_FAILED";
        console.error(
          `[Capann] session=${sessionId} stage=starting-recorder code=${code}`,
          error,
        );
        respond(sendResponse, false, code);
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
    respond(sendResponse, true);
    return;
  }
  if (message.kind === "offscreen-resume") {
    if (recorder?.state === "paused") {
      activeStart = performance.now();
      recorder.resume();
      statusTimer = window.setInterval(() => emit(currentStatus()), 1000);
      emit(currentStatus());
    }
    respond(sendResponse, true);
    return;
  }
  if (message.kind === "offscreen-stop") {
    if (recorder && recorder.state !== "inactive") {
      if (recorder.state === "recording")
        accumulatedMs += performance.now() - activeStart;
      recorder.stop();
    }
    respond(sendResponse, true);
    return;
  }
  if (message.kind === "offscreen-discard") {
    discardRequested = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else void finalize(true);
    respond(sendResponse, true);
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundToRecorderMessage,
    _sender,
    sendResponse: (response: RecorderResponse) => void,
  ) => {
    if (message.target === OFFSCREEN_TARGET) {
      handleRecorderCommand(message, sendResponse);
      return true; // async response
    }
    return false;
  },
);
