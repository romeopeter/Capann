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
import { createContext } from 'react';

export const ShadowRootContext = createContext<ShadowRoot | null>(null);

if (!document.getElementById('capann-host')) {
  const host = document.createElement('div');
  host.id = 'capann-host';
  host.style.all = 'initial';
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
}
