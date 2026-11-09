/**
 * Edition gates.
 *
 * The edition is chosen at build time: `capann.config.json` sets the default
 * for the checked-out branch, and `npm run build:free` / `build:premium`
 * override it (see `scripts/build.mjs`). On `dev` this lets one codebase build
 * either edition; `free` and `premium` differ only in that config value.
 *
 * Annotations and instant tab recording are free in every edition. Premium is
 * reserved for the browser-AI layer and shareable links; gate those features on
 * `PREMIUM_ENABLED` here so the UI and the service worker cannot drift apart.
 */
export type Edition = "free" | "premium";

export const EDITION: Edition = __CAPANN_EDITION__;
export const PREMIUM_ENABLED = EDITION === "premium";
