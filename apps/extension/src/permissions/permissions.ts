import type { MediaPermissionState } from "../shared/types";

const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tabId") ?? "-1");
const wantsCamera = params.get("camera") === "1";
const wantsMicrophone = params.get("microphone") === "1";

const allowButton = document.getElementById("allow") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

function row(kind: "camera" | "microphone") {
  return {
    row: document.getElementById(`${kind}-row`) as HTMLDivElement,
    dot: document.getElementById(`${kind}-dot`) as HTMLSpanElement,
    state: document.getElementById(`${kind}-state`) as HTMLSpanElement,
  };
}

function paint(kind: "camera" | "microphone", state: PermissionState) {
  const parts = row(kind);
  parts.dot.classList.toggle("granted", state === "granted");
  parts.dot.classList.toggle("blocked", state === "denied");
  parts.state.textContent =
    state === "granted"
      ? "Ready"
      : state === "denied"
        ? "Blocked"
        : "Needed";
}

function setStatus(text: string, tone: "" | "ok" | "error" = "") {
  status.textContent = text;
  status.className = `status${tone ? ` ${tone}` : ""}`;
}

async function permissionState(
  name: "camera" | "microphone",
): Promise<PermissionState> {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return "prompt";
  }
}

async function requestDevice(
  name: "camera" | "microphone",
): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      name === "camera" ? { video: true } : { audio: true },
    );
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}

async function requestPermissions(): Promise<void> {
  allowButton.disabled = true;
  setStatus("Waiting for Chrome…");

  // Ask for one device at a time so each prompt is clear.
  const cameraOk = !wantsCamera || (await requestDevice("camera"));
  if (wantsCamera) paint("camera", cameraOk ? "granted" : "denied");
  const microphoneOk =
    !wantsMicrophone || (await requestDevice("microphone"));
  if (wantsMicrophone)
    paint("microphone", microphoneOk ? "granted" : "denied");

  const state: MediaPermissionState = {
    camera: await permissionState("camera"),
    microphone: await permissionState("microphone"),
  };
  paint("camera", state.camera);
  paint("microphone", state.microphone);

  const grantedWanted =
    (!wantsCamera || state.camera === "granted") &&
    (!wantsMicrophone || state.microphone === "granted");

  if (state.camera === "granted" || state.microphone === "granted") {
    try {
      await chrome.runtime.sendMessage({
        kind: "permission-granted",
        tabId,
        ...state,
      });
    } catch {
      // The tab may have closed; the grant still applies.
    }
  }

  if (grantedWanted) {
    setStatus("You're ready to record.", "ok");
    window.setTimeout(() => window.close(), 900);
    return;
  }

  const blocked: string[] = [];
  if (wantsCamera && state.camera === "denied") blocked.push("camera");
  if (wantsMicrophone && state.microphone === "denied")
    blocked.push("microphone");
  setStatus(
    `Chrome blocked ${blocked.join(" and ")} access. Allow it for Capann in Chrome's settings, then try again.`,
    "error",
  );
  allowButton.disabled = false;
  allowButton.textContent = "Try again";
}

if (wantsCamera) {
  void permissionState("camera").then((state) => paint("camera", state));
} else {
  row("camera").row.hidden = true;
}
if (wantsMicrophone) {
  void permissionState("microphone").then((state) =>
    paint("microphone", state),
  );
} else {
  row("microphone").row.hidden = true;
}

if (!wantsCamera && !wantsMicrophone) {
  allowButton.disabled = true;
  setStatus("Choose a camera or microphone in the Capann panel first.");
} else {
  allowButton.addEventListener("click", () => void requestPermissions());
}
