# Learn Capann

This handbook explains how Capann is put together and how to make changes that fit its existing design and behavior. Capann runs as an in-page overlay: its launcher, annotation toolbar, and recording setup appear over the active website, while Chrome's action icon reports recording status. Premium cloud links are served by a separate Cloudflare Worker in `apps/api/`.

Capann is an npm-workspaces monorepo: `apps/extension/` (the extension), `apps/api/` (the Premium Worker), `apps/website/` (the website and its Premium pages), and `packages/` for what they share. Unless a path says otherwise, `src/…` and `scripts/…` paths in these notes are relative to `apps/extension/`.

## Start here

- [Architecture](architecture.md) — extension entrypoints, overlay, and storage.
- [Annotations](annotations.md) — annotation types (including comments vs. free text), drawing, hit testing, selection, and history.
- [Screenshots](screenshot.md) — selecting an area, editing it with the same tools, the frame style in the side panel, and export.
- [Canvas and memory](canvas.md) — why the overlay canvases are viewport-sized, what a canvas costs, the hard limits, and how annotations scroll with the page.
- [Recording](recording.md) — in-page record setup, capture pipeline, visibility, and lifecycle.
- [Premium share links](premium.md) — the extension side of Premium: which context does what, sign-in hand-off, how a stop becomes a link, and the "never lose a recording" invariant.
- [Premium backend](backend.md) — the Cloudflare Worker behind shareable links: passwordless tokens, where state lives and why, uploads, retention, and abuse controls. Setup and the route table are in [`apps/api/README.md`](../apps/api/README.md).
- [Making changes](making-changes.md) — a practical workflow for extending the project and keeping these notes current.

## Working principles

Keep annotation data serializable and independent of the page DOM. Keep drawing and selection on the canvases, overlay UI inside its Shadow DOM, and visual styling aligned with the tokens documented in the project `AGENTS.md`. Route persistent edits through the app's history-aware mutation path. Recording chunks stay temporary in the offscreen document and are only downloaded when the user saves. Free features never make network calls; only Premium talks to the backend, and the backend authorizes Premium actions from its own subscription record, not from what a client claims.
