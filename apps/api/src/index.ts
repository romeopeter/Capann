/**
 * Capann API — Cloudflare Worker.
 *
 * Passwordless Premium backend: magic-link sign-in, Bachs subscription
 * webhooks, recording uploads to R2, link recovery, and public playback.
 * There are no accounts or databases: a user is an email address, proven by
 * short-lived signed tokens, and the only state is `sub:<email>` in KV plus
 * the recordings themselves in R2. See README.md for setup and the API table.
 */

import { API_ROUTES as R, RECORDING_ROUTE_PREFIX } from "@capann/contract";
import type { Env } from "./env";
import { corsHeaders, errorResponse, HttpError } from "./http";
import { magicLink, refreshSession, verify } from "./routes/auth";
import { bachsWebhook, checkout } from "./routes/billing";
import { listLinks } from "./routes/links";
import { serveRecording } from "./routes/media";
import {
  multipartAbort,
  multipartComplete,
  multipartCreate,
  multipartPart,
  uploadSingle,
} from "./routes/upload";

export { RateLimiter } from "./rate-limiter";

function methodNotAllowed(): HttpError {
  return new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname.startsWith(RECORDING_ROUTE_PREFIX)) {
    if (method !== "GET" && method !== "HEAD") throw methodNotAllowed();
    return serveRecording(request, env, pathname.slice(RECORDING_ROUTE_PREFIX.length));
  }

  const partMatch = /^\/api\/upload\/multipart\/(\d+)$/.exec(pathname);
  if (partMatch) {
    if (method !== "PUT") throw methodNotAllowed();
    return multipartPart(request, env, partMatch[1]!);
  }

  // Paths come from @capann/contract, which the extension's client uses too.
  switch (`${method} ${pathname}`) {
    case `POST ${R.magicLink}`:
      return magicLink(request, env);
    case `POST ${R.verify}`:
      return verify(request, env);
    case `GET ${R.session}`:
      return refreshSession(request, env);
    case `POST ${R.checkout}`:
      return checkout(request, env);
    case `POST ${R.bachsWebhook}`:
      return bachsWebhook(request, env);
    case `POST ${R.upload}`:
      return uploadSingle(request, env, url.origin);
    case `POST ${R.multipart}`:
      return multipartCreate(request, env);
    case `POST ${R.multipartComplete}`:
      return multipartComplete(request, env, url.origin);
    case `DELETE ${R.multipart}`:
      return multipartAbort(request, env);
    case `GET ${R.links}`:
      return listLinks(request, env, url.origin);
    case `GET ${R.health}`:
      return new Response("ok");
  }
  throw new HttpError(404, "NOT_FOUND", "Not found.");
}

export default {
  async fetch(request, env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) response = errorResponse(error);
      else {
        console.error("[capann] unhandled error", error);
        response = errorResponse(new HttpError(500, "INTERNAL", "Something went wrong."));
      }
    }

    if (Object.keys(cors).length === 0) return response;
    const withCors = new Response(response.body, response);
    for (const [name, value] of Object.entries(cors)) withCors.headers.set(name, value);
    return withCors;
  },
} satisfies ExportedHandler<Env>;
