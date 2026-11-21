import { parseBachsEvent, verifyBachsSignature } from "../bachs";
import type { Env } from "../env";
import { HttpError, json } from "../http";
import { setActive, setInactive } from "../subscriptions";
import { requireBearer } from "../tokens";

/**
 * POST /api/checkout  (Bearer session)
 * Returns the Bachs checkout URL for the signed-in email; the extension opens
 * it in a tab. Requiring a session ties the payment to an address the user has
 * proven they own, which is the address the webhook will mark as paid.
 */
export async function checkout(request: Request, env: Env): Promise<Response> {
  const claims = await requireBearer(request, env, ["session"] as const);
  if (!env.BACHS_CHECKOUT_URL?.includes("{email}"))
    throw new HttpError(500, "CHECKOUT_NOT_CONFIGURED", "Checkout isn't configured yet.");
  const url = env.BACHS_CHECKOUT_URL.replace("{email}", encodeURIComponent(claims.sub));
  return json({ url });
}

const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * POST /api/webhooks/bachs
 * Verifies the signature over the raw body, then writes `sub:<email>` in KV.
 * Writes are idempotent, so Bachs retrying a delivery is harmless.
 */
export async function bachsWebhook(request: Request, env: Env): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES)
    throw new HttpError(413, "BODY_TOO_LARGE", "Webhook body is too large.");
  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BYTES)
    throw new HttpError(413, "BODY_TOO_LARGE", "Webhook body is too large.");

  if (!(await verifyBachsSignature(request, rawBody, env.BACHS_WEBHOOK_SECRET)))
    throw new HttpError(401, "INVALID_SIGNATURE", "Webhook signature is not valid.");

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Webhook body must be JSON.");
  }

  const event = parseBachsEvent(body);
  if (!event) return json({ received: true, applied: false });

  if (event.status === "active") await setActive(env, event.email, event.periodEnd);
  else await setInactive(env, event.email, event.periodEnd);
  return json({ received: true, applied: true });
}
