// Capann Premium endpoints for the sign-in and link-recovery pages.
//
// Values come from local, gitignored Vite env files (`.env.development`,
// `.env.production`, `*.local`). Everything VITE_* ends up in the browser
// bundle. With no env file, the API defaults to production.

const env = import.meta.env

/** Worker API origin, without a trailing slash. */
export const API_URL = (env.VITE_CAPANN_API_URL || 'https://api.capann.duowork.tech').replace(/\/+$/, '')

/**
 * Extension IDs to look for: the Chrome Web Store ID plus any local unpacked
 * IDs. Each one must list this site's origin under `externally_connectable`
 * (the Premium build does).
 */
export const EXTENSION_IDS = (env.VITE_CAPANN_EXTENSION_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

/**
 * Where "Install Capann Premium" points. Until the Web Store listing exists,
 * this falls back to the landing page's pricing section (an in-site path).
 */
export const INSTALL_URL = env.VITE_CAPANN_INSTALL_URL || ''
