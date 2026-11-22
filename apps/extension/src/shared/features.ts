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
import type { Edition } from "@capann/contract";
export type { Edition };

export const EDITION: Edition = __CAPANN_EDITION__;
export const PREMIUM_ENABLED = EDITION === "premium";

/** Premium backend origin (no trailing slash). Set in capann.config.json. */
export const API_URL: string = __CAPANN_API_URL__;
/** Website origin: sign-in landing pages, link recovery, and pricing. */
export const SITE_URL: string = __CAPANN_SITE_URL__;
/** Where the free build's one Premium teaser points. Opening it is a plain link. */
export const PRICING_URL = `${SITE_URL}/#pricing`;
/** Shown on the Upgrade button. Keep in step with the Bachs product price. */
export const PREMIUM_PRICE_LABEL = "$7/month";
