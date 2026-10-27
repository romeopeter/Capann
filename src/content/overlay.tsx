/**
 * overlay.tsx
 *
 * Entry point for the Capann content script.
 * Sets up the shadow DOM container and mounts the React application.
 *
 * Key responsibilities:
 * - Creates isolated shadow DOM to prevent CSS conflicts with host page
 * - Provides ShadowRootContext for components that need DOM access
 * - Bootstraps the React application via OverlayApp component
 * - Ensures single instance per page (guards against double injection)
 */

import { createRoot } from 'react-dom/client';
import { OverlayApp } from './OverlayApp';
import { RecordingChip } from './recording-chip';
import { createContext } from 'react';

export const ShadowRootContext = createContext<ShadowRoot | null>(null);

if (!document.getElementById('capann-host')) {
  const host = document.createElement('div');
  host.id = 'capann-host';
  host.style.all = 'initial';
  // Prevent persisted annotations from flashing into a tab recording during
  // page navigation; OverlayApp reveals the host after checking recorder state.
  host.style.visibility = 'hidden';
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const container = document.createElement('div');
  shadow.append(container);

  const root = createRoot(container);

  root.render(
    <ShadowRootContext.Provider value={shadow}>
      <OverlayApp />
    </ShadowRootContext.Provider>
  );

  // Recording chip host. This is deliberately a sibling of #capann-host:
  // OverlayApp hides the annotation overlay for the whole capture, while the
  // chip (and its camera bubble) must stay visible and therefore be recorded.
  // Keeping a separate host means the existing capture invariant in
  // OverlayApp does not need a second visibility mode.
  const chipHost = document.createElement('div');
  chipHost.id = 'capann-recording-host';
  chipHost.style.all = 'initial';
  chipHost.style.display = 'block';
  chipHost.style.position = 'fixed';
  chipHost.style.inset = '0';
  chipHost.style.pointerEvents = 'none';
  chipHost.style.zIndex = '2147483647';
  document.documentElement.append(chipHost);

  const chipShadow = chipHost.attachShadow({ mode: 'open' });
  const chipContainer = document.createElement('div');
  chipShadow.append(chipContainer);
  createRoot(chipContainer).render(<RecordingChip />);
}
