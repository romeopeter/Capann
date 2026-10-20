# Recording workflow

Capann's recording UI is in the page overlay. The Chrome action opens the Record / Annotate chooser; choosing Record displays camera, microphone, and tab-audio options before capture. Those inputs are enabled by default when available.

Capann records **the tab it is running on**. There is no source picker: Chrome's `desktopCapture` picker cannot be used from a service worker without a `targetTab`, and a `targetTab`-scoped stream cannot be consumed by the extension's offscreen document. Tab capture IDs from `tabCapture` are the supported route (Chrome 116+).

## Camera and microphone permission

Camera and microphone access belongs to the extension origin, and **offscreen documents cannot show a permission prompt**. When permission is missing, Chrome leaves `getUserMedia()` pending forever; this used to surface as "The recording component did not respond" after the 20s command timeout.

The recorder therefore checks `navigator.permissions.query()` first and skips an unpermitted device instead of calling `getUserMedia()`, so recording always starts with the inputs that are available.

To grant access, the Record view shows "Camera and microphone need permission" with an **Allow** action when an enabled option is not granted. That sends `record-request-permission`; the service worker opens `permissions.html` in a small popup window. The page requests each enabled device (Chrome shows the prompt there), then sends `permission-granted` with the resulting states. Because a new grant only applies to documents loaded afterwards, the worker closes the offscreen document and notifies the tab; the panel prepares a fresh recorder, which can now capture the camera and microphone. The page closes itself on success.

A denied or dismissed grant never blocks recording: Start still works, the device is skipped, and the existing "unavailable" notice explains it.

## Capture flow

1. When the Record view opens, `OverlayApp.tsx` sends `record-prewarm`. The service worker creates `offscreen.html` and waits for its `offscreen-ready` signal before enabling Start (`preparing-recorder`).
2. On Start, `OverlayApp.tsx` commits active text, exits drawing mode, and synchronously hides the complete `#capann-host` before sending `record-start` in the same click.
3. The service worker:
   a. Confirms the recorder is ready. If it is not, it awaits readiness first, so the stream ID is minted only when something can redeem it (`preparing-recorder`).
   b. Hides the host on the tab again as a safety net.
   c. Calls `chrome.tabCapture.getMediaStreamId({ targetTabId })` and then immediately sends the ID to the offscreen recorder, with no awaits in between (`acquiring-tab-stream`). IDs expire within seconds.
4. The offscreen document (`src/offscreen/recorder.ts`):
   a. Redeems the ID with `getUserMedia()` using `chromeMediaSource: "tab"` constraints (`acquiring-tab-stream`).
   b. Composes video with a rounded 16:9 camera bubble at lower right, mixes microphone audio with tab audio, and routes captured tab audio back to local playback (`preparing-video`). The compositor redraws on a 33ms timer: offscreen documents are never rendered, so `requestAnimationFrame` does not run and `requestVideoFrameCallback` is unreliable. Without that timer the canvas emits one frame, `MediaRecorder` never fires `onstart`, and startup times out.
   c. Creates `MediaRecorder`, waits for `onstart` before confirming startup (`starting-recorder`). Every startup await is bounded (tab stream 8s, camera/mic 6s in parallel, video 6s, audio 3s, recorder start 5s) so the worker always gets a response.
   d. Records WebM chunks in memory. On save, creates a Blob URL and sends `recorder-download-request` to the service worker. The service worker invokes `chrome.downloads.download`, reports saved/failed status, then instructs the recorder to release the Blob URL and close. Discard drops chunks without downloading.
5. Recording state/chunks are temporary and do not survive a browser restart.

Camera, microphone, or tab audio may be unavailable independently. The recorder keeps going with available inputs and reports unavailable sources in the Record view. Tab video is required; if it fails, capture stops with a recoverable error and no file is created.

## Why the stream ID is created last

A `tabCapture` ID can only be redeemed once and expires quickly. Creating it before the offscreen document is ready is the main source of "it worked yesterday" failures, so the order is fixed:

```
offscreen ready -> hide overlay -> mint ID -> send ID -> getUserMedia
```

The worker also refuses to run two starts at once (`startInFlight`), ignores status messages from sessions other than the current one, and closes the offscreen document on any startup failure so a timed-out start cannot leave the tab muted or a recorder running.

## Startup stages (console trace format)

Each recording session gets a unique `sessionId` (e.g., `1702345678901-abc123`). The service worker and offscreen document log every stage transition:

```
[Capann] session=<id> stage=preparing-recorder
[Capann] session=<id> stage=preparing-recorder {"ready":true}
[Capann] session=<id> stage=acquiring-tab-stream
[Capann] session=<id> stage=acquiring-tab-stream {"hasStreamId":true}
[Capann] session=<id> stage=preparing-video
[Capann] session=<id> stage=starting-recorder {"ok":true}
```

On failure, the exact stage, browser error name, and message are logged:

```
[Capann] session=<id> stage=acquiring-tab-stream code=TAB_CAPTURE_UNAVAILABLE error=RecordingStartupError: Extension has not been invoked for the current page (see activeTab permission).
```

The in-page UI receives only concise, friendly status messages (see "Failure mapping" below).

## Failure mapping

| Internal code | Stage | User-facing message |
|---------------|-------|---------------------|
| `TAB_CAPTURE_UNAVAILABLE` | `acquiring-tab-stream` | "Capann can't record this tab. Open Capann on a regular webpage or web app, then try again." |
| `TAB_STREAM_ACQUISITION_FAILED` | `acquiring-tab-stream` | "Chrome started capturing the tab but Capann couldn't use it. Try again." |
| `NO_VIDEO_TRACK` | `preparing-video` | "That tab can't be recorded. Choose another webpage or web app." |
| `RECORDER_STARTUP_FAILED` | `starting-recorder` | "Capann could see the tab but couldn't start the recording. Try again." |
| `OFFSCREEN_SETUP_FAILED` | `preparing-recorder` | "Capann couldn't prepare recording. Try again." |
| `PERMISSION_DENIED_CAMERA` | (non-blocking) | "Camera unavailable — your recording will continue without the camera bubble." |
| `PERMISSION_DENIED_MICROPHONE` | (non-blocking) | "Microphone unavailable — your recording will continue without microphone audio." |
| `PERMISSION_DENIED_TAB_AUDIO` | (non-blocking) | "Tab audio unavailable — your recording will continue without audio from this tab." |
| `PROTECTED_PAGE` | (any) | "This page can't be recorded — Chrome protects browser pages. Open a website or web app, then try again." |
| `RECORDING_STOPPED_UNEXPECTEDLY` | (runtime) | "Recording ended unexpectedly — your video wasn't saved. Start a new recording when you're ready." |
| `FILE_SAVE_FAILED` | (finalize) | "Recording is ready, but couldn't be saved — check your download permissions, then record again." |

On any startup failure, the session is invalidated, acquired tracks are stopped, timers and canvas resources are cleared, the offscreen document is closed, the action badge is reset, the overlay is restored, and no download is created.

## Controls and status

- Open Capann through the Chrome action or `Alt+Shift+S` on the tab you want to record. That invocation is what grants `tabCapture` for the tab.
- Start from the in-page Record view. Once recording starts, the page overlay stays hidden for the duration, even if its UI is dismissed or the tab navigates.
- The Chrome action badge/title shows recording or paused state. Click the action to stop and save.
- `Alt+Shift+T` pauses or resumes while recording; otherwise it cycles the annotation tool.
- `Alt+Shift+C` discards while recording; otherwise it clears annotations.
- `Alt+Shift+S` opens Capann when idle; while recording it follows the action behavior and stops/saves.

## Code paths

- `src/content/OverlayApp.tsx`: chooser, input options, overlay visibility, and user-facing status.
- `src/shared/types.ts`: `RecordOptions`, `RecordingStatus`, `RecordingStage`, `RecordingErrorCode`, `MediaPermissionState`, and message contracts (`record-prewarm`, `record-permission-state`, `record-request-permission`, `permission-granted`, `recording-permission`, `record-start`, `offscreen-ping`, `offscreen-permission-state`, `offscreen-start`, `offscreen-progress`, `recorder-download-request`, `recorder-final-status`).
- `src/background/service-worker.ts`: `tabCapture.getMediaStreamId`, offscreen lifecycle, typed `sendMessage` request/response, startup stage logging, failure mapping, action badge, shortcuts, download handling, status relay.
- `src/offscreen/recorder.ts`: message listener (no persistent port), media acquisition, camera composition, audio mixing/playback, WebM chunks, progress reporting (`offscreen-progress`), download request, discard.
- `src/offscreen/offscreen.html`: offscreen document entry point. It loads `offscreen/recorder.js` as a classic script (the bundle is an IIFE), so the message listener registers as soon as the document parses.
- `src/permissions/permissions.html` and `.ts`: the visible one-time camera/microphone grant page.
- `scripts/build.mjs`: bundles the content overlay, offscreen recorder, and permission page, and copies both HTML entry points into `dist/`.

When changing this flow, preserve the ordering above: ready offscreen → hide overlay → mint the tab stream ID → hand it over immediately. Keep recording data local and temporary, keep Capann's host hidden for all active capture states, and return a clear final status so the content script can restore the UI.

## Browser limitations

- Capture is limited to the tab where Capann was invoked. Chrome grants `tabCapture` per tab on an extension invocation (action click or command) and rejects other tabs with "Extension has not been invoked for the current page".
- Protected pages (`chrome://`, `edge://`, extension pages, Web Store) cannot be captured.
- When a tab is captured, Chrome mutes its normal audio output; Capann sends the captured audio back to the local output so the presenter still hears it.
- If the tab is closed or navigates to a protected page during recording, the capture ends. Capann finalizes the partial recording and reports "Recording ended unexpectedly — your video wasn't saved."
- The offscreen document is created on-demand and closed when idle. Chrome may suspend it under memory pressure; the service worker recreates it automatically on the next recording.
- Chrome allows only one offscreen document per extension. Before creating one, the service worker looks for *any* existing offscreen document, pings it, and closes it if it is stale (for example a document left behind by an older build, or one whose script failed to load). If Chrome still rejects the creation with "Only a single offscreen document may be created", the worker closes the leftover instance and retries once.
- The offscreen document sends `offscreen-ready` once its listener is registered. The service worker waits for that signal (10s cap) before sending any command.
- Tab stream IDs expire within seconds if not consumed, so the offscreen document must be ready before the ID is minted.
- Camera and microphone cannot be granted from an offscreen document; a visible extension page must obtain the grant first. A grant only affects documents loaded after it, so the recorder is recreated after a grant. Denied access degrades gracefully; it never blocks tab video.

## Future: Screen and window recording

Recording the whole screen or another application window is out of scope. Adding it would mean:

1. Adding an explicit source selector (Tab / Window / Screen) in the Record view.
2. Using `desktopCapture.chooseDesktopMedia` from a visible extension page rather than the service worker, because service-worker calls require a `targetTab` and the resulting stream cannot be used by an offscreen document.
3. Testing audio behaviour per platform (macOS requires explicit screen-recording permission per app; Windows uses the system audio stack).
4. Keeping tab capture as the default so existing users see no behaviour change unless they opt in.

Do not implement screen or window capture now.
