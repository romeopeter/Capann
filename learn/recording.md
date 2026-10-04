# Recording workflow

Capann's recording UI is in the page overlay. The Chrome action opens the Record / Annotate chooser; choosing Record displays camera, microphone, and tab-audio options before capture. Those inputs are enabled by default when available.

## Capture flow

1. `OverlayApp.tsx` commits any active text input, exits drawing mode, and hides the complete `#capann-host`. This keeps the toolbar, chooser, annotations, canvas previews, and text editor out of the video.
2. The content script sends a typed `record-start` message to `src/background/service-worker.ts`. The service worker uses the sending tab ID and immediately requests a tab-capture stream ID. This request depends on the user invoking Capann on that tab; if access is unavailable, the recorder reports an error and does not download an empty file.
3. The service worker creates `offscreen.html` when needed and sends the stream ID and selected input options to `src/offscreen/recorder.ts`.
4. The offscreen document captures tab video and available audio. It composites the video with a rounded 16:9 camera bubble at the lower right, mixes microphone audio with tab audio, and routes captured tab audio to local playback.
5. The offscreen document records WebM chunks in memory. On save, it downloads the completed local file. Discard drops the chunks without downloading. Recording state/chunks are temporary and do not survive a browser restart.

Camera, microphone, or tab audio may be unavailable independently. The recorder keeps going with available inputs and reports unavailable sources in the Record view. Tab video is required; if it fails, capture stops with a recoverable error and no file is created.

## Controls and status

- Click the Chrome action on a regular website to open the chooser. Chrome pages such as `chrome://` are protected and unsupported.
- Start from the in-page Record view. Once recording starts, the page overlay stays hidden for the duration, even if its UI is dismissed or the tab navigates.
- The Chrome action badge/title shows recording or paused state. Click the action to stop and save.
- `Alt+Shift+T` pauses or resumes while recording; otherwise it cycles the annotation tool.
- `Alt+Shift+C` discards while recording; otherwise it clears annotations.
- `Alt+Shift+S` opens Capann when idle; while recording it follows the action behavior and stops/saves.

## Code paths

- `src/content/OverlayApp.tsx`: chooser, input options, overlay visibility, and user-facing status.
- `src/shared/types.ts`: `RecordOptions`, `RecordingStatus`, and message contracts.
- `src/background/service-worker.ts`: tab-specific stream ID request, offscreen lifecycle, action badge, shortcuts, and status relay.
- `src/offscreen/recorder.ts`: media acquisition, camera composition, audio mixing/playback, WebM chunks, download, and discard.
- `scripts/build.mjs`: bundles the content overlay and offscreen recorder and copies `offscreen.html` into `dist/`.

When changing this flow, preserve the capture ordering: the action invocation targets the tab, the service worker obtains the stream ID promptly, then the offscreen document consumes it. Keep recording data local and temporary, keep Capann's host hidden for all active capture states, and return a clear final status so the content script can restore the UI.
