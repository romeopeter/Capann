/**
 * Minimal HS256 JWTs on Web Crypto. Tokens are signed, not encrypted: their
 * claims (email, paid flag, expiry) are readable by whoever holds the token,
 * which is only ever the user they belong to. Integrity is what matters here.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array {
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// The only header this Worker ever issues. Verification compares it verbatim,
// which rejects `alg: none` and algorithm-confusion tokens outright.
const HEADER = base64UrlEncode(
  encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
);

const MAX_TOKEN_LENGTH = 4096;

const keys = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    keys.set(secret, key);
  }
  return key;
}

export async function signJwt(
  payload: object,
  secret: string,
): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const input = `${HEADER}.${body}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(input),
  );
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Returns the payload when the signature is valid, otherwise null. Expiry and
 * claim checks are the caller's job (see tokens.ts).
 */
export async function verifyJwt(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  if (header !== HEADER) return null;

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(signature);
  } catch {
    return null;
  }
  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signatureBytes,
    encoder.encode(`${header}.${body}`),
  );
  if (!valid) return null;

  try {
    const payload: unknown = JSON.parse(decoder.decode(base64UrlDecode(body)));
    if (typeof payload !== "object" || payload === null || Array.isArray(payload))
      return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}
