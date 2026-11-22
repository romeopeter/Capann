/**
 * Uploads a finished recording to the Premium backend and returns its link.
 *
 * Runs in the offscreen document because that is where the Blob lives; moving
 * hundreds of megabytes through extension messaging to the worker would copy
 * it. Offscreen documents are extension pages, so CORS does not apply.
 *
 * Workers reject request bodies over 100 MB, so files above SINGLE_UPLOAD_LIMIT
 * use the multipart routes: create, PUT fixed-size parts, complete. See
 * `apps/api/README.md` → "Uploading from the extension".
 *
 * The transport is injectable so the same logic can be exercised from Node
 * against `wrangler dev` (`scripts/premium-e2e.mjs`).
 */

import { API_ROUTES, MAX_SINGLE_UPLOAD_BYTES, multipartPartRoute } from "@capann/contract";
import type {
  MultipartCompleteRequest,
  MultipartCreateRequest,
  MultipartCreateResponse,
  UploadedPart,
} from "@capann/contract";
import { ApiError, apiErrorFrom } from "@capann/api-client";
import type { ShareErrorCode, ShareLink } from "../shared/types";

/** Below the API's single-upload cap, leaving room for headers. */
export const SINGLE_UPLOAD_LIMIT = MAX_SINGLE_UPLOAD_BYTES - 5 * 1024 * 1024;
/** No upload progress for this long means the connection is gone. */
const STALL_MS = 60_000;
const PART_ATTEMPTS = 3;

export interface TransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Blob | string;
  /** Bytes of `body` sent so far. */
  onProgress?: (loaded: number) => void;
}

export interface TransportResponse {
  status: number;
  text: string;
  retryAfter?: number;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/**
 * XMLHttpRequest, because fetch() cannot report upload progress. A stall
 * watchdog turns a silently dead connection into a NETWORK failure, so the
 * share job always reaches a final state.
 */
export const xhrTransport: Transport = (request) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let watchdog = 0;
    const arm = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => xhr.abort(), STALL_MS);
    };
    xhr.open(request.method, request.url);
    for (const [name, value] of Object.entries(request.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      arm();
      request.onProgress?.(event.loaded);
    };
    xhr.onload = () => {
      window.clearTimeout(watchdog);
      resolve({
        status: xhr.status,
        text: xhr.responseText,
        retryAfter: Number(xhr.getResponseHeader("retry-after")) || undefined,
      });
    };
    const fail = () => {
      window.clearTimeout(watchdog);
      reject(new ApiError(0, "NETWORK", "The upload connection was lost."));
    };
    xhr.onerror = fail;
    xhr.onabort = fail;
    xhr.ontimeout = fail;
    arm();
    xhr.send(request.body ?? null);
  });

/** Backend failure → the share flow's failure class. */
export function shareErrorCode(error: unknown): ShareErrorCode {
  if (!(error instanceof ApiError)) return "SERVER";
  if (error.status === 0) return "NETWORK";
  if (error.status === 402) return "PAYMENT_REQUIRED";
  if (error.status === 401) return "SIGNED_OUT";
  if (error.status === 413) return "TOO_LARGE";
  return "SERVER";
}

export function shareErrorMessage(code: ShareErrorCode): string {
  switch (code) {
    case "PAYMENT_REQUIRED":
      return "Your Premium subscription isn't active, so no link was made.";
    case "SIGNED_OUT":
      return "Your Capann sign-in expired, so no link was made.";
    case "TOO_LARGE":
      return "This recording is too large to share as a link.";
    case "NETWORK":
      return "The upload couldn't reach Capann, so no link was made.";
    case "SERVER":
      return "Capann's server had a problem, so no link was made.";
  }
}

interface UploadOptions {
  apiUrl: string;
  token: string;
  blob: Blob;
  onProgress: (loaded: number, total: number) => void;
  transport?: Transport;
  /** Override for tests, so multipart can be exercised with a small file. */
  singleLimit?: number;
}

async function call<T>(
  transport: Transport,
  request: TransportRequest,
  expected: number[],
): Promise<T> {
  const response = await transport(request);
  if (!expected.includes(response.status))
    throw apiErrorFrom(
      response.status,
      response.text,
      response.retryAfter,
      `Unexpected response ${response.status}.`,
    );
  try {
    return (response.text ? JSON.parse(response.text) : null) as T;
  } catch {
    throw new ApiError(response.status, "SERVER", "The server's reply couldn't be read.");
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function uploadRecording(options: UploadOptions): Promise<ShareLink> {
  const { blob, singleLimit = SINGLE_UPLOAD_LIMIT } = options;
  if (blob.size <= singleLimit) {
    try {
      return await uploadSingle(options);
    } catch (error) {
      // The server's limit is the authority; if it is lower than ours, switch.
      if (!(error instanceof ApiError && error.code === "USE_MULTIPART")) throw error;
    }
  }
  return uploadMultipart(options);
}

async function uploadSingle({
  apiUrl,
  token,
  blob,
  onProgress,
  transport = xhrTransport,
}: UploadOptions): Promise<ShareLink> {
  const request: TransportRequest = {
    method: "POST",
    url: `${apiUrl}${API_ROUTES.upload}`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": blob.type || "video/webm",
    },
    body: blob,
    onProgress: (loaded) => onProgress(loaded, blob.size),
  };
  try {
    return await call<ShareLink>(transport, request, [201]);
  } catch (error) {
    if (!isRetryable(error)) throw error;
    await wait(1_500);
    onProgress(0, blob.size);
    return call<ShareLink>(transport, request, [201]);
  }
}

async function uploadMultipart({
  apiUrl,
  token,
  blob,
  onProgress,
  transport = xhrTransport,
}: UploadOptions): Promise<ShareLink> {
  const session = await call<MultipartCreateResponse>(
    transport,
    {
      method: "POST",
      url: `${apiUrl}${API_ROUTES.multipart}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contentType: blob.type || "video/webm",
      } satisfies MultipartCreateRequest),
    },
    [201],
  );
  const auth = { authorization: `Bearer ${session.uploadToken}` };
  const partCount = Math.max(1, Math.ceil(blob.size / session.partSize));
  try {
    if (partCount > session.maxParts) {
      throw new ApiError(413, "RECORDING_TOO_LARGE", "Recording exceeds the part limit.");
    }
    const parts: UploadedPart[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      const offset = (partNumber - 1) * session.partSize;
      // Every part but the last must be exactly partSize (an R2 rule).
      const body = blob.slice(offset, offset + session.partSize);
      let attempt = 0;
      for (;;) {
        try {
          const part = await call<UploadedPart>(
            transport,
            {
              method: "PUT",
              url: `${apiUrl}${multipartPartRoute(partNumber)}`,
              headers: auth,
              body,
              onProgress: (loaded) => onProgress(offset + loaded, blob.size),
            },
            [200],
          );
          parts.push({ partNumber: part.partNumber, etag: part.etag });
          break;
        } catch (error) {
          attempt += 1;
          if (attempt >= PART_ATTEMPTS || !isRetryable(error)) throw error;
          await wait(attempt * 2_000);
        }
      }
      onProgress(Math.min(blob.size, offset + body.size), blob.size);
    }
    return await call<ShareLink>(
      transport,
      {
        method: "POST",
        url: `${apiUrl}${API_ROUTES.multipartComplete}`,
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ parts } satisfies MultipartCompleteRequest),
      },
      [201],
    );
  } catch (error) {
    // Best effort: the R2 lifecycle rule also aborts abandoned uploads after a day.
    await transport({
      method: "DELETE",
      url: `${apiUrl}${API_ROUTES.multipart}`,
      headers: auth,
    }).catch(() => undefined);
    throw error;
  }
}
