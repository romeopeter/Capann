# Architecture

Capann is a Manifest V3 Chrome extension. The service worker handles extension lifecycle events and tab capture/download requests. A content script injects one React app into each page.

## Runtime flow

1. `src/content/overlay.tsx` creates the `#capann-host` element and mounts the app in a Shadow DOM.
2. `OverlayApp.tsx` owns per-tab annotation state, tool state, canvas events, persistence, and undo/redo.
3. The bottom canvas renders saved annotations. The top canvas handles pointer input and transient previews such as the current stroke or selection handles.
4. `toolbar.tsx` renders controls in the Shadow DOM. It sends tool, color, and size changes to `OverlayApp` through props.
5. `chrome.storage.session` stores annotations under a key containing the current tab ID. The service worker coordinates screenshot capture and PNG downloads.

## Main code areas

- `src/shared/types.ts`: annotation data, tools, and message contracts.
- `src/content/geometry.ts`: bounds, hit tests, and spatial transformations.
- `src/content/render.ts`: drawing annotation data to a canvas.
- `src/content/OverlayApp.tsx`: state, input, history, and persistence.
- `src/content/toolbar.tsx`: toolbar and session controls.
- `src/background/service-worker.ts`: extension events and browser APIs.

Use `npm run typecheck` to check TypeScript and `npm run build` to create the unpacked extension in `dist/`.
