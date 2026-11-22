import type { Env } from "../env";
import { HttpError } from "../http";
import { expiresAtMs, parseRecordingName, recordingKey } from "../storage";

function gone(): HttpError {
  return new HttpError(410, "LINK_EXPIRED", "This recording has expired.");
}

function notFound(): HttpError {
  return new HttpError(404, "NOT_FOUND", "This recording doesn't exist or has expired.");
}

function baseHeaders(object: R2Object, now: number): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex");
  // Never let a cache outlive the link.
  const remaining = Math.floor((expiresAtMs(object.uploaded) - now) / 1000);
  headers.set("cache-control", `public, max-age=${Math.max(0, Math.min(3600, remaining))}`);
  return headers;
}

function contentRange(range: R2Range, size: number): { start: number; end: number } {
  if ("suffix" in range && range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { start: size - length, end: size - 1 };
  }
  const start = "offset" in range && range.offset !== undefined ? range.offset : 0;
  const length = "length" in range && range.length !== undefined ? range.length : size - start;
  return { start, end: Math.min(size, start + length) - 1 };
}

/**
 * GET|HEAD /r/:id.:ext — public playback of an unguessable link.
 *
 * Served by the Worker rather than a public bucket so links stop working at
 * exactly 7 days (lifecycle deletion can lag by up to a day) and so video
 * players get proper Range / 206 responses for seeking.
 */
export async function serveRecording(request: Request, env: Env, name: string): Promise<Response> {
  const parsed = parseRecordingName(name);
  if (!parsed) throw notFound();
  const key = recordingKey(parsed.id, parsed.ext);
  const now = Date.now();

  if (request.method === "HEAD") {
    const head = await env.RECORDINGS.head(key);
    if (!head) throw notFound();
    if (now >= expiresAtMs(head.uploaded)) throw gone();
    const headers = baseHeaders(head, now);
    headers.set("content-length", String(head.size));
    return new Response(null, { headers });
  }

  const object = await env.RECORDINGS.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) throw notFound();
  if (now >= expiresAtMs(object.uploaded)) {
    if ("body" in object) await object.body.cancel();
    throw gone();
  }

  const headers = baseHeaders(object, now);
  if (!("body" in object)) {
    // A conditional header matched: If-None-Match / If-Modified-Since -> 304,
    // a failed If-Match / If-Unmodified-Since -> 412.
    const notModified =
      request.headers.has("if-none-match") || request.headers.has("if-modified-since");
    return new Response(null, { status: notModified ? 304 : 412, headers });
  }

  if (object.range && request.headers.has("range")) {
    const { start, end } = contentRange(object.range, object.size);
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}
