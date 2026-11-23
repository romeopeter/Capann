/**
 * @capann/contract
 *
 * Everything that crosses a boundary between Capann's pieces:
 *
 *   apps/extension  <── HTTP JSON ──>  apps/api  <── HTTP JSON ──  apps/website
 *   apps/website  ── chrome.runtime.sendMessage ──>  apps/extension
 *
 * Every side imports these definitions, so changing a shape on one side fails
 * the others' typecheck instead of shipping a mismatch. (The website is
 * JavaScript; its Premium code is checked against these types through JSDoc.)
 *
 * Rules: types and constants only, no runtime dependencies, and no DOM,
 * chrome, or Workers types (this package's tsconfig loads none), so the
 * browser, the extension, and the Worker can all import it.
 */

// ── Retention and size limits ─────────────────────────────────────────────

/** Shared recordings stay up this long; the API treats anything older as gone. */
export const RETENTION_SECONDS = 7 * 24 * 60 * 60;
export const RETENTION_DAYS = RETENTION_SECONDS / 86_400;

const MiB = 1024 * 1024;

/**
 * The API's default cap for one `POST /api/upload` body (the Worker's
 * `MAX_UPLOAD_BYTES` can lower it). Workers reject request bodies over 100 MB;
 * anything larger goes through the multipart routes.
 */
export const MAX_SINGLE_UPLOAD_BYTES = 95 * MiB;

/** The API's default cap on a whole recording (`MAX_RECORDING_BYTES`). */
export const MAX_RECORDING_BYTES = 2 * 1024 * MiB;

// ── Routes ────────────────────────────────────────────────────────────────

/** JSON routes. Errors from any of them are an `ApiErrorBody`. */
export const API_ROUTES = {
  magicLink: "/api/auth/magic-link",
  verify: "/api/auth/verify",
  session: "/api/auth/session",
  checkout: "/api/checkout",
  bachsWebhook: "/api/webhooks/bachs",
  upload: "/api/upload",
  multipart: "/api/upload/multipart",
  multipartComplete: "/api/upload/multipart/complete",
  links: "/api/links/list",
  health: "/health",
} as const;

/** `PUT` one part of a multipart upload (1-based). */
export function multipartPartRoute(partNumber: number): string {
  return `${API_ROUTES.multipart}/${partNumber}`;
}

/** Public playback of a recording: `/r/<uuid>.<ext>`. */
export const RECORDING_ROUTE_PREFIX = "/r/";

// ── Sign-in and link recovery ─────────────────────────────────────────────

/** What an emailed link is for. */
export type MagicLinkPurpose = "login" | "links";

/**
 * Website pages the emailed links open (`?token=…`). The API builds the links
 * from these, and the website routes them (apps/website/src/App.jsx).
 */
export const WEBSITE_PATHS: Record<MagicLinkPurpose, string> = {
  login: "/verify",
  links: "/view-my-links",
};

/** `POST /api/auth/magic-link` */
export interface MagicLinkRequest {
  email: string;
  purpose?: MagicLinkPurpose;
}
/** 202. The same answer whatever the address, so emails can't be probed. */
export interface MagicLinkResponse {
  sent: true;
}

/** `POST /api/auth/verify`: a login link's token, exchanged once. */
export interface VerifyRequest {
  token: string;
}

/** `POST /api/auth/verify` and `GET /api/auth/session`: a 30-day session. */
export interface SessionResponse {
  token: string;
  email: string;
  /** Whether the subscription was active when this token was issued. */
  paid: boolean;
  expiresAt: string;
}

/** `POST /api/checkout` */
export interface CheckoutResponse {
  url: string;
}

// ── Links and uploads ─────────────────────────────────────────────────────

/** A shared recording. Returned by both upload routes and listed by `/api/links/list`. */
export interface LinkInfo {
  id: string;
  url: string;
  /** Bytes. */
  size: number;
  uploadedAt: string;
  expiresAt: string;
}

export interface LinkListItem extends LinkInfo {
  remainingSeconds: number;
}

/** `GET /api/links/list`, newest first, expired links already removed. */
export interface LinkListResponse {
  email: string;
  /** Server time, so clients can correct countdowns for clock skew. */
  now: string;
  retentionSeconds: number;
  items: LinkListItem[];
}

/** `POST /api/upload/multipart` */
export interface MultipartCreateRequest {
  contentType: string;
}
/** 201. Parts and completion use `uploadToken`, not the session. */
export interface MultipartCreateResponse {
  uploadToken: string;
  /** Every part but the last must be exactly this many bytes. */
  partSize: number;
  maxParts: number;
  expiresAt: string;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** `POST /api/upload/multipart/complete` */
export interface MultipartCompleteRequest {
  parts: UploadedPart[];
}

// ── Errors ────────────────────────────────────────────────────────────────

/** Every error code the API sends. `message` alongside it is safe to show. */
export type ApiErrorCode =
  // 400
  | "EMPTY_BODY"
  | "INVALID_EMAIL"
  | "INVALID_JSON"
  | "INVALID_PART"
  | "INVALID_PARTS"
  | "INVALID_PURPOSE"
  | "UPLOAD_INCOMPLETE"
  // 401
  | "INVALID_SIGNATURE"
  | "INVALID_TOKEN"
  | "MISSING_TOKEN"
  | "TOKEN_EXPIRED"
  | "TOKEN_USED"
  | "WRONG_TOKEN"
  // 402
  | "PAYMENT_REQUIRED"
  // 404, 405, 409, 410, 411
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "UPLOAD_NOT_FOUND"
  | "LINK_EXPIRED"
  | "LENGTH_REQUIRED"
  // 413: too big; USE_MULTIPART means "retry with the multipart routes"
  | "BODY_TOO_LARGE"
  | "PART_TOO_LARGE"
  | "RECORDING_TOO_LARGE"
  | "USE_MULTIPART"
  // 415, 429
  | "UNSUPPORTED_TYPE"
  | "RATE_LIMITED"
  // 5xx
  | "CHECKOUT_NOT_CONFIGURED"
  | "INTERNAL"
  | "UPLOAD_FAILED"
  | "EMAIL_FAILED";

/** The body of every API error response. 429s also carry `Retry-After`. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

// ── Website → extension ───────────────────────────────────────────────────

export type Edition = "free" | "premium";

/**
 * Sent by the website with `chrome.runtime.sendMessage(extensionId, …)` from a
 * page on the origin the premium manifest lists in `externally_connectable`.
 */
export type WebsiteToExtensionMessage =
  | { kind: "capann-ping" }
  | { kind: "capann-session"; token: string }
  | { kind: "capann-refresh" };

export type ExtensionReplyFailure = { ok: false; error: string; retryAfter?: number };

/** Reply to `capann-ping`: whether (and which) Capann is installed. */
export type PingReply = { ok: true; edition: Edition; version: string } | ExtensionReplyFailure;

/** Reply to `capann-session`: the extension confirmed the token and stored it. */
export type SessionReply = { ok: true; email: string; paid: boolean } | ExtensionReplyFailure;

/** Reply to `capann-refresh`: `paid` re-checked (after checkout). */
export type RefreshReply = { ok: true; signedIn: boolean; paid: boolean } | ExtensionReplyFailure;

/** The reply type for a given website message. */
export type ReplyTo<M extends WebsiteToExtensionMessage> = M extends { kind: "capann-ping" }
  ? PingReply
  : M extends { kind: "capann-session" }
    ? SessionReply
    : RefreshReply;
