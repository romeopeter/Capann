# Premium share links (extension side)

Premium turns a recording into a link. The server half is described in
[Premium backend](backend.md); this note covers the extension half: where each
piece runs, how a stop becomes a link, and the rules that keep a recording from
ever being lost.

Everything here exists only in the premium build. `PREMIUM_ENABLED`
(`src/shared/features.ts`) gates the UI and the worker; `scripts/build.mjs` adds
the website connection to the premium manifest. The side panel ships in every
build (its Screenshot tab is free); Premium adds its Links tab. The free
build shows one link to the pricing page and makes no network calls.

## Where each piece runs

An MV3 extension is several separate JavaScript contexts, and each has
different powers. The design follows from those limits.

| Context | Can do | Can't do | Premium role |
|---|---|---|---|
| Content script (`premium-panel.tsx`) | Draw UI in the page, use the page's clipboard | Call the API (it is subject to the page's CORS) | Account row, share card, "Save a copy?" dialog, auto-copy |
| Service worker (`background/premium.ts`) | Call the API, `chrome.storage`, `chrome.downloads`, receive website messages | Stay alive: Chrome stops it after ~30 s idle; no DOM, no `XMLHttpRequest` | Account, sign-in, upgrade, website hand-off, relaying status, link history |
| Offscreen document (`offscreen/share.ts`) | Hold the recording `Blob`, call the API, report upload progress | Use `chrome.storage` (offscreen documents only get `chrome.runtime`) | Upload, the local-copy decision |
| Side panel, Links tab (`sidepanel/links-panel.tsx`) | Everything an extension page can | — | Links list with countdowns, link recovery |

Two consequences shape everything else:

- **The upload runs where the file is.** The recording `Blob` lives in the
  offscreen document. Sending hundreds of megabytes through extension messaging
  to the worker would copy it, so the offscreen document uploads it directly
  (extension pages are CORS-exempt for hosts in `host_permissions`).
- **The worker can't own long-lived state.** A presenter might take a minute to
  answer "Save a copy?"; the worker may be stopped long before. So a share job
  is owned by the offscreen document, which holds the `Blob` anyway and lives
  until the worker deliberately closes it. Every job message carries its own
  `tabId`, so the worker can relay it statelessly even after a restart.

## The session

There are no passwords. Signing in is proving you can read an email:

1. The Record view sends `premium-sign-in`; the worker calls
   `POST /api/auth/magic-link`.
2. The emailed link opens the website's `/verify`, which exchanges the login
   token for a 30-day session token (`POST /api/auth/verify`).
3. The website hands it over: `chrome.runtime.sendMessage(extensionId,
   { kind: "capann-session", token })`. This works only because the premium
   manifest lists the site under `externally_connectable`.
4. The worker accepts the message only from `siteUrl` and confirms the token
   with `GET /api/auth/session` before storing it, so a page can't plant an
   arbitrary string.

The session is stored in `chrome.storage.local` (`capann_session`), so it
survives a restart, unlike annotations. The page never receives the token: it
asks the worker for an `AccountSummary`. The offscreen document receives it in
the stop command, because it can't read storage.

**`paid` is a hint.** The token says whether the user had paid at the last
check, but the backend re-reads the subscription on every upload. The Record
view re-checks `paid` when it opens and whenever the window regains focus, which
is how an upgrade made in the checkout tab shows up without a reload. "Already
upgraded? Refresh" forces a check. A 401 anywhere means the session is no longer
valid, and the extension signs out.

## From stop to link

```
chip / action / shortcut ─► worker: sendRecorderCommand("stop")
                              └─ paid session? add share: { token, copyPreference }
offscreen recorder: finalize()
  ├─ no share request ─► recorder-download-request (unchanged free path)
  └─ share request:
       1. recorder-final-status { state: "sharing" }   ← recording is over
       2. startShareJob()                             ← same task
offscreen share job ─► recorder-share-status { tabId, status } ─► worker ─► tab
```

`sendRecorderCommand("stop")` is the single place a stop becomes a share: the
chip, the action click, and `Alt+Shift+S` all pass through it. Without a share
request the recorder runs exactly the path it always did. A recording that ends
on its own (the tab closed) never gets a stop command, so it is saved locally.

The terminal `sharing` status ends the recording like `saved` does: the chip
disappears, streams are released, and the Record view comes back. The upload
then continues in the background, independently of the capture invariant: the
overlay is already visible again, so `captureHidden` is not involved.

### A share job

A job has two halves that finish independently:

| Half | States |
|---|---|
| upload | `uploading` (with bytes) → `uploaded` (link) or `failed` (code + message) |
| copy | `ask` → `saving` → `saved` / `failed`, or `skipped` |

The copy starts at `ask`, `saving`, or `skipped` from the stored preference.
`ask` shows the dialog; "Don't ask again" stores `always` or `never`, which the
Record view shows as **Keep a copy**. An unanswered dialog counts as "No
thanks" after ten minutes, since the link exists.

The job is done when the upload has finished and the copy is settled. Only then
is the `Blob` released and the worker told it may close the document.

### Never lose a recording

This is the share flow's invariant, the counterpart of the capture invariant:

- A **failed upload saves the local copy** whatever the presenter chose, and
  retries the download if an earlier one failed.
- The **offscreen document closes only when idle**: no recording and no share
  job. `closeOffscreenIfIdle` and the camera-permission reset both ask the
  document (`offscreen-ping` → `busy`) before closing it. The job is registered
  in the same task that sends the `sharing` status, so the busy check that
  status triggers already sees it.
- **Start waits** ("Finishing your link…") while a job is open, so a new
  recording can't share the document with an upload.
- If the document dies anyway, the page notices after 90 s without progress and
  says so, instead of spinning forever.

### Uploading

`offscreen/uploader.ts` sends files up to 90 MiB in one request and larger ones
in 10 MiB parts, because Workers reject request bodies over 100 MB. It uses
`XMLHttpRequest`, the only browser API that reports upload progress. A stall
watchdog turns a silently dead connection into a `NETWORK` failure, parts retry
on network and 5xx errors, and an abandoned multipart upload is aborted.

Failures map to five codes, each with one message and one recovery:

| Code | Cause | What the extension does |
|---|---|---|
| `PAYMENT_REQUIRED` | 402: not subscribed (any more) | Saves locally, marks the session unpaid, shows Upgrade |
| `SIGNED_OUT` | 401: token invalid | Saves locally, signs out |
| `TOO_LARGE` | 413 | Saves locally |
| `NETWORK` | No response, or stalled | Saves locally |
| `SERVER` | Anything else | Saves locally |

### Copying the link

The page copies the link with `navigator.clipboard.writeText` as soon as it
exists, and the card shows "Link copied" with a short animation. Chrome only
allows that while the tab has focus. If the presenter has switched tabs, the
card says "Link ready" and the Copy button does it with a click.

The extension deliberately has no `clipboardWrite` permission. Copying from the
offscreen document would need it, and it adds a "Modify data you copy and
paste" install warning, which, on an update, disables the extension until the
user accepts.

## Links, everywhere they live

| Where | What | Who reads it |
|---|---|---|
| Server (`GET /api/links/list`) | Every live link for the email, from any device | Side panel when signed in; website `/view-my-links` |
| `capann_links` in `chrome.storage.local` | Links made or seen in this browser | Side panel when signed out or offline |

The side panel merges the server's list into the local history every time it
syncs, so the fallback gets better over time. Links are pruned at expiry.

**My links** opens the side panel on its Links tab. `chrome.sidePanel.open()`
must be called in response to a user gesture, and Chrome carries the gesture
from a content-script click into the worker's message handler only until the
first `await`. So `openSidePanel` (background/side-panel.ts) calls it
synchronously, after noting the tab in `chrome.storage.session`; if Chrome still
refuses, it opens `sidepanel.html#links` in a tab.

## Testing

```bash
cd apps/api && npx wrangler dev --port 8799 > .wrangler-dev.log 2>&1 &
cd ../.. && npm run test:premium
```

`premium-e2e.mjs` bundles `@capann/api-client` and `uploader.ts` for Node and runs them
against the real Worker: sign-in, the payment gate, single and multipart uploads
(byte-for-byte), part retries and abort, the link list, the rate limit, and
cancellation.

The UI needs a browser. Run the API, build the extension against it, load
`apps/extension/dist` unpacked, and run the website with that build's ID:

```bash
npm run api:dev -- --port 8799
npm run build:backend   # premium, pointed at 127.0.0.1:8799 and localhost:5173
VITE_CAPANN_EXTENSION_IDS=<unpacked id> npm run website:dev
```

Then check by hand: sign in from the Record view (the link is printed in
`apps/api/.wrangler-dev.log`), open it and press **Continue to Capann** on
`/verify`, upgrade (simulate the webhook as in `apps/api/scripts/e2e.mjs`, then
open `/upgraded`), record and stop, answer the dialog, open **My links**, and
use "Lost a link?" to reach `/view-my-links`.
