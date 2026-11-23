# Premium backend

Premium turns a local recording into a shareable link. That needs a server, and
it lives in `apps/api/`: a Cloudflare Worker that is its own workspace in the
monorepo — its own `package.json`, `tsconfig.json`, and tests. It shares no
runtime code with the extension. What the two must agree on (request and
response shapes, error codes, route paths, limits) lives in `@capann/contract`
(`packages/contract`), which both import.

This note explains how the backend is designed and why. For setup, deploy
commands, and the full route table, see [`apps/api/README.md`](../apps/api/README.md).

> **Status:** the Worker, the extension client, and the website's Premium pages
> (`apps/website`) are built and pass end-to-end suites locally, including the
> real sign-in hand-off between the three ([Premium share links](premium.md)
> covers the extension). The Bachs webhook format is unverified (see
> [Open items](#open-items)).

## No accounts, by design

There is no user table, no password, no profile. **A user is an email
address**, and every request proves ownership of one with a signed token. The
only server-side state is:

| What | Where | Written by |
|---|---|---|
| Is this email paying? | KV `sub:<email>` = `"active"` | Bachs webhook only |
| Recordings | R2 `recordings/<uuid>.<ext>` | uploads |
| Which recordings are whose | R2 `owners/<sha256(email)>/<uuid>.<ext>` (empty markers) | uploads |
| Rate-limit counters, used login links | `RateLimiter` Durable Object | magic-link, verify |

Everything else — who is signed in, for how long, whether they paid at sign-in —
travels inside tokens. That keeps the backend small, but it has a cost covered
under [Tokens](#tokens): a stateless token can't be revoked individually.

## Choosing a store: consistency is the deciding factor

Cloudflare offers several storage products; each piece of state went where its
consistency needs fit.

| Store | Consistency | Good for | Used here for |
|---|---|---|---|
| **KV** | Eventually consistent: a write can take ~60 s to reach every location. No atomic increment | Read-heavy values that change rarely | Subscription status |
| **Durable Object** | One instance per key, one request at a time, strongly consistent storage | Counters and "only once" decisions | Rate limits, single-use links |
| **R2** | Strongly consistent object storage, pay per operation | Large blobs, prefix listing | Recordings, owner index |

The rate limiter is the clearest example. "Max 3 emails per 15 minutes" in KV
would be read-count, then write-count+1: two simultaneous requests both read 2
and both send. A Durable Object processes one request at a time for a given key,
so the check and the increment can't interleave. The same property makes a
login link single-use: claiming its id is a rate limit of 1.

Subscription status tolerates KV's lag: a brand-new subscriber may read as
unpaid for up to a minute. That's an acceptable trade for KV's cheap, fast reads.

## Tokens

All tokens are HS256 JWTs signed with one secret (`JWT_SECRET`) using Web
Crypto (`apps/api/src/jwt.ts`). Each carries a **purpose** claim, and each route
accepts only specific purposes — this is the main defense against a token being
used somewhere it wasn't meant for.

| Purpose | Lifetime | Accepted by | Notes |
|---|---|---|---|
| `login` | 15 min, single use | `POST /api/auth/verify` | Emailed as `/verify?token=` |
| `links` | 15 min, reusable | `GET /api/links/list` | Emailed as `/view-my-links?token=`; reusable so the page can reload |
| `session` | 30 days | checkout, uploads, list, refresh | Matches the billing cycle; carries `paid` |
| `upload` | 6 h | multipart part / complete / abort | Bound to one R2 upload id |

Rules worth knowing:

- **Signed, not encrypted.** Anyone holding a token can read it (email, paid,
  expiry). That's fine: only its owner holds it. Integrity is what's protected —
  a tampered or `alg: none` token fails verification, because verification
  compares the header verbatim and the signature in constant time.
- **The `paid` claim is a hint, never an authorization.** A session lives 30
  days, so a cancelled subscriber's token still says `paid: true`. Uploads
  re-read KV every time. The claim exists so the UI can show Premium state
  without a request, and `GET /api/auth/session` refreshes it after checkout.
- **Refreshing doesn't extend a session.** It re-reads `paid` and keeps the
  original expiry, so a stolen token can't be renewed forever.
- **Revocation is all-or-nothing.** Rotating `JWT_SECRET` signs everyone out.
  There is no per-user revoke, which is the price of having no session store.

## The flows

### Sign-in

1. The extension sends `POST /api/auth/magic-link { email }`.
2. The Worker normalizes the email (trim, lowercase — one person must always be
   one string), checks the per-IP and per-email limits, signs a `login` token,
   and emails `${SITE_URL}/verify?token=…` through Resend.
3. The website's `/verify` page posts the token to `/api/auth/verify`. The
   Worker claims the token's id in the Durable Object (second use → 401) and
   returns a 30-day `session` token with `paid` read from KV.
4. The website hands the session token to the extension.

The response to step 1 is the same for every address, so the endpoint can't be
used to probe which emails are customers.

### Upgrade

`POST /api/checkout` (session) returns the Bachs checkout URL with the email
filled in. Requiring a session means the paid address is one the user has
proven they own — the same address the webhook will mark paid. Bachs then calls
`POST /api/webhooks/bachs`; the Worker verifies the HMAC signature over the
**raw** body (parsing first would change the bytes) and writes
`sub:<email>`. Writes are idempotent, so retried deliveries are harmless.

When Bachs reports a period end, the KV key is given an expiration of period
end + 3 days. A missed cancellation webhook then can't grant access forever. A
cancellation with time left keeps access until the period ends.

### Upload

Two paths, both streaming straight into R2 without buffering in the Worker:

- **`POST /api/upload`** — the whole file in one request. Workers cap a request
  body at **100 MB** on Free/Pro plans, roughly five minutes of 1080p.
- **Multipart** — create (returns an `upload` token), `PUT` 10 MiB parts,
  complete. Each part is its own request under the cap, so recordings up to
  `MAX_RECORDING_BYTES` (2 GiB) work. R2 requires every part but the last to be
  the same size, and abandoned uploads are cleaned up by the lifecycle rule.

R2 needs to know a stream's length up front, so uploads must send
`Content-Length`. Only `video/webm` and `video/mp4` are accepted; that
allowlist is also what makes serving the files back safe.

### Link recovery

`POST /api/auth/magic-link { email, purpose: "links" }` emails
`/view-my-links?token=…`. The page calls `GET /api/links/list`, which lists
**one prefix**: `owners/<sha256(email)>/`. Each upload writes an empty marker
there with the size and upload time in its metadata.

The obvious alternative — list the whole bucket and filter on
`customMetadata.owner` — pages through *every* user's recordings on every
request, 1,000 objects per call. The index makes recovery cost proportional to
one user's links. It's hashed so object keys don't contain emails.

### Playback

Links look like `https://<worker>/r/<uuid>.webm` and are served by the Worker,
not a public bucket:

- **Unguessable.** The id is a v4 UUID from a CSPRNG (122 random bits), and the
  URL says nothing about who uploaded it.
- **Exact expiry.** See below.
- **Seekable.** The Worker forwards `Range` to R2 and answers `206` with
  `Content-Range`, which video players need to seek.

## Retention: two mechanisms on purpose

Recordings live 7 days. Two things enforce that, and both are needed:

1. **R2 lifecycle rules** (`apps/api/r2-lifecycle.json`) delete `recordings/` and
   `owners/` objects after 604,800 seconds. No cron, no cleanup Worker. But R2
   applies rules asynchronously — deletion can lag by up to about a day.
2. **The Worker checks age itself.** Playback returns `410 Gone` and the list
   drops anything uploaded more than 7 days ago, so links die at exactly 7 days
   even while the bytes still exist.

Lifecycle handles cost; the Worker handles correctness. Removing either one
breaks a promise: storage grows forever, or links outlive their countdown.

## Abuse and cost controls

| Risk | Control |
|---|---|
| Spamming someone's inbox | 3 magic-link emails per address per 15 min (Durable Object, case-insensitive) |
| One client emailing thousands of addresses | 10 magic-link emails per IP per 15 min |
| Replaying a login link | Single use, 15-minute lifetime |
| Forged webhook marking an email paid | HMAC signature over the raw body |
| Guessing someone's links | Random v4 UUIDs; no listing without a token |
| Serving arbitrary content from our domain | Upload allowlist (`video/webm`, `video/mp4`), `nosniff` |
| Unknown websites calling the API | CORS only for `SITE_URL` and `ALLOWED_ORIGINS` |

The extension itself doesn't need CORS: its service worker and offscreen
document are exempt for hosts in `host_permissions`. Content scripts are not,
so uploads must come from the offscreen document or service worker.

## Rules when changing the backend

1. **Authorize Premium actions from KV**, never from a token's `paid` claim.
2. **Give every new token a purpose** and accept only the purposes a route needs.
3. **Anything that serves or lists a recording checks the 7-day cutoff.**
   Lifecycle deletion alone is not on time.
4. **Public URLs contain only `<uuid>.<ext>`** — no email, no hash, no index key.
5. **Counters and once-only decisions go in the Durable Object**, not KV.
6. **A change to a request or response shape is a contract change.** Change
   `@capann/contract` first; the extension and the website then fail to
   typecheck until they are updated in the same change. Update
   `apps/api/README.md` too.
7. **Keep processor-specific code in `apps/api/src/bachs.ts`**, so swapping or
   fixing the payment integration touches one file.

## Testing

```bash
cd apps/api
npm run typecheck
cp .dev.vars.example .dev.vars
npx wrangler dev --port 8799 > .wrangler-dev.log 2>&1 &
npm run test:e2e
```

`wrangler dev` runs the Worker against local KV, R2, and Durable Objects. With
`EMAIL_TRANSPORT=console` magic links are printed to the log, and the suite
reads them from there. It covers sign-in, single-use links, forged tokens, the
payment gate, webhooks, both upload paths (byte-for-byte with Range reads),
recovery, the rate limit, cancellation, and CORS. It does **not** cover the
7-day cutoff (time can't be fast-forwarded) or the per-IP limit.

## Open items

- **Bachs is unverified.** The signature header and encoding, payload shape, and
  event names in `apps/api/src/bachs.ts` are assumptions listed at the top of the
  file. Confirm them against Bachs' documentation before launch, along with the
  `{email}` placeholder in `BACHS_CHECKOUT_URL`.
- **The website's production config.** `apps/website/.env.production` (gitignored)
  needs the Chrome Web Store extension ID in `VITE_CAPANN_EXTENSION_IDS` before
  sign-in can hand off a session in production, and `VITE_CAPANN_INSTALL_URL`
  once the listing exists.
- **Not deployed.** Nothing has run against real Cloudflare, Resend, or Bachs.
