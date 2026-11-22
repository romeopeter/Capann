# Capann API (Cloudflare Worker)

The Premium backend: passwordless sign-in, Bachs subscriptions, recording
uploads to R2, link recovery, and public playback. There are no accounts,
profiles, or databases. A user is an email address, proven by short-lived
signed tokens. The only server state is:

- **KV** `sub:<email>` = `"active"` while a subscription is paid
- **R2** the recordings, plus a tiny per-owner index for link recovery
- **Durable Objects** strongly consistent counters for rate limits and single-use links

Free features (annotation, local recording) never touch this service.

## How the pieces connect

```
Extension ── POST /api/auth/magic-link ──► Worker ──► Resend ──► inbox
inbox link ─► website /verify ── POST /api/auth/verify ──► 30-day session token
website ── chrome.runtime.sendMessage(extensionId, { kind: "capann-session", token }) ──► extension

Extension ── POST /api/checkout (session) ──► { url } ──► Bachs checkout tab
Bachs ── POST /api/webhooks/bachs (signed) ──► KV sub:<email> = active
Extension ── GET /api/auth/session ──► token with paid: true

Extension ── POST /api/upload or /api/upload/multipart (session) ──► R2
          ◄── { url: https://<worker>/r/<uuid>.webm } ── copied to clipboard

inbox link ─► website /view-my-links ── GET /api/links/list ──► links + countdowns
anyone with the link ── GET /r/<uuid>.webm ──► video (Range supported), 410 after 7 days
```

## API

All bodies are JSON unless noted. Errors are
`{ "error": { "code": "…", "message": "…" } }` with a matching HTTP status;
`message` is safe to show to users.

| Method & path | Auth | Body → Response |
|---|---|---|
| `POST /api/auth/magic-link` | — | `{ email, purpose?: "login" \| "links" }` → `202 { sent: true }`. Emails `/verify?token=` (login) or `/view-my-links?token=` (links). Rate limited: 3 per email and 10 per IP per 15 min → `429` + `Retry-After` |
| `POST /api/auth/verify` | — | `{ token }` (login link token, single use) → `{ token, email, paid, expiresAt }` (30-day session) |
| `GET /api/auth/session` | session | → same shape, `paid` re-read from KV, **same expiry**. Call after checkout |
| `POST /api/checkout` | session | → `{ url }` Bachs checkout for the signed-in email |
| `POST /api/webhooks/bachs` | Bachs signature | Bachs event → `{ received, applied }` |
| `POST /api/upload` | session + paid | raw video body, `Content-Type: video/webm` or `video/mp4`, `Content-Length` required, ≤ `MAX_UPLOAD_BYTES` → `201 { id, url, size, uploadedAt, expiresAt }` |
| `POST /api/upload/multipart` | session + paid | `{ contentType }` → `201 { uploadToken, partSize, maxParts, expiresAt }` |
| `PUT /api/upload/multipart/:n` | upload token | raw bytes of part `n` (1-based). Every part except the last must be exactly `partSize` → `{ partNumber, etag }` |
| `POST /api/upload/multipart/complete` | upload token | `{ parts: [{ partNumber, etag }] }` → `201` same shape as `/api/upload` |
| `DELETE /api/upload/multipart` | upload token | abandon an upload → `204` |
| `GET /api/links/list` | links token or session | → `{ email, now, retentionSeconds, items: [{ id, url, size, uploadedAt, expiresAt, remainingSeconds }] }`, newest first |
| `GET\|HEAD /r/<uuid>.<ext>` | — (unguessable) | the video; `Range` → `206`; `410` once 7 days old |
| `GET /health` | — | `ok` |

"Auth" means `Authorization: Bearer <token>`. Tokens carry a purpose and are
only accepted where that purpose fits, so a login link can't act as a session,
and a recovery link can't upload.

| Token | Lifetime | Issued by | Used for |
|---|---|---|---|
| login | 15 min, single use | magic-link | `/api/auth/verify` |
| links | 15 min, reusable | magic-link (`purpose: "links"`) | `/api/links/list` |
| session | 30 days | verify | checkout, uploads, list, refresh |
| upload | 6 h | multipart create | parts, complete, abort for that one upload |

### Uploading from the extension

Recordings over ~95 MB must use multipart: Workers cap a request body at
100 MB on Free/Pro plans, which is roughly five minutes of 1080p. A simple rule
for the client: use `/api/upload` when the blob is under 90 MB, otherwise:

```
POST /api/upload/multipart {contentType}  → uploadToken, partSize
for each partSize slice i (1-based): PUT /api/upload/multipart/i  → {partNumber, etag}
POST /api/upload/multipart/complete {parts}  → {url}
(on failure: DELETE /api/upload/multipart)
```

Upload from the extension's offscreen document or service worker, not the
content script: extension pages are exempt from CORS for hosts in
`host_permissions`; content scripts are not.

## Setup and deploy

```bash
npm install          # at the repo root: one install for every workspace
cd apps/api
npx wrangler login

# 1. Storage
npx wrangler kv namespace create SUBSCRIPTIONS      # paste the id into wrangler.jsonc
npx wrangler r2 bucket create capann-recordings
npm run lifecycle:apply                             # 7-day expiry, see below

# 2. Secrets (prompted, never committed)
npx wrangler secret put JWT_SECRET                  # e.g. `openssl rand -base64 48`
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put BACHS_WEBHOOK_SECRET

# 3. Fill in wrangler.jsonc vars: SITE_URL, EMAIL_FROM, BACHS_CHECKOUT_URL,
#    ALLOWED_ORIGINS (add chrome-extension://<your extension id>)

npm run deploy
```

Then point Bachs' webhook at `https://<worker>/api/webhooks/bachs`, and verify
your sending domain in Resend so `EMAIL_FROM` is accepted.

Rotating `JWT_SECRET` signs everyone out. That's the only way to revoke
sessions, since tokens are stateless.

### R2 lifecycle (`r2-lifecycle.json`)

| Rule | Prefix | Action |
|---|---|---|
| `expire-recordings-7d` | `recordings/` | delete after 604,800 s (7 days); abort unfinished multipart uploads after 1 day |
| `expire-owner-index-7d` | `owners/` | delete index markers after 7 days |

There's no cron or cleanup Worker. R2 applies lifecycle rules asynchronously,
usually within a day of the threshold, so the Worker itself treats anything
older than 7 days as expired: `/r/…` returns `410`, and the list drops it. Links
stop working at exactly 7 days, even if the bytes linger a little longer.

Apply with `npm run lifecycle:apply`, or via the Cloudflare API
(`PUT /accounts/{account_id}/r2/buckets/capann-recordings/lifecycle` with the
same JSON). Check with `npx wrangler r2 bucket lifecycle list capann-recordings`.

## Local development and tests

```bash
cp .dev.vars.example .dev.vars        # console email, localhost site
npx wrangler dev --port 8799 > .wrangler-dev.log 2>&1 &
npm run test:e2e                      # 47 checks against local KV/R2/Durable Objects
npm run typecheck
```

With `EMAIL_TRANSPORT=console`, magic links are printed to the dev server's
output instead of emailed. Production uses `"resend"` from `wrangler.jsonc`.

## Confirm before launch

**Bachs.** I don't know Bachs' webhook format. Everything Bachs-specific is in
`src/bachs.ts`, with its assumptions listed at the top: the signature header
and encoding, the payload shape, and the event names. Check them against
Bachs' documentation, and check the `{email}` placeholder in
`BACHS_CHECKOUT_URL` against how Bachs pre-fills a customer's email. Until
then, treat the webhook as untested against the real processor.

**Email provider.** Resend is used because it's a single `fetch` call. Swapping
providers only touches `sendMagicLink` in `src/email.ts`.

## Where this departs from the original spec, and why

- **Uploads check KV, not only the token's `paid` claim.** A session lasts 30
  days, so a `paid: true` token would let a cancelled subscriber keep
  uploading for up to a month. KV is the source of truth; the claim is a UI
  hint, refreshed with `GET /api/auth/session`.
- **Link recovery lists a per-owner index, not the whole bucket.** Filtering
  `R2.list()` on `customMetadata.owner` means paging through *every* user's
  recordings on each request. Each upload also writes an empty marker under
  `owners/<sha256(email)>/`, so recovery lists only that prefix. Recordings
  still carry `customMetadata.owner` as specified.
- **Links are served by the Worker (`/r/<uuid>.webm`), not a public bucket.**
  This enforces the 7-day cutoff exactly, serves seekable `206` ranges, and
  keeps the bucket private. Object keys are still `recordings/<uuid>.webm`.
- **Rate limits use a Durable Object, not KV.** KV is eventually consistent and
  has no atomic increment, so a burst of requests could exceed "max 3".
  A per-IP cap of 10 per 15 minutes was added: a per-email limit alone still
  lets one client email thousands of different addresses.
- **Tokens are signed (HS256), not encrypted.** They hold only the email, a
  paid flag, and an expiry, all of which their holder already knows.
- **Multipart upload** was added alongside `/api/upload` because of the 100 MB
  request cap.

## Notes for the website and extension work

- **`/verify`**: email security scanners can open links before the user does.
  Have the page exchange the token on a button click ("Continue to Capann")
  rather than on load, or a scanner can spend the single-use token.
- **Token hand-off** (implemented in the extension, `src/background/premium.ts`):
  send `{ kind: "capann-session", token }` with
  `chrome.runtime.sendMessage(extensionId, …)`. The premium build lists
  `siteUrl` under `externally_connectable`, and only that origin is accepted.
  The reply is `{ ok: true, email, paid }` or `{ ok: false, error }`.
  `{ kind: "capann-ping" }` → `{ ok, edition, version }` detects the extension;
  `{ kind: "capann-refresh" }` re-checks `paid` after checkout.
- **The extension needs the Worker's origin** in `host_permissions`. Capann
  already has `<all_urls>`. Its client is `@capann/api-client`
  (`packages/api-client`) plus `apps/extension/src/offscreen/uploader.ts`;
  `npm run test:premium` (from the repo root) runs them against `wrangler dev`.

## The shared contract

Every request and response shape, error code, route path, and limit lives in
`@capann/contract` (`packages/contract/src/index.ts`), which both this Worker
and the extension import. Responses here are checked with
`satisfies <ContractType>`, and `HttpError` accepts only an `ApiErrorCode`, so a
change on one side breaks the others' typecheck (the extension's, and the
website's Premium helpers in `apps/website/src/premium/`). Change the contract
first.

## Files

```
src/index.ts           router, CORS, error handling
src/env.ts             bindings, vars, and secrets
src/tokens.ts          token purposes, lifetimes, issue/verify
src/jwt.ts             HS256 on Web Crypto
src/rate-limiter.ts    Durable Object: sliding-window limits, single-use claims
src/email.ts           email normalization, magic-link email (Resend)
src/subscriptions.ts   KV subscription state
src/bachs.ts           Bachs signature + event parsing (assumptions inside)
src/storage.ts         R2 key layout, retention, index
src/routes/            auth, billing, upload, links, media handlers
r2-lifecycle.json      7-day expiry rules
scripts/e2e.mjs        end-to-end test against wrangler dev

../../packages/contract   shared shapes, codes, routes, limits (imported as @capann/contract)
```
