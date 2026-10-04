# Learn Capann

This handbook explains how Capann is put together and how to make changes that fit its existing design and behavior. Capann runs as an in-page overlay: its launcher, annotation toolbar, and recording setup appear over the active website, while Chrome's action icon reports recording status.

## Start here

- [Architecture](architecture.md) — extension entrypoints, overlay, and storage.
- [Annotations](annotations.md) — annotation types, drawing, hit testing, selection, and history.
- [Recording](recording.md) — in-page record setup, capture pipeline, visibility, and lifecycle.
- [Making changes](making-changes.md) — a practical workflow for extending the project and keeping these notes current.

## Working principles

Keep annotation data serializable and independent of the page DOM. Keep drawing and selection on the canvases, overlay UI inside its Shadow DOM, and visual styling aligned with the tokens documented in the project `AGENTS.md`. Route persistent edits through the app's history-aware mutation path. Recording chunks stay temporary in the offscreen document and are only downloaded when the user saves.
