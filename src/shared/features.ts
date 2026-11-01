/**
 * Edition gates.
 *
 * The edition is chosen at build time: `capann.config.json` sets the default
 * for the checked-out branch, and `npm run build:free` / `build:premium`
 * override it (see `scripts/build.mjs`). On `dev` this lets one codebase build
 * either edition; `free` and `premium` differ only in that config value.
 *
 * Annotations are free forever; recording is Premium. Keep the gate in one
 * place so the Record view, the prewarm effect, and the worker's message
 * guards cannot drift apart.
 */
export type Edition = "free" | "premium";

export const EDITION: Edition = __CAPANN_EDITION__;
export const RECORDING_ENABLED = EDITION === "premium";

export const RECORDING_PREMIUM_TITLE = "Recording is a Premium feature";
export const RECORDING_PREMIUM_BODY =
  "Annotations are free forever. Premium adds annotations + instant screen recording + shareable links and a 7-day history. All for $6.99/month or $69.99/year.";
export const RECORDING_PREMIUM_BADGE = "Premium";
export const RECORDING_LOCKED_ERROR =
  "Recording is a Premium feature. Annotations are free forever.";
