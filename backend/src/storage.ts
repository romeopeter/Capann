import type { Env } from "./env";

/**
 * R2 layout
 *
 *   recordings/<uuid>.<ext>          the video. customMetadata.owner = email
 *   owners/<sha256(email)>/<uuid>.<ext>   empty index marker, one per recording
 *
 * Public links only ever contain `<uuid>.<ext>`: a random v4 UUID (122 random
 * bits from a CSPRNG), so they can't be guessed or enumerated, and they say
 * nothing about who uploaded them.
 *
 * The index exists so link recovery lists one owner's prefix instead of
 * scanning every object in the bucket and filtering on metadata, which would
 * cost one list call per 1,000 objects of *everyone's* recordings.
 *
 * Both prefixes are deleted by the R2 lifecycle rules in r2-lifecycle.json.
 * Lifecycle deletion runs asynchronously (usually within a day of expiry), so
 * the Worker also treats anything older than RETENTION_SECONDS as gone.
 */
export const RECORDING_PREFIX = "recordings/";
export const INDEX_PREFIX = "owners/";
export const RETENTION_SECONDS = 7 * 24 * 60 * 60;

/** Content types accepted for upload, and the extension each is stored with. */
export const VIDEO_TYPES: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
};
const TYPE_FOR_EXTENSION: Record<string, string> = { webm: "video/webm", mp4: "video/mp4" };

/** `video/webm;codecs=vp9,opus` -> `video/webm`. */
export function baseContentType(header: string | null): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

export function typeForExtension(ext: string): string | undefined {
  return TYPE_FOR_EXTENSION[ext];
}

export function recordingKey(id: string, ext: string): string {
  return `${RECORDING_PREFIX}${id}.${ext}`;
}

/** Parses the public `<uuid>.<ext>` name. Null for anything else. */
export function parseRecordingName(name: string): { id: string; ext: string } | null {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(webm|mp4)$/.exec(
    name,
  );
  return match ? { id: match[1]!, ext: match[2]! } : null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ownerPrefix(email: string): Promise<string> {
  return `${INDEX_PREFIX}${await sha256Hex(email)}/`;
}

export function expiresAtMs(uploaded: Date): number {
  return uploaded.getTime() + RETENTION_SECONDS * 1000;
}

export function publicUrl(origin: string, id: string, ext: string): string {
  return `${origin}/r/${id}.${ext}`;
}

export interface LinkInfo {
  id: string;
  url: string;
  size: number;
  uploadedAt: string;
  expiresAt: string;
}

export function linkInfo(origin: string, id: string, ext: string, size: number, uploaded: Date): LinkInfo {
  return {
    id,
    url: publicUrl(origin, id, ext),
    size,
    uploadedAt: uploaded.toISOString(),
    expiresAt: new Date(expiresAtMs(uploaded)).toISOString(),
  };
}

/**
 * Record a finished upload in the owner's index. A failure here doesn't lose
 * the recording — the link still works — it only hides it from link recovery,
 * so it is logged rather than surfaced.
 */
export async function writeIndex(
  env: Env,
  email: string,
  id: string,
  ext: string,
  size: number,
  uploaded: Date,
): Promise<void> {
  try {
    await env.RECORDINGS.put(`${await ownerPrefix(email)}${id}.${ext}`, "", {
      customMetadata: { size: String(size), uploaded: uploaded.toISOString() },
    });
  } catch (error) {
    console.error(`[capann] index write failed for ${id}`, error);
  }
}
