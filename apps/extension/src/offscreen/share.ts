/**
 * Share jobs: one finished recording on its way to a link.
 *
 * A job has two halves that finish independently:
 *   upload  uploading → uploaded | failed
 *   copy    ask → saving → saved | failed, or skipped
 *
 * The offscreen document owns them, not the worker. The worker is an MV3
 * service worker that Chrome stops after ~30 s without events, which is
 * shorter than a presenter may take to answer "Save a copy?". This document
 * holds the Blob anyway and lives until the worker closes it, and the worker
 * asks `shareBusy()` (via `offscreen-ping`) before closing it.
 *
 * Invariant: a recording is never lost. A failed upload saves the local copy
 * whatever the presenter chose, and the Blob is only released once the upload
 * succeeded or the copy was handed to Downloads.
 */

import { API_URL } from "../shared/features";
import type {
  RecorderToBackgroundMessage,
  ShareCopy,
  ShareJobStatus,
  ShareRequest,
} from "../shared/types";
import { shareErrorCode, shareErrorMessage, uploadRecording } from "./uploader";

const OFFSCREEN_TARGET = "offscreen" as const;
/** An unanswered "Save a copy?" counts as "No thanks"; the link exists. */
const CHOICE_TIMEOUT_MS = 10 * 60_000;
const PROGRESS_INTERVAL_MS = 250;

interface Job {
  status: ShareJobStatus;
  tabId: number;
  blob: Blob;
  blobUrl: string | null;
  choiceTimer: number;
  lastPublish: number;
}

const jobs = new Map<string, Job>();

export function shareBusy(): boolean {
  return jobs.size > 0;
}

function send(message: RecorderToBackgroundMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

function publish(job: Job): void {
  job.lastPublish = performance.now();
  void send({
    kind: "recorder-share-status",
    tabId: job.tabId,
    status: job.status,
    target: OFFSCREEN_TARGET,
  });
}

function setCopy(job: Job, copy: ShareCopy): void {
  job.status = { ...job.status, copy };
  publish(job);
}

function maybeFinish(job: Job): void {
  const { upload, copy } = job.status;
  if (upload.state === "uploading" || copy === "ask" || copy === "saving") return;
  window.clearTimeout(job.choiceTimer);
  job.status = { ...job.status, done: true };
  publish(job);
  jobs.delete(job.status.sessionId);
  // Downloads already in progress keep their own reference to the Blob.
  if (job.blobUrl) URL.revokeObjectURL(job.blobUrl);
  void send({
    kind: "recorder-share-finished",
    sessionId: job.status.sessionId,
    target: OFFSCREEN_TARGET,
  });
}

async function saveCopy(job: Job): Promise<void> {
  window.clearTimeout(job.choiceTimer);
  setCopy(job, "saving");
  job.blobUrl ??= URL.createObjectURL(job.blob);
  const response = (await send({
    kind: "recorder-copy-download",
    blobUrl: job.blobUrl,
    filename: job.status.filename,
    target: OFFSCREEN_TARGET,
  })) as { ok?: boolean } | undefined;
  setCopy(job, response?.ok ? "saved" : "failed");
  maybeFinish(job);
}

async function runUpload(job: Job, token: string): Promise<void> {
  const total = job.blob.size;
  try {
    const link = await uploadRecording({
      apiUrl: API_URL,
      token,
      blob: job.blob,
      onProgress: (loaded) => {
        job.status = {
          ...job.status,
          upload: { state: "uploading", loaded: Math.min(loaded, total), total },
        };
        if (performance.now() - job.lastPublish >= PROGRESS_INTERVAL_MS) publish(job);
      },
    });
    job.status = { ...job.status, upload: { state: "uploaded", link } };
    publish(job);
  } catch (error) {
    const code = shareErrorCode(error);
    console.error(
      `[Capann] session=${job.status.sessionId} stage=uploading code=${code}`,
      error,
    );
    job.status = {
      ...job.status,
      upload: { state: "failed", code, error: shareErrorMessage(code) },
    };
    publish(job);
    // Never lose a recording: no link means the file must reach Downloads
    // (including a second try if an earlier "Save copy" download failed).
    if (job.status.copy !== "saving" && job.status.copy !== "saved") {
      await saveCopy(job);
      return;
    }
  }
  maybeFinish(job);
}

/**
 * Starts a job and registers it synchronously, before any await, so a busy
 * check that races the recording's final status already sees it.
 */
export function startShareJob(options: {
  sessionId: string;
  tabId: number;
  blob: Blob;
  filename: string;
  request: ShareRequest;
}): void {
  const { sessionId, tabId, blob, filename, request } = options;
  const copy: ShareCopy =
    request.copyPreference === "always"
      ? "saving"
      : request.copyPreference === "never"
        ? "skipped"
        : "ask";
  const job: Job = {
    status: {
      sessionId,
      filename,
      upload: { state: "uploading", loaded: 0, total: blob.size },
      copy,
      done: false,
    },
    tabId,
    blob,
    blobUrl: null,
    choiceTimer: 0,
    lastPublish: 0,
  };
  jobs.set(sessionId, job);
  publish(job);
  if (copy === "saving") void saveCopy(job);
  if (copy === "ask") {
    job.choiceTimer = window.setTimeout(
      () => chooseCopy(sessionId, false),
      CHOICE_TIMEOUT_MS,
    );
  }
  void runUpload(job, request.token);
}

/** The presenter's answer to "Save a copy to your computer?". */
export function chooseCopy(sessionId: string, save: boolean): void {
  const job = jobs.get(sessionId);
  if (!job || job.status.copy !== "ask") return;
  window.clearTimeout(job.choiceTimer);
  if (save) {
    void saveCopy(job);
    return;
  }
  setCopy(job, "skipped");
  maybeFinish(job);
}
