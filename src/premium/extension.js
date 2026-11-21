import { EXTENSION_IDS } from './config.js'

// Website → extension messaging (`chrome.runtime.sendMessage(extensionId, …)`).
// Chrome only exposes `chrome.runtime` to a page when some installed extension
// lists the page's origin under `externally_connectable`, and Capann's worker
// also rejects senders whose origin isn't exactly its configured site URL.

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

/** Sends one message to one extension ID and resolves with its reply. */
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
        else resolve(reply)
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
