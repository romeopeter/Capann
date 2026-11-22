import type { ApiErrorBody, ApiErrorCode } from "@capann/contract";
import type { Env } from "./env";

/** Thrown by handlers; the router turns it into a JSON error response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    /** Only codes clients know about (@capann/contract). */
    readonly code: ApiErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function errorResponse(error: HttpError): Response {
  return json(
    { error: { code: error.code, message: error.message } } satisfies ApiErrorBody,
    error.status,
    error.headers,
  );
}

const MAX_JSON_BYTES = 16 * 1024;

/** Parse a small JSON object body. Rejects anything that is not an object. */
export async function readJson(
  request: Request,
  maxBytes = MAX_JSON_BYTES,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes)
    throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
  const text = await request.text();
  if (text.length > maxBytes)
    throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new HttpError(400, "INVALID_JSON", "Request body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1]! : null;
}

function allowedOrigins(env: Env): Set<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(env.SITE_URL).origin);
  } catch {
    // A malformed SITE_URL simply allows no website origin.
  }
  for (const origin of (env.ALLOWED_ORIGINS ?? "").split(",")) {
    const trimmed = origin.trim();
    if (trimmed) origins.add(trimmed);
  }
  return origins;
}

/**
 * CORS for the website and the extension. Only listed origins get headers;
 * everything else is left to the browser's same-origin policy. The extension's
 * service worker and offscreen document are CORS-exempt for hosts in its
 * `host_permissions`, so listing its origin only matters for extension pages.
 */
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-expose-headers": "Retry-After, Content-Range, Content-Length",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
