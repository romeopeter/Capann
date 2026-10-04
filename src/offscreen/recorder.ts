import type { RecordingStatus } from "../shared/types";

type StartMessage = {
  kind: "offscreen-start";
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
    .sendMessage({ kind: "record-status", status })
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
  tabStream = await getTabStream(message);
  if (!tabStream.getVideoTracks().length)
    throw new Error("Chrome returned no video for this tab.");
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
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0) resolve();
    else
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create the recording compositor.");
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
    audioContext = new AudioContext();
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
    await audioContext.resume();
  }
  outputStream = new MediaStream(mixedTracks);
  const mimeType = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  recorder = new MediaRecorder(
    outputStream,
    mimeType ? { mimeType } : undefined,
  );
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    void finalize(discardRequested);
  };
  recorder.onerror = () => {
    emit({
      state: "error",
      error: "The browser recording stopped unexpectedly.",
    });
    void cleanup();
  };
  startedAt = Date.now();
  activeStart = performance.now();
  accumulatedMs = 0;
  recorder.start(1000);
  emit(currentStatus());
  statusTimer = window.setInterval(() => emit(currentStatus()), 1000);
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
        : { state: "error", error: "The recording contained no video data." },
    );
  } else {
    const filename = `capann-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: false }, () => {
      const error = chrome.runtime.lastError;
      if (error)
        emit({
          state: "error",
          error: error.message ?? "Could not save recording.",
        });
      else emit({ state: "saved", filename });
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      void chrome.runtime.sendMessage({ kind: "offscreen-close" });
    });
  }
  if (discard) void chrome.runtime.sendMessage({ kind: "offscreen-close" });
}

chrome.runtime.onMessage.addListener(
  (
    message: { kind?: string } & Partial<StartMessage>,
    _sender,
    sendResponse,
  ) => {
    if (message.kind === "offscreen-start") {
      void start(message as StartMessage)
        .then(() => {
          sendResponse({ ok: true });
        })
        .catch(async (error: unknown) => {
          await cleanup();
          const detail =
            error instanceof Error
              ? error.message
              : "Could not start recording.";
          emit({ state: "error", error: detail });
          sendResponse({ ok: false, error: detail });
          void chrome.runtime.sendMessage({ kind: "offscreen-close" });
        });
      return true;
    } else if (
      message.kind === "offscreen-pause" &&
      recorder?.state === "recording"
    ) {
      accumulatedMs += performance.now() - activeStart;
      recorder.pause();
      clearInterval(statusTimer);
      emit(currentStatus(true));
    } else if (
      message.kind === "offscreen-resume" &&
      recorder?.state === "paused"
    ) {
      activeStart = performance.now();
      recorder.resume();
      statusTimer = window.setInterval(() => emit(currentStatus()), 1000);
      emit(currentStatus());
    } else if (message.kind === "offscreen-stop") {
      if (recorder && recorder.state !== "inactive") {
        if (recorder.state === "recording")
          accumulatedMs += performance.now() - activeStart;
        recorder.stop();
      }
    } else if (message.kind === "offscreen-discard") {
      discardRequested = true;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else void finalize(true);
    }
    return false;
  },
);
