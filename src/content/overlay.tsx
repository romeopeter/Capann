import { createRoot } from 'react-dom/client';
import { OverlayApp } from './OverlayApp';
import { createContext } from 'react';

export const ShadowRootContext = createContext<ShadowRoot | null>(null);

if (!document.getElementById('screenslate-host')) {
  const host = document.createElement('div');
  host.id = 'screenslate-host';
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
