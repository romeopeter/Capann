/**
 * annotate-bridge.ts
 *
 * Tiny external store that connects the two React roots in this content
 * script: `OverlayApp` (host `#capann-host`) and `RecordingChip` (host
 * `#capann-recording-host`). They are separate roots on purpose — see the
 * visibility seam in `recording-chip.tsx` — so they cannot share React state.
 *
 * - `available`: OverlayApp sets it while a recording is capturing with
 *   "Annotate screen" on. The chip shows the pencil bubble only then.
 * - `panelOpen`: the chip's bubble toggles it; OverlayApp shows or hides the
 *   annotation panel accordingly.
 *
 * Module state (not a window event) keeps the page from being able to toggle
 * the panel, and both roots import the same bundle so they see one instance.
 */

export interface AnnotateBridgeState {
  available: boolean;
  panelOpen: boolean;
}

let state: AnnotateBridgeState = { available: false, panelOpen: false };
const listeners = new Set<() => void>();

function update(next: Partial<AnnotateBridgeState>): void {
  const merged = { ...state, ...next };
  if (
    merged.available === state.available &&
    merged.panelOpen === state.panelOpen
  )
    return;
  state = merged;
  listeners.forEach((listener) => listener());
}

export const annotateBridge = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): AnnotateBridgeState {
    return state;
  },
  setAvailable(available: boolean): void {
    // The panel can only be open while annotating is available.
    update(available ? { available } : { available, panelOpen: false });
  },
  setPanelOpen(panelOpen: boolean): void {
    update({ panelOpen: panelOpen && state.available });
  },
  togglePanel(): void {
    update({ panelOpen: !state.panelOpen && state.available });
  },
};
