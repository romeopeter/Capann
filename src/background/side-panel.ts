/**
 * Opens Chrome's side panel on one of its tabs (`SidePanelSection`).
 *
 * The side panel ships in both editions: Screenshot style in every build,
 * plus Links in Premium. The requested tab is written to
 * `chrome.storage.session`, which the panel reads on load and follows while
 * open, so opening it from "Style" or "My links" lands on the right tab even
 * if it was already open.
 *
 * `sidePanel.open()` must run in the same task as the user's click, so it is
 * called before anything is awaited. If Chrome refuses (no gesture, older
 * version), the same page opens in a tab.
 */

import { SIDE_PANEL_SECTION_KEY } from "../shared/screenshot-style";
import type { SidePanelSection } from "../shared/types";

export function openSidePanel(
  sender: chrome.runtime.MessageSender,
  section: SidePanelSection,
): Promise<{ ok: boolean }> {
  void chrome.storage.session.set({ [SIDE_PANEL_SECTION_KEY]: section });
  const windowId = sender.tab?.windowId;
  const fallback = () =>
    chrome.tabs
      .create({ url: chrome.runtime.getURL(`sidepanel.html#${section}`) })
      .then(() => ({ ok: true }));
  if (windowId === undefined) return fallback();
  return chrome.sidePanel
    .open({ windowId })
    .then(() => ({ ok: true }))
    .catch(fallback);
}
