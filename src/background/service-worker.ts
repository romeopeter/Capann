import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
} from '../shared/types';

// Content scripts can't read chrome.storage.session by default; opt in so the
// overlay can persist per-tab annotations itself without proxying every read
// through this worker.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
  });
});

function sendToActiveTab(message: BackgroundToContentMessage): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId === undefined) return;
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // No content script listening on this tab (e.g. chrome:// pages) — ignore.
    });
  });
}

chrome.action.onClicked.addListener(() => {
  sendToActiveTab({ kind: 'toggle-draw-mode' });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'clear-annotations') {
    sendToActiveTab({ kind: 'clear-annotations' });
  } else if (command === 'cycle-tool') {
    sendToActiveTab({ kind: 'cycle-tool' });
  }
});

chrome.runtime.onMessage.addListener(
  (message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.kind === 'get-tab-id') {
      sendResponse({ tabId: sender.tab?.id ?? -1 });
      return false;
    }

    if (message.kind === 'capture-visible-tab') {
      const capture = (cb: (dataUrl: string) => void) => {
        if (sender.tab?.windowId !== undefined) {
          chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, cb);
        } else {
          chrome.tabs.captureVisibleTab({ format: 'png' }, cb);
        }
      };
      capture((dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          const response: BackgroundToContentMessage = {
            kind: 'capture-visible-tab-error',
            error: chrome.runtime.lastError?.message ?? 'Capture failed',
          };
          sendResponse(response);
          return;
        }
        const response: BackgroundToContentMessage = {
          kind: 'capture-visible-tab-result',
          dataUrl,
        };
        sendResponse(response);
      });
      return true; // keep the message channel open for the async response
    }

    if (message.kind === 'download-png') {
      chrome.downloads.download({
        url: message.dataUrl,
        filename: message.filename,
        saveAs: false,
      });
      return false;
    }

    return false;
  }
);
