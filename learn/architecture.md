# Architecture

Capann is a Manifest V3 Chrome extension. The service worker handles extension lifecycle events, tab capture, downloads, keyboard commands, and the action badge. A content script injects one React app into each supported page. Recording media is composed in a dedicated offscreen document.

## Runtime flow

1. The user invokes Capann from the Chrome action on the tab to use. The service worker sends a command to that tab's content script; the in-page chooser opens in the overlay.
2. `src/content/overlay.tsx` creates the `#capann-host` element and mounts `OverlayApp` in a Shadow DOM. The host starts hidden until the app checks whether the tab is already being recorded.
3. `OverlayApp.tsx` owns the chooser and workflow views, per-tab annotation state, tool state, canvas events, persistence, and undo/redo.
4. In Annotate mode, the bottom canvas renders saved annotations. The top canvas handles pointer input and transient previews such as the current stroke or selection handles. `toolbar.tsx` renders controls in the Shadow DOM and sends tool, color, and size changes through props.
5. `chrome.storage.session` stores annotations under a key containing the current tab ID. The service worker coordinates screenshot capture and PNG downloads.
6. In Record mode, the content script requests capture for its own tab. The service worker obtains a `tabCapture` stream ID and starts `src/offscreen/recorder.ts` in `src/offscreen/index.html`.
7. The offscreen recorder combines the tab video with an optional lower-right webcam bubble, mixes optional microphone and tab audio, and encodes WebM. Tab audio is also routed back to local playback.
8. When capture is active, the content script hides the entire overlay host, including annotations, controls, and text input. The recorder continues if the page UI is dismissed or the user navigates within the tab. The Chrome action badge and title show recording state; clicking the action stops and saves.

## Main code areas

- `src/shared/types.ts`: annotation data, tools, and message contracts.
- `src/content/geometry.ts`: bounds, hit tests, and spatial transformations.
- `src/content/render.ts`: drawing annotation data to a canvas.
- `src/content/OverlayApp.tsx`: state, input, history, and persistence.
- `src/content/toolbar.tsx`: toolbar and session controls.
- `src/background/service-worker.ts`: action handling, shortcuts, capture stream IDs, downloads, and status routing.
- `src/offscreen/recorder.ts`: tab/camera/microphone capture, composition, audio routing, and WebM lifecycle.
- `src/shared/types.ts`: typed messages between the overlay, service worker, and offscreen recorder.

Chrome pages such as `chrome://` are protected and cannot be captured or receive the content overlay. If action invocation or tab access has expired, click the Capann action on the target website again before starting capture. The action title/badge reports unavailable pages and capture errors.

Use `npm run typecheck` to check TypeScript and `npm run build` to create the unpacked extension in `dist/`.
