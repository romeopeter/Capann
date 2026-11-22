/**
 * sidepanel.tsx — Capann in Chrome's side panel (every edition).
 *
 * Tabs keep the panel's jobs apart:
 *
 * - Screenshot: the screenshot frame style (style-panel.tsx), every edition
 * - Links: Premium's shared recordings (links-panel.tsx), premium build only
 *
 * The free build has one tab, so it shows no tab bar. Which tab opens is
 * decided by whoever opened the panel ("Style" or "My links"): the worker
 * writes it to `chrome.storage.session` (background/side-panel.ts), and the
 * panel follows that key while open. When Chrome won't open the side panel,
 * the same page opens in a tab with the section in its hash.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PREMIUM_ENABLED } from "../shared/features";
import { SIDE_PANEL_SECTION_KEY } from "../shared/screenshot-style";
import type { SidePanelSection } from "../shared/types";
import { LinksPanel } from "./links-panel";
import { ScreenshotStylePanel } from "./style-panel";

const TABS: { id: SidePanelSection; label: string }[] = [
  { id: "screenshot", label: "Screenshot" },
  ...(PREMIUM_ENABLED ? [{ id: "links" as const, label: "Links" }] : []),
];

function available(value: unknown): SidePanelSection | null {
  return TABS.some((tab) => tab.id === value) ? (value as SidePanelSection) : null;
}

function SidePanelApp() {
  const [section, setSection] = useState<SidePanelSection>(
    () => available(location.hash.slice(1)) ?? "screenshot",
  );

  useEffect(() => {
    if (!location.hash) {
      void chrome.storage.session.get(SIDE_PANEL_SECTION_KEY).then((stored) => {
        const requested = available(stored[SIDE_PANEL_SECTION_KEY]);
        if (requested) setSection(requested);
      });
    }
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "session" || !(SIDE_PANEL_SECTION_KEY in changes)) return;
      const requested = available(changes[SIDE_PANEL_SECTION_KEY]!.newValue);
      if (requested) setSection(requested);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const choose = (next: SidePanelSection) => {
    setSection(next);
    // Remember the choice, so reopening the panel shows the same tab.
    void chrome.storage.session.set({ [SIDE_PANEL_SECTION_KEY]: next });
  };

  return (
    <main style={{ padding: "18px 16px 32px", maxWidth: 520, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src="icons/capann-logo.png" alt="" width={26} height={26} style={{ borderRadius: 8 }} />
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>Capann</h1>
      </header>

      {TABS.length > 1 && (
        <nav
          role="tablist"
          aria-label="Capann side panel"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))`,
            gap: 4,
            marginTop: 14,
            padding: 3,
            borderRadius: 12,
            background: "var(--surface-base)",
            border: "1px solid var(--border-hairline)",
          }}
        >
          {TABS.map((tab) => {
            const active = tab.id === section;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`panel-${tab.id}`}
                onClick={() => choose(tab.id)}
                style={{
                  height: 30,
                  borderRadius: 9,
                  border: 0,
                  fontSize: 12,
                  fontWeight: 500,
                  background: active ? "var(--surface-elevated)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  transition: "background 180ms var(--ease-morph), color 180ms var(--ease-morph)",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      )}

      <section
        role={TABS.length > 1 ? "tabpanel" : undefined}
        id={`panel-${section}`}
        aria-labelledby={TABS.length > 1 ? `tab-${section}` : undefined}
        key={section}
        className="row"
        style={{ marginTop: 18 }}
      >
        {PREMIUM_ENABLED && section === "links" ? <LinksPanel /> : <ScreenshotStylePanel />}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<SidePanelApp />);
