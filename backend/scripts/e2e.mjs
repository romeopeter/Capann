// End-to-end check against `wrangler dev` (local KV/R2/DO, console email).
//
//   cp .dev.vars.example .dev.vars
//   npx wrangler dev --port 8799 > .wrangler-dev.log 2>&1 &
//   npm run test:e2e
//
// Magic links are read from the dev server's log (EMAIL_TRANSPORT=console).
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";

const BASE = "http://127.0.0.1:8799";
const LOG = process.env.CAPANN_DEV_LOG ?? new URL("../.wrangler-dev.log", import.meta.url).pathname;
const SECRET = "local-dev-webhook-secret";
const email = `Tester+${randomUUID().slice(0, 8)}@Example.com`;
const normalized = email.toLowerCase();
let failures = 0;
const ok = (cond, msg, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
};
const call = async (method, path, { token, json, body, headers = {} } = {}) => {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (json !== undefined) h["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers, text };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function linkFromLog(kind) {
  for (let i = 0; i < 40; i++) {
    const lines = readFileSync(LOG, "utf8").split("\n").filter((l) => l.includes(`${kind} link for ${normalized}`));
    if (lines.length) return lines.at(-1).split(": ").at(-1).trim();
    await sleep(250);
  }
  throw new Error(`no ${kind} link in log`);
}
const webhook = (payload, secret = SECRET) => {
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  return call("POST", "/api/webhooks/bachs", { body: raw, headers: { "content-type": "application/json", "x-bachs-signature": sig } });
};

// --- Auth
let r = await call("POST", "/api/auth/magic-link", { json: { email: "not-an-email" } });
ok(r.status === 400 && r.data.error.code === "INVALID_EMAIL", "rejects invalid email");
r = await call("POST", "/api/auth/magic-link", { json: { email } });
ok(r.status === 202, "magic link accepted", r.status);
const loginLink = await linkFromLog("login");
ok(loginLink.startsWith("http://localhost:5173/verify?token="), "login link points at /verify");
const loginToken = new URL(loginLink).searchParams.get("token");

r = await call("POST", "/api/auth/verify", { json: { token: loginToken } });
ok(r.status === 200 && r.data.email === normalized && r.data.paid === false && r.data.token, "verify -> session (unpaid, normalized email)", JSON.stringify(r.data).slice(0, 80));
let session = r.data.token;
const firstExpiry = r.data.expiresAt;
const days = (Date.parse(firstExpiry) - Date.now()) / 86400000;
ok(days > 29.9 && days <= 30, "session lasts 30 days", days.toFixed(3));

r = await call("POST", "/api/auth/verify", { json: { token: loginToken } });
ok(r.status === 401 && r.data.error.code === "TOKEN_USED", "login link is single-use");

r = await call("POST", "/api/auth/verify", { json: { token: session } });
ok(r.status === 401 && r.data.error.code === "WRONG_TOKEN", "session token rejected as login token");

const [h, p, s] = session.split(".");
const forged = JSON.parse(Buffer.from(p, "base64url").toString());
forged.paid = true;
const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${s}`;
r = await call("GET", "/api/auth/session", { token: tampered });
ok(r.status === 401 && r.data.error.code === "INVALID_TOKEN", "tampered token rejected");
const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
r = await call("GET", "/api/auth/session", { token: `${noneHeader}.${p}.` });
ok(r.status === 401, "alg:none token rejected");

// --- Billing gate
const tinyWebm = Buffer.from("1a45dfa3", "hex");
r = await call("POST", "/api/upload", { token: session, body: tinyWebm, headers: { "content-type": "video/webm" } });
ok(r.status === 402 && r.data.error.code === "PAYMENT_REQUIRED", "unpaid upload -> 402");

r = await call("POST", "/api/checkout", { token: session });
ok(r.status === 200 && r.data.url.includes(encodeURIComponent(normalized)), "checkout URL carries the email", r.data.url);

r = await webhook({ type: "subscription.activated", data: { customer: { email } } }, "wrong-secret");
ok(r.status === 401 && r.data.error.code === "INVALID_SIGNATURE", "webhook with bad signature rejected");
r = await webhook({ type: "invoice.created", data: { customer: { email } } });
ok(r.status === 200 && r.data.applied === false, "unrelated event acknowledged, ignored");
const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
r = await webhook({ type: "subscription.activated", data: { customer: { email }, current_period_end: periodEnd } });
ok(r.status === 200 && r.data.applied === true, "activation webhook applied");

r = await call("GET", "/api/auth/session", { token: session });
ok(r.status === 200 && r.data.paid === true && r.data.expiresAt === firstExpiry, "refresh: paid=true, same expiry", r.data.expiresAt);
session = r.data.token;

// --- Single upload
r = await call("POST", "/api/upload", { token: session, body: tinyWebm, headers: { "content-type": "text/html" } });
ok(r.status === 415, "non-video upload rejected", r.status);
const video = Buffer.alloc(300_000, 7);
video.write("1a45dfa3", 0, "hex");
r = await call("POST", "/api/upload", { token: session, body: video, headers: { "content-type": "video/webm;codecs=vp9,opus" } });
ok(r.status === 201 && /\/r\/[0-9a-f-]{36}\.webm$/.test(r.data.url) && r.data.size === video.length, "single upload -> 201 link", r.data.url);
const single = r.data;
const expiresIn = (Date.parse(single.expiresAt) - Date.parse(single.uploadedAt)) / 86400000;
ok(expiresIn === 7, "link expires 7 days after upload", expiresIn);

let res = await fetch(single.url);
let buf = Buffer.from(await res.arrayBuffer());
ok(res.status === 200 && buf.equals(video) && res.headers.get("content-type") === "video/webm", "GET link returns the exact bytes as video/webm");
ok(res.headers.get("x-content-type-options") === "nosniff" && res.headers.get("accept-ranges") === "bytes", "playback headers set");
res = await fetch(single.url, { headers: { range: "bytes=100-199" } });
buf = Buffer.from(await res.arrayBuffer());
ok(res.status === 206 && res.headers.get("content-range") === `bytes 100-199/${video.length}` && buf.equals(video.subarray(100, 200)), "Range -> 206 with correct slice", res.headers.get("content-range"));
res = await fetch(single.url, { headers: { range: "bytes=-50" } });
buf = Buffer.from(await res.arrayBuffer());
ok(res.status === 206 && res.headers.get("content-range") === `bytes ${video.length - 50}-${video.length - 1}/${video.length}` && buf.length === 50, "suffix Range -> 206", res.headers.get("content-range"));
res = await fetch(single.url, { method: "HEAD" });
ok(res.status === 200 && res.headers.get("content-length") === String(video.length), "HEAD returns length");
res = await fetch(single.url, { headers: { "if-none-match": res.headers.get("etag") } });
ok(res.status === 304, "If-None-Match -> 304", res.status);
res = await fetch(`${BASE}/r/${randomUUID()}.webm`);
ok(res.status === 404, "unknown id -> 404");
res = await fetch(`${BASE}/r/../owners/x`);
ok(res.status === 404, "path tricks -> 404", res.status);

// --- Multipart
r = await call("POST", "/api/upload/multipart", { token: session, json: { contentType: "video/webm" } });
ok(r.status === 201 && r.data.uploadToken && r.data.partSize === 10 * 1024 * 1024, "multipart create", r.status);
const { uploadToken, partSize } = r.data;
r = await call("POST", "/api/upload", { token: uploadToken, body: tinyWebm, headers: { "content-type": "video/webm" } });
ok(r.status === 401 && r.data.error.code === "WRONG_TOKEN", "upload token can't do single uploads");
const big = Buffer.alloc(partSize + 123_456);
for (let i = 0; i < big.length; i += 4096) big[i] = (i / 4096) & 0xff;
const parts = [];
for (let n = 1, off = 0; off < big.length; n++, off += partSize) {
  r = await call("PUT", `/api/upload/multipart/${n}`, { token: uploadToken, body: big.subarray(off, off + partSize) });
  ok(r.status === 200 && r.data.etag, `part ${n} uploaded`, r.status);
  parts.push(r.data);
}
r = await call("PUT", "/api/upload/multipart/0", { token: uploadToken, body: tinyWebm });
ok(r.status === 400, "part 0 rejected");
r = await call("POST", "/api/upload/multipart/complete", { token: uploadToken, json: { parts: [...parts].reverse() } });
ok(r.status === 201 && r.data.size === big.length, "multipart complete -> link", JSON.stringify(r.data).slice(0, 90));
const multi = r.data;
res = await fetch(multi.url);
buf = Buffer.from(await res.arrayBuffer());
ok(res.status === 200 && buf.equals(big), "multipart object round-trips byte-for-byte", buf.length);

// --- Link recovery
r = await call("GET", "/api/links/list", { token: session });
ok(r.status === 200 && r.data.items.length === 2, "session can list own links", r.data.items?.length);
r = await call("POST", "/api/auth/magic-link", { json: { email, purpose: "links" } });
ok(r.status === 202, "links email accepted (2nd email this window)");
const linksLink = await linkFromLog("links");
ok(linksLink.startsWith("http://localhost:5173/view-my-links?token="), "recovery link points at /view-my-links");
const linksToken = new URL(linksLink).searchParams.get("token");
r = await call("GET", "/api/links/list", { token: linksToken });
const items = r.data.items ?? [];
ok(r.status === 200 && items.length === 2 && items.every((i) => i.remainingSeconds > 7 * 86400 - 120), "recovery token lists 2 links with ~7d left");
ok(items[0].id === multi.id, "newest first");
r = await call("GET", "/api/links/list", { token: linksToken });
ok(r.status === 200, "recovery token reusable for page reloads");
r = await call("POST", "/api/upload", { token: linksToken, body: tinyWebm, headers: { "content-type": "video/webm" } });
ok(r.status === 401, "recovery token can't upload");

// Another user's view is empty.
r = await call("POST", "/api/auth/magic-link", { json: { email: `other-${randomUUID().slice(0, 6)}@example.com`, purpose: "login" } });
ok(r.status === 202, "other user email accepted");

// --- Rate limit: 3 per email per 15 min (2 used)
r = await call("POST", "/api/auth/magic-link", { json: { email } });
ok(r.status === 202, "3rd email allowed");
r = await call("POST", "/api/auth/magic-link", { json: { email: email.toUpperCase() } });
ok(r.status === 429 && Number(r.headers.get("retry-after")) > 800, "4th email -> 429 (case-insensitive)", r.headers.get("retry-after"));

// --- Cancellation
r = await webhook({ type: "subscription.cancelled", data: { customer: { email } } });
ok(r.status === 200 && r.data.applied, "cancel webhook applied");
r = await call("POST", "/api/upload", { token: session, body: tinyWebm, headers: { "content-type": "video/webm" } });
ok(r.status === 402, "upload refused after cancel even with paid=true token", r.status);

// --- CORS
res = await fetch(`${BASE}/api/links/list`, { method: "OPTIONS", headers: { origin: "http://localhost:5173", "access-control-request-method": "GET" } });
ok(res.status === 204 && res.headers.get("access-control-allow-origin") === "http://localhost:5173", "CORS preflight for site origin");
res = await fetch(`${BASE}/api/links/list`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
ok(!res.headers.get("access-control-allow-origin"), "no CORS for unknown origin");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
