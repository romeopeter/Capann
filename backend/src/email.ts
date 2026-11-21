import type { Env } from "./env";
import { HttpError } from "./http";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Users are identified only by email, so one person must always map to one
 * string: trimmed and lowercased. Returns null for anything that isn't an
 * address.
 */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export type MagicLinkKind = "login" | "links";

const COPY: Record<MagicLinkKind, { subject: string; heading: string; action: string; note: string }> = {
  login: {
    subject: "Your Capann sign-in link",
    heading: "Sign in to Capann",
    action: "Sign in",
    note: "This link signs you in on this browser and works once, for 15 minutes.",
  },
  links: {
    subject: "Your Capann recording links",
    heading: "View your Capann links",
    action: "View my links",
    note: "This link shows your recordings from the last 7 days and expires in 15 minutes.",
  },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendMagicLink(
  env: Env,
  to: string,
  kind: MagicLinkKind,
  link: string,
): Promise<void> {
  const copy = COPY[kind];

  if (env.EMAIL_TRANSPORT === "console") {
    // Local development only: wrangler.jsonc defaults to "resend".
    console.log(`[capann] ${kind} link for ${to}: ${link}`);
    return;
  }

  const safeLink = escapeHtml(link);
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f5f5f7;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1c20">
  <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px">${copy.heading}</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#55555c">${copy.note}</p>
    <a href="${safeLink}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#1c1c20;color:#fff;text-decoration:none;font-weight:600;font-size:14px">${copy.action}</a>
    <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8b8b93">If you didn't ask for this, you can ignore this email.</p>
  </div>
</body></html>`;
  const text = `${copy.heading}\n\n${copy.note}\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: copy.subject, html, text }),
  });
  if (!response.ok) {
    console.error(`[capann] email send failed: ${response.status} ${await response.text()}`);
    throw new HttpError(502, "EMAIL_FAILED", "We couldn't send the email. Try again shortly.");
  }
}
