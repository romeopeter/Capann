import type { Env } from "../env";
import { json } from "../http";
import { expiresAtMs, linkInfo, ownerPrefix, RETENTION_SECONDS } from "../storage";
import type { LinkListItem, LinkListResponse } from "@capann/contract";
import { requireBearer } from "../tokens";

/** One page is 1,000 index entries; nobody records 10,000 videos in a week. */
const MAX_PAGES = 10;

/**
 * GET /api/links/list  (Bearer links token from the recovery email, or a session)
 *
 * Lists the caller's own index prefix — never the whole bucket — and drops
 * anything past the 7-day retention even if the lifecycle rule hasn't deleted
 * it yet. `now` lets the page run its countdowns from server time.
 */
export async function listLinks(request: Request, env: Env, origin: string): Promise<Response> {
  const claims = await requireBearer(request, env, ["links", "session"] as const);
  const prefix = await ownerPrefix(claims.sub);
  const now = Date.now();
  const items: LinkListItem[] = [];

  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = await env.RECORDINGS.list({
      prefix,
      cursor,
      limit: 1000,
      include: ["customMetadata"],
    });
    for (const entry of listed.objects) {
      const name = entry.key.slice(prefix.length);
      const dot = name.lastIndexOf(".");
      if (dot <= 0) continue;
      const uploadedText = entry.customMetadata?.uploaded;
      const uploaded = uploadedText ? new Date(uploadedText) : entry.uploaded;
      const remainingMs = expiresAtMs(uploaded) - now;
      if (remainingMs <= 0) continue;
      const size = Number(entry.customMetadata?.size ?? 0);
      items.push({
        ...linkInfo(origin, name.slice(0, dot), name.slice(dot + 1), size, uploaded),
        remainingSeconds: Math.floor(remainingMs / 1000),
      });
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }

  items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return json({
    email: claims.sub,
    now: new Date(now).toISOString(),
    retentionSeconds: RETENTION_SECONDS,
    items,
  } satisfies LinkListResponse);
}
