import type { Env } from "../env";
import { HttpError, json, readJson } from "../http";
import {
  baseContentType,
  linkInfo,
  recordingKey,
  typeForExtension,
  VIDEO_TYPES,
  writeIndex,
} from "../storage";
import { requirePaid } from "../subscriptions";
import { issueToken, requireBearer } from "../tokens";

/**
 * Two ways to upload, both streamed straight into R2 without buffering:
 *
 * - POST /api/upload — the whole file in one request. Simple, but a Worker
 *   request body is capped at 100 MB on Free/Pro plans (~5 minutes of 1080p).
 * - /api/upload/multipart — create, PUT fixed-size parts, complete. Needed for
 *   anything bigger; each part is its own request under the cap.
 *
 * Both check the subscription in KV at the start. The session token's `paid`
 * claim is not trusted for this: it can be up to 30 days stale, so a cancelled
 * subscriber would otherwise keep uploading until it expired.
 */

const DEFAULT_MAX_UPLOAD = 95 * 1024 * 1024;
const DEFAULT_MAX_RECORDING = 2 * 1024 * 1024 * 1024;
/** Every part except the last is exactly this size (R2 requires equal parts; minimum 5 MiB). */
const PART_SIZE = 10 * 1024 * 1024;
const R2_MAX_PARTS = 10_000;

function byteLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function contentLength(request: Request): number {
  const length = Number(request.headers.get("content-length"));
  // R2 can only accept a stream whose length is known up front.
  if (!Number.isInteger(length) || length <= 0)
    throw new HttpError(411, "LENGTH_REQUIRED", "Send a Content-Length header.");
  return length;
}

function videoExtension(contentType: string): string {
  const ext = VIDEO_TYPES[contentType];
  if (!ext)
    throw new HttpError(415, "UNSUPPORTED_TYPE", "Upload a video/webm or video/mp4 recording.");
  return ext;
}

function storedMetadata(id: string, ext: string, email: string): R2PutOptions {
  return {
    httpMetadata: {
      contentType: typeForExtension(ext)!,
      contentDisposition: `inline; filename="capann-${id}.${ext}"`,
    },
    customMetadata: { owner: email },
  };
}

/** POST /api/upload  (Bearer session; body = the video; Content-Type video/webm) */
export async function uploadSingle(request: Request, env: Env, origin: string): Promise<Response> {
  const { sub: email } = await requireBearer(request, env, ["session"] as const);
  await requirePaid(env, email);

  const ext = videoExtension(baseContentType(request.headers.get("content-type")));
  const length = contentLength(request);
  if (length > byteLimit(env.MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD))
    throw new HttpError(
      413,
      "USE_MULTIPART",
      "This recording is too large for a single upload. Use /api/upload/multipart.",
    );
  if (!request.body) throw new HttpError(400, "EMPTY_BODY", "The upload was empty.");

  const id = crypto.randomUUID();
  const object = await env.RECORDINGS.put(
    recordingKey(id, ext),
    request.body,
    storedMetadata(id, ext, email),
  );
  if (!object) throw new HttpError(500, "UPLOAD_FAILED", "The upload didn't complete.");

  await writeIndex(env, email, id, ext, object.size, object.uploaded);
  return json(linkInfo(origin, id, ext, object.size, object.uploaded), 201);
}

/**
 * POST /api/upload/multipart  (Bearer session)  { contentType }
 * Starts an upload and returns an upload token bound to it. Parts and
 * completion use that token, not the session.
 */
export async function multipartCreate(request: Request, env: Env): Promise<Response> {
  const { sub: email } = await requireBearer(request, env, ["session"] as const);
  await requirePaid(env, email);

  const body = await readJson(request);
  const ext = videoExtension(
    baseContentType(typeof body.contentType === "string" ? body.contentType : null),
  );
  const id = crypto.randomUUID();
  const key = recordingKey(id, ext);
  const upload = await env.RECORDINGS.createMultipartUpload(key, storedMetadata(id, ext, email));

  const maxBytes = byteLimit(env.MAX_RECORDING_BYTES, DEFAULT_MAX_RECORDING);
  const { token, claims } = await issueToken(env, "upload", email, {
    key,
    uid: upload.uploadId,
    ps: PART_SIZE,
  });
  return json(
    {
      uploadToken: token,
      partSize: PART_SIZE,
      maxParts: Math.min(R2_MAX_PARTS, Math.ceil(maxBytes / PART_SIZE)),
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    },
    201,
  );
}

/** PUT /api/upload/multipart/:partNumber  (Bearer upload token; body = part bytes) */
export async function multipartPart(
  request: Request,
  env: Env,
  partNumberText: string,
): Promise<Response> {
  const claims = await requireBearer(request, env, ["upload"] as const);
  const maxParts = Math.min(
    R2_MAX_PARTS,
    Math.ceil(byteLimit(env.MAX_RECORDING_BYTES, DEFAULT_MAX_RECORDING) / claims.ps),
  );
  const partNumber = Number(partNumberText);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > maxParts)
    throw new HttpError(400, "INVALID_PART", `Part numbers run from 1 to ${maxParts}.`);

  // Only the last part may be shorter; R2 rejects uneven parts on complete.
  const length = contentLength(request);
  if (length > claims.ps)
    throw new HttpError(413, "PART_TOO_LARGE", `Each part must be at most ${claims.ps} bytes.`);
  if (!request.body) throw new HttpError(400, "EMPTY_BODY", "The part was empty.");

  const upload = env.RECORDINGS.resumeMultipartUpload(claims.key, claims.uid);
  try {
    const part = await upload.uploadPart(partNumber, request.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  } catch (error) {
    console.error("[capann] uploadPart failed", error);
    throw new HttpError(409, "UPLOAD_NOT_FOUND", "This upload is no longer open.");
  }
}

function readParts(value: unknown): R2UploadedPart[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > R2_MAX_PARTS)
    throw new HttpError(400, "INVALID_PARTS", "parts must list every uploaded part.");
  const parts = value.map((entry: unknown) => {
    const { partNumber, etag } = (entry ?? {}) as { partNumber?: unknown; etag?: unknown };
    if (!Number.isInteger(partNumber) || typeof etag !== "string")
      throw new HttpError(400, "INVALID_PARTS", "Each part needs a partNumber and etag.");
    return { partNumber: partNumber as number, etag };
  });
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

/** POST /api/upload/multipart/complete  (Bearer upload token)  { parts: [{ partNumber, etag }] } */
export async function multipartComplete(
  request: Request,
  env: Env,
  origin: string,
): Promise<Response> {
  const claims = await requireBearer(request, env, ["upload"] as const);
  const parts = readParts((await readJson(request, 1024 * 1024)).parts);

  const upload = env.RECORDINGS.resumeMultipartUpload(claims.key, claims.uid);
  let object: R2Object;
  try {
    object = await upload.complete(parts);
  } catch (error) {
    console.error("[capann] complete failed", error);
    throw new HttpError(
      400,
      "UPLOAD_INCOMPLETE",
      "The upload couldn't be finished. Check that every part was uploaded.",
    );
  }

  if (object.size > byteLimit(env.MAX_RECORDING_BYTES, DEFAULT_MAX_RECORDING)) {
    await env.RECORDINGS.delete(object.key);
    throw new HttpError(413, "RECORDING_TOO_LARGE", "This recording is over the size limit.");
  }

  const name = object.key.slice(object.key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const id = name.slice(0, dot);
  const ext = name.slice(dot + 1);
  await writeIndex(env, claims.sub, id, ext, object.size, object.uploaded);
  return json(linkInfo(origin, id, ext, object.size, object.uploaded), 201);
}

/** DELETE /api/upload/multipart  (Bearer upload token) — abandon an upload. */
export async function multipartAbort(request: Request, env: Env): Promise<Response> {
  const claims = await requireBearer(request, env, ["upload"] as const);
  try {
    await env.RECORDINGS.resumeMultipartUpload(claims.key, claims.uid).abort();
  } catch {
    // Already completed, aborted, or cleaned up by the lifecycle rule.
  }
  return new Response(null, { status: 204 });
}
