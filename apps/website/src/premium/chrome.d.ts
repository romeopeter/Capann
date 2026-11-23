// The slice of `chrome.runtime` a web page gets when an installed extension
// lists its origin under `externally_connectable` (Capann's Premium build).
interface Window {
  chrome?: {
    runtime?: {
      sendMessage?: (extensionId: string, message: unknown, callback: (reply: unknown) => void) => void;
      lastError?: { message?: string };
    };
  };
}
