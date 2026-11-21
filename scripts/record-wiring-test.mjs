// Regression test for the record-start -> offscreen-start command.
//
// Run `npm run build` first, then: node scripts/record-wiring-test.mjs
//
// Loads the built bundles with a stubbed chrome runtime. The bug this guards
// against: startRecording received the whole { kind: "record-start", ... }
// envelope, and a spread of it overwrote the offscreen command's kind with
// "record-start", so the recorder ignored the command and the worker reported
// OFFSCREEN_SETUP_FAILED after a 5 second timeout.
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const swPath = process.env.SW_PATH ?? path.join(root, "dist/background/service-worker.js");
const recorderPath = process.env.RECORDER_PATH ?? path.join(root, "dist/offscreen/recorder.js");

let swCode;
let recorderCode;
try {
  swCode = readFileSync(swPath, "utf8");
  recorderCode = readFileSync(recorderPath, "utf8");
} catch {
  console.error("Build output missing. Run `npm run build` first.");
  process.exit(1);
}
// The premium manifest declares the side panel; the free one is manifest.json.
const edition = JSON.parse(readFileSync(path.join(root, "dist/manifest.json"), "utf8")).side_panel
  ? "premium"
  : "free";
console.log(`Testing the ${edition} build`);

function assert(cond, message) {
  if (!cond) throw new Error(`FAIL: ${message}`);
  console.log(`  ok - ${message}`);
}

// Service worker: simulate a start and inspect the command on the wire.
async function testWorker() {
  console.log("\nWorker -> recorder command");
  let onMessage = null;
  let contextsOpen = false;
  let offscreenCommand = null;
  // What the offscreen document answers to offscreen-ping (a Premium share
  // job keeps it busy after the recording ended).
  let offscreenBusy = false;
  const localStore = {};
  const tabMessages = [];
  const started = Date.now();

  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener(fn) { onMessage = fn; } },
      onMessageExternal: { addListener() {} },
      getURL: (p) => `chrome-extension://test/${p}`,
      getManifest: () => ({ version: "test" }),
      lastError: undefined,
      getContexts: async () => (contextsOpen ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : []),
      sendMessage(message, callback) {
        // Pings are lifecycle checks, not commands; keep the last command.
        if (message.kind === "offscreen-ping") {
          if (callback) setTimeout(() => callback({ ok: true, busy: offscreenBusy }), 0);
          return Promise.resolve();
        }
        offscreenCommand = message;
        // Every command in this harness answers ok so the worker's bounded
        // send helpers resolve immediately.
        if (callback) {
          setTimeout(() => callback({ ok: true }), 0);
        }
        return Promise.resolve();
      },
    },
    storage: {
      session: { setAccessLevel: async () => {} },
      local: {
        get: async (key) => (key in localStore ? { [key]: localStore[key] } : {}),
        set: async (items) => Object.assign(localStore, items),
        remove: async (key) => { delete localStore[key]; },
      },
    },
    action: {
      onClicked: { addListener() {} },
      setBadgeText: async () => {},
      setTitle: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    commands: { onCommand: { addListener() {} } },
    tabs: {
      query: async () => [],
      sendMessage: async (id, message) => {
        tabMessages.push({ id, message });
      },
      captureVisibleTab: async () => "",
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
    },
    windows: {
      create: async () => ({ id: 1 }),
      remove: async () => {},
      onRemoved: { addListener() {} },
    },
    offscreen: {
      Reason: { USER_MEDIA: "USER_MEDIA", BLOBS: "BLOBS", AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
      createDocument: async () => {
        contextsOpen = true;
        // The recorder signals readiness right after it loads.
        setTimeout(() => onMessage({ kind: "offscreen-ready", target: "offscreen" }, {}, () => {}), 0);
      },
      closeDocument: async () => { contextsOpen = false; },
    },
    tabCapture: {
      getMediaStreamId: (_opts, cb) => setTimeout(() => cb("fake-stream-id"), 0),
    },
    downloads: { download: async () => 1 },
  };

  const sandbox = {
    chrome,
    console: { log() {}, error() {}, warn() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    Promise,
    Error,
    URL,
    Blob,
    fetch: async () => ({}),
    crypto: { randomUUID: () => "uuid" },
  };
  createContext(sandbox);
  runInContext(swCode, sandbox);

  assert(typeof onMessage === "function", "worker registered its message listener");

  const response = await new Promise((resolve) => {
    const keepOpen = onMessage(
      { kind: "record-start", camera: true, microphone: true, tabAudio: true },
      { tab: { id: 7 } },
      resolve,
    );
    assert(keepOpen === true, "record-start is handled asynchronously");
    setTimeout(() => resolve({ __timeout: true }), 4000);
  });

  const elapsed = Date.now() - started;
  assert(!response.__timeout, `start answered in ${elapsed}ms (the bug hung for 5s)`);
  assert(!!offscreenCommand, "worker sent an offscreen command");
  assert(
    offscreenCommand.kind === "offscreen-start",
    `command kind is "offscreen-start" (got "${offscreenCommand.kind}")`,
  );
  assert(offscreenCommand.target === "offscreen", 'command target is "offscreen"');
  assert(
    offscreenCommand.sessionId && offscreenCommand.streamId === "fake-stream-id",
    "command carries session and stream id",
  );
  assert(
    offscreenCommand.camera === true &&
      offscreenCommand.microphone === true &&
      offscreenCommand.tabAudio === true,
    "command carries all three device toggles",
  );
  assert(
    Object.keys(offscreenCommand).every((key) =>
      ["kind", "sessionId", "streamId", "tabId", "target", "camera", "microphone", "tabAudio"].includes(key),
    ),
    "no stray envelope fields",
  );
  assert(response.ok === true, "content script got ok:true");

  // Move the worker into a live recording state without a real recorder.
  onMessage(
    {
      kind: "record-status",
      status: {
        state: "recording",
        startedAt: Date.now(),
        camera: true,
        microphone: true,
        tabAudio: true,
        unavailable: [],
        sessionId: offscreenCommand.sessionId,
      },
    },
    {},
    () => {},
  );

  const sendContent = (message) =>
    onMessage(message, { tab: { id: 7 } }, () => {});

  sendContent({ kind: "record-pause" });
  await new Promise((r) => setTimeout(r, 20));
  assert(
    offscreenCommand.kind === "offscreen-pause",
    "chip pause becomes offscreen-pause",
  );

  sendContent({ kind: "record-resume" });
  await new Promise((r) => setTimeout(r, 20));
  assert(
    offscreenCommand.kind === "offscreen-resume",
    "chip resume becomes offscreen-resume",
  );

  tabMessages.length = 0;
  const frame = "data:image/jpeg;base64,AAAA";
  onMessage(
    {
      kind: "recorder-camera-frame",
      sessionId: offscreenCommand.sessionId,
      dataUrl: frame,
      target: "offscreen",
    },
    {},
    () => {},
  );
  await new Promise((r) => setTimeout(r, 20));
  const relayed = tabMessages.find(
    (entry) => entry.message.kind === "camera-preview-frame",
  );
  assert(
    relayed?.id === 7 && relayed.message.dataUrl === frame,
    "camera frame is relayed to the recording tab",
  );

  sendContent({ kind: "record-discard" });
  await new Promise((r) => setTimeout(r, 20));
  assert(
    offscreenCommand.kind === "offscreen-discard",
    "chip discard becomes offscreen-discard",
  );

  sendContent({ kind: "record-stop" });
  await new Promise((r) => setTimeout(r, 20));
  assert(
    offscreenCommand.kind === "offscreen-discard",
    "stop after discard is ignored (one terminal command per recording)",
  );

  // A stop clicked while the recorder is still starting must survive the
  // post-start check, then be delivered on the first live status. This closes
  // the race where the click lands between those two points.
  const firstSession = offscreenCommand.sessionId;
  onMessage(
    {
      kind: "record-status",
      status: { state: "discarded", sessionId: firstSession },
    },
    {},
    () => {},
  );
  await new Promise((r) => setTimeout(r, 60));

  const secondStart = await new Promise((resolve) => {
    onMessage(
      { kind: "record-start", camera: true, microphone: false, tabAudio: false },
      { tab: { id: 7 } },
      resolve,
    );
    setTimeout(() => resolve({ ok: false, error: "timeout" }), 4000);
  });
  assert(secondStart.ok === true, "second recording starts after a terminal status");
  const secondSession = offscreenCommand.sessionId;
  assert(
    secondSession && secondSession !== firstSession,
    "second recording gets a fresh session id",
  );

  sendContent({ kind: "record-stop" });
  await new Promise((r) => setTimeout(r, 20));
  assert(
    offscreenCommand.kind === "offscreen-start",
    "startup stop is held instead of sent to a recorder that is not live",
  );

  onMessage(
    {
      kind: "record-status",
      status: {
        state: "recording",
        startedAt: Date.now(),
        camera: true,
        microphone: false,
        tabAudio: false,
        unavailable: [],
        sessionId: secondSession,
      },
    },
    {},
    () => {},
  );
  await new Promise((r) => setTimeout(r, 20));
  assert(
    offscreenCommand.kind === "offscreen-stop",
    "held startup stop is delivered on the first live status",
  );
  assert(
    offscreenCommand.share === undefined,
    "stop without a paid session carries no share request (local download)",
  );

  onMessage(
    {
      kind: "record-status",
      status: { state: "saved", filename: "test.webm", sessionId: secondSession },
    },
    {},
    () => {},
  );
  await new Promise((r) => setTimeout(r, 60));

  // Premium: a paid session turns the stop into a share, and the recorder
  // document must outlive the recording while its share job is busy.
  localStore.capann_session = {
    token: "session-token",
    email: "a@example.com",
    paid: true,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    checkedAt: Date.now(),
  };
  const third = await new Promise((resolve) => {
    onMessage(
      { kind: "record-start", camera: false, microphone: false, tabAudio: false },
      { tab: { id: 7 } },
      resolve,
    );
    setTimeout(() => resolve({ ok: false, error: "timeout" }), 4000);
  });
  assert(third.ok === true, "third recording starts");
  const thirdSession = offscreenCommand.sessionId;
  onMessage(
    {
      kind: "record-status",
      status: {
        state: "recording",
        startedAt: Date.now(),
        camera: false,
        microphone: false,
        tabAudio: false,
        unavailable: [],
        sessionId: thirdSession,
      },
    },
    {},
    () => {},
  );
  sendContent({ kind: "record-stop" });
  await new Promise((r) => setTimeout(r, 40));
  assert(offscreenCommand.kind === "offscreen-stop", "paid stop is sent");
  if (edition === "premium") {
    assert(
      offscreenCommand.share?.token === "session-token" &&
        offscreenCommand.share.copyPreference === "ask",
      "premium: paid stop carries the share request (token + copy choice)",
    );
  } else {
    assert(
      offscreenCommand.share === undefined,
      "free: even a stored paid session never shares",
    );
  }

  offscreenBusy = edition === "premium";
  onMessage(
    {
      kind: "recorder-final-status",
      status:
        edition === "premium"
          ? { state: "sharing", filename: "test.webm", sessionId: thirdSession }
          : { state: "saved", filename: "test.webm", sessionId: thirdSession },
    },
    {},
    () => {},
  );
  await new Promise((r) => setTimeout(r, 60));
  if (edition === "premium") {
    assert(contextsOpen, "premium: busy recorder document stays open after 'sharing'");
    offscreenBusy = false;
    onMessage({ kind: "recorder-share-finished", sessionId: thirdSession, target: "offscreen" }, {}, () => {});
    await new Promise((r) => setTimeout(r, 60));
  }
  assert(!contextsOpen, "recorder document closes once idle");
}

// Recorder: an unrecognized command must be answered, not left hanging.
async function testRecorder() {
  console.log("\nRecorder command handling");
  let onMessage = null;

  const chrome = {
    runtime: {
      onMessage: { addListener(fn) { onMessage = fn; } },
      sendMessage: async () => {},
      lastError: undefined,
    },
  };

  const sandbox = {
    chrome,
    window: { setTimeout, clearTimeout, setInterval, clearInterval },
    navigator: { permissions: { query: async () => ({ state: "granted" }) } },
    performance,
    console: { log() {}, error() {}, warn() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    Promise,
    Error,
    MediaRecorder: class {},
  };
  createContext(sandbox);
  runInContext(recorderCode, sandbox);

  assert(typeof onMessage === "function", "recorder registered its message listener");

  // The exact malformed message the old spread produced.
  const malformed = await new Promise((resolve) => {
    const handled = onMessage({ kind: "record-start", target: "offscreen" }, {}, resolve);
    assert(handled === true, "target-matched message returns true");
    setTimeout(() => resolve({ __timeout: true }), 1000);
  });
  assert(!malformed.__timeout, "unknown command answered immediately");
  assert(malformed.ok === false, "unknown command answers ok:false");
  assert(
    malformed.errorCode === "RECORDER_STARTUP_FAILED",
    "unknown command returns a real error code",
  );

  const ping = await new Promise((resolve) => {
    onMessage({ kind: "offscreen-ping", target: "offscreen" }, {}, resolve);
    setTimeout(() => resolve({ __timeout: true }), 1000);
  });
  assert(!ping.__timeout && ping.ok === true, "offscreen-ping still answers ok:true");
  assert(ping.busy === false, "offscreen-ping reports no share job (busy:false)");

  let responded = false;
  const foreign = onMessage({ kind: "record-start", target: "content" }, {}, () => { responded = true; });
  await new Promise((r) => setTimeout(r, 50));
  assert(foreign === false && !responded, "non-offscreen target is ignored");
}

await testWorker();
await testRecorder();
console.log("\nRECORD WIRING TEST PASSED");
