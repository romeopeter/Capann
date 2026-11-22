import { API_URL } from './config.js'

/** A failed API call. `message` is safe to show to users. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Calls the Capann Worker. Resolves with the JSON body; rejects with an
 * ApiError carrying the server's `{ error: { code, message } }`, or a network
 * error. Abort errors are rethrown unchanged so callers can ignore them.
 */
export async function callApi(path, { method = 'GET', token, body, signal } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError(0, 'NETWORK_ERROR', 'Couldn’t reach Capann. Check your connection and try again.')
  }

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error?.code ?? 'HTTP_ERROR',
      data?.error?.message ?? `Capann’s server had a problem (${response.status}). Try again in a moment.`,
    )
  }
  if (!data || typeof data !== 'object') {
    throw new ApiError(response.status, 'BAD_RESPONSE', 'Capann’s server sent an unexpected response. Try again in a moment.')
  }
  return data
}
