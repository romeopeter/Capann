// End-to-end check of the extension's Premium client code against the real
// Worker running locally. Exercises src/shared/premium/api.ts and
// src/offscreen/uploader.ts (single + multipart, retries, error mapping) with
// a fetch transport in place of XMLHttpRequest.
//
//   cd backend && npx wrangler dev --port 8799 > .wrangler-dev.log 2>&1 &
//   node scripts/premium-e2e.mjs
//
// Needs backend/.dev.vars from .dev.vars.example (console email transport).
import { build } from "esbuild";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = process.env.CAPANN_API ?? "http://127.0.0.1:8799";
const LOG = process.env.CAPANN_DEV_LOG ?? path.join(root, "backend/.wrangler-dev.log");
const WEBHOOK_SECRET = "local-dev-webhook-secret";

// Bundle the client modules for Node.
const dir = mkdtempSync(path.join(tmpdir(), "capann-premium-e2e-"));
const bundle = path.join(dir, "client.mjs");
await build({
  stdin: {
    contents: `
      export * from "./src/shared/premium/api.ts";
      export * from "./src/offscreen/uploader.ts";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundle,
  logLevel: "error",
  define: {
    __CAPANN_EDITION__: '"premium"',
    __CAPANN_API_URL__: JSON.stringify(API),
    __CAPANN_SITE_URL__: '"http://localhost:5173"',
  },
});
const client = await import(pathToFileURL(bundle).href);
rmSync(dir, { recursive: true, force: true });
const {
  ApiError,
  getSession,
  listLinks,
  requestMagicLink,
  shareErrorCode,
  startCheckout,
  uploadRecording,
} = client;

let failures = 0;
const ok = (cond, msg, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}${extra !== "" ? `  (${extra})` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The uploader's transport contract, over fetch (no upload progress events). */
const calls = [];
const fetchTransport = async ({ method, url, headers, body, onProgress }) => {
  calls.push(`${method} ${new URL(url).pathname}`);
  let response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch {
    throw new ApiError(0, "NETWORK", "connection failed");
  }
  if (body && typeof body !== "string") onProgress?.(body.size);
  return {
    status: response.status,
    text: await response.text(),
    retryAfter: Number(response.headers.get("retry-after")) || undefined,
  };
};

const email = `ext+${randomUUID().slice(0, 8)}@example.com`;
async function linkFromLog(kind) {
  for (let i = 0; i < 40; i++) {
    const line = readFileSync(LOG, "utf8")
      .split("\n")
      .filter((l) => l.includes(`${kind} link for ${email}`))
      .at(-1);
    if (line) return new URL(line.split(": ").at(-1).trim());
    await sleep(250);
  }
  throw new Error(`no ${kind} link in ${LOG}`);
}
// A cancellation without a period end revokes access at once (a period end in
// the future would keep it until then; see backend/src/subscriptions.ts).
const webhook = (type, periodEnd) => {
  const raw = JSON.stringify({
    type,
    data: { customer: { email }, ...(periodEnd ? { current_period_end: periodEnd } : {}) },
  });
  return fetch(`${API}/api/webhooks/bachs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bachs-signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"),
    },
    body: raw,
  });
};
const video = (size, seed) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 997) bytes[i] = (i / 997 + seed) & 0xff;
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  return new Blob([bytes], { type: "video/webm;codecs=vp9,opus" });
};
const sameBytes = async (url, blob) => {
  const served = Buffer.from(await (await fetch(url)).arrayBuffer());
  return served.equals(Buffer.from(await blob.arrayBuffer()));
};

// ── Sign-in (the extension asks for the email; the website does /verify) ──
ok((await requestMagicLink(API, email, "login")).sent === true, "magic link requested");
const loginToken = (await linkFromLog("login")).searchParams.get("token");
const verified = await (
  await fetch(`${API}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: loginToken }),
  })
).json();
let session = await getSession(API, verified.token);
ok(session.email === email && session.paid === false, "getSession: signed in, unpaid");

try {
  await requestMagicLink(API, "nope", "login");
  ok(false, "invalid email rejected");
} catch (error) {
  ok(error instanceof ApiError && error.status === 400, "invalid email -> ApiError 400", error.code);
}

// ── Unpaid upload falls back ──
try {
  await uploadRecording({
    apiUrl: API,
    token: session.token,
    blob: video(2048, 1),
    onProgress: () => {},
    transport: fetchTransport,
  });
  ok(false, "unpaid upload refused");
} catch (error) {
  ok(shareErrorCode(error) === "PAYMENT_REQUIRED", "unpaid upload -> PAYMENT_REQUIRED");
}
const checkout = await startCheckout(API, session.token);
ok(checkout.url.includes(encodeURIComponent(email)), "startCheckout returns the Bachs URL");

// ── Pay, refresh ──
ok(
  (await webhook("subscription.activated", Math.floor(Date.now() / 1000) + 30 * 86400)).ok,
  "activation webhook",
);
session = await getSession(API, session.token);
ok(session.paid === true, "getSession after payment: paid");

// ── Single upload ──
const small = video(300_000, 2);
const progress = [];
const single = await uploadRecording({
  apiUrl: API,
  token: session.token,
  blob: small,
  onProgress: (loaded, total) => progress.push([loaded, total]),
  transport: fetchTransport,
});
ok(/\/r\/[0-9a-f-]{36}\.webm$/.test(single.url) && single.size === small.size, "single upload -> link", single.url);
ok(progress.at(-1)?.[0] === small.size, "single upload reports full progress");
ok(await sameBytes(single.url, small), "single upload round-trips byte-for-byte");

// ── Multipart (forced with a low single-upload limit) ──
calls.length = 0;
const big = video(10 * 1024 * 1024 + 777_777, 3);
const partProgress = [];
const multi = await uploadRecording({
  apiUrl: API,
  token: session.token,
  blob: big,
  singleLimit: 1024 * 1024,
  onProgress: (loaded) => partProgress.push(loaded),
  transport: fetchTransport,
});
ok(
  calls.join(",") ===
    "POST /api/upload/multipart,PUT /api/upload/multipart/1,PUT /api/upload/multipart/2,POST /api/upload/multipart/complete",
  "multipart: create, 2 parts, complete",
  calls.join(","),
);
ok(multi.size === big.size && (await sameBytes(multi.url, big)), "multipart round-trips byte-for-byte");
ok(
  partProgress.every((v, i) => i === 0 || v >= partProgress[i - 1]) && partProgress.at(-1) === big.size,
  "multipart progress is monotonic and ends at the size",
);

// ── Multipart part failure: retries, then aborts the upload ──
calls.length = 0;
let failPart2 = 0;
const flaky = async (request) => {
  if (request.url.endsWith("/multipart/2")) {
    failPart2++;
    calls.push(`${request.method} ${new URL(request.url).pathname} (dropped)`);
    throw new ApiError(0, "NETWORK", "dropped");
  }
  return fetchTransport(request);
};
try {
  await uploadRecording({
    apiUrl: API,
    token: session.token,
    blob: big,
    singleLimit: 1024 * 1024,
    onProgress: () => {},
    transport: flaky,
  });
  ok(false, "dropped part fails the upload");
} catch (error) {
  ok(shareErrorCode(error) === "NETWORK", "dropped part -> NETWORK");
  ok(failPart2 === 3, "part retried 3 times", failPart2);
  ok(calls.at(-1) === "DELETE /api/upload/multipart", "abandoned upload is aborted", calls.at(-1));
}

// ── Link list (what the side panel shows) ──
const list = await listLinks(API, session.token);
ok(list.items.length === 2 && list.items[0].id === multi.id, "listLinks: both links, newest first");
ok(list.items.every((item) => item.remainingSeconds > 7 * 86400 - 300), "listLinks: ~7 days left each");

// ── Recovery email + rate limit with Retry-After ──
ok((await requestMagicLink(API, email, "links")).sent === true, "recovery email (2nd this window)");
ok((await linkFromLog("links")).pathname === "/view-my-links", "recovery link points at /view-my-links");
await requestMagicLink(API, email, "login");
try {
  await requestMagicLink(API, email, "login");
  ok(false, "4th email rate limited");
} catch (error) {
  ok(error instanceof ApiError && error.status === 429 && error.retryAfter > 0, "4th email -> 429 with retryAfter", error.retryAfter);
}

// ── Bad token, cancellation ──
try {
  await uploadRecording({ apiUrl: API, token: "x.y.z", blob: small, onProgress: () => {}, transport: fetchTransport });
  ok(false, "bad token refused");
} catch (error) {
  ok(shareErrorCode(error) === "SIGNED_OUT", "bad token -> SIGNED_OUT");
}
ok((await webhook("subscription.cancelled")).ok, "cancel webhook");
try {
  await uploadRecording({ apiUrl: API, token: session.token, blob: small, onProgress: () => {}, transport: fetchTransport });
  ok(false, "upload after cancel refused");
} catch (error) {
  ok(shareErrorCode(error) === "PAYMENT_REQUIRED", "upload after cancel -> PAYMENT_REQUIRED (paid=true token)");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
