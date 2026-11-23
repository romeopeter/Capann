import { EXTENSION_IDS } from './config.js'

// Website → extension messaging (`chrome.runtime.sendMessage(extensionId, …)`).
// Chrome only exposes `chrome.runtime` to a page when some installed extension
// lists the page's origin under `externally_connectable`, and Capann's worker
// also rejects senders whose origin isn't exactly its configured site URL.
//
// Every message and reply is typed by @capann/contract (checked by
// `npm run typecheck`). Pages use the helpers at the bottom rather than
// building messages themselves, so all of it is checked here.

/** @typedef {import('@capann/contract').WebsiteToExtensionMessage} WebsiteToExtensionMessage */
/** @typedef {import('@capann/contract').PingReply} PingReply */
/** @typedef {import('@capann/contract').SessionReply} SessionReply */
/** @typedef {import('@capann/contract').RefreshReply} RefreshReply */

const PING_TIMEOUT_MS = 4000

/** No reply: not installed, disabled, wrong origin for `externally_connectable`, or timed out. */
export class ExtensionUnreachableError extends Error {
  constructor(detail) {
    super(detail || 'Capann didn’t respond.')
    this.name = 'ExtensionUnreachableError'
  }
}

function runtime() {
  const chromeRuntime = typeof window === 'undefined' ? undefined : window.chrome?.runtime
  return typeof chromeRuntime?.sendMessage === 'function' ? chromeRuntime : null
}

/**
 * Sends one message to one extension ID and resolves with its reply.
 *
 * @template {WebsiteToExtensionMessage} M
 * @param {string} id
 * @param {M} message
 * @param {number} timeoutMs
 * @returns {Promise<import('@capann/contract').ReplyTo<M>>}
 */
export function sendToExtension(id, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chromeRuntime = runtime()
    if (!chromeRuntime) {
      reject(new ExtensionUnreachableError('This browser can’t talk to Capann from this page.'))
      return
    }

    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new ExtensionUnreachableError('Capann took too long to respond.'))
    }, timeoutMs)

    try {
      chromeRuntime.sendMessage(id, message, (reply) => {
        // Always read lastError, or Chrome logs "Unchecked runtime.lastError".
        const lastError = chromeRuntime.lastError
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (lastError || reply === undefined) reject(new ExtensionUnreachableError(lastError?.message))
        else resolve(/** @type {import('@capann/contract').ReplyTo<M>} */ (reply))
      })
    } catch (error) {
      // An ID that isn't a valid extension ID throws synchronously.
      settled = true
      clearTimeout(timer)
      reject(new ExtensionUnreachableError(error?.message))
    }
  })
}

/**
 * Pings every configured extension ID in parallel.
 *
 * Resolves with one of:
 * - `{ status: 'premium', id, version }` — a Premium build answered; it can take a session.
 * - `{ status: 'free' }` — only a free build answered.
 * - `{ status: 'refused', error }` — Capann answered but refused this page (origin mismatch).
 * - `{ status: 'missing' }` — nothing answered.
 *
 * @returns {Promise<
 *   | { status: 'premium', id: string, version: string }
 *   | { status: 'free' }
 *   | { status: 'refused', error: string }
 *   | { status: 'missing' }
 * >}
 */
export async function findExtension() {
  if (!runtime() || EXTENSION_IDS.length === 0) return { status: 'missing' }

  const replies = await Promise.all(
    EXTENSION_IDS.map((id) =>
      sendToExtension(id, { kind: 'capann-ping' }, PING_TIMEOUT_MS).then(
        (reply) => ({ id, reply }),
        () => null,
      ),
    ),
  )
  const answered = replies.filter((entry) => entry && entry.reply && typeof entry.reply === 'object')

  const premium = answered.find(({ reply }) => reply.ok && reply.edition === 'premium')
  if (premium) return { status: 'premium', id: premium.id, version: premium.reply.version }
  if (answered.some(({ reply }) => reply.ok)) return { status: 'free' }

  const refused = answered.find(({ reply }) => reply.ok === false)
  if (refused) return { status: 'refused', error: refused.reply.error }
  return { status: 'missing' }
}

/**
 * Hands a 30-day session token (from `/api/auth/verify`) to the extension,
 * which confirms it with the API before storing it.
 *
 * @param {string} id
 * @param {string} token
 * @param {number} timeoutMs
 * @returns {Promise<SessionReply>}
 */
export function handOffSession(id, token, timeoutMs) {
  return sendToExtension(id, { kind: 'capann-session', token }, timeoutMs)
}

/**
 * Asks the extension to re-check `paid` with the API (after checkout).
 *
 * @param {string} id
 * @param {number} timeoutMs
 * @returns {Promise<RefreshReply>}
 */
export function refreshExtension(id, timeoutMs) {
  return sendToExtension(id, { kind: 'capann-refresh' }, timeoutMs)
}
