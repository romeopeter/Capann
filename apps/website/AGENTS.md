# AGENTS.md — apps/website

This is the website workspace of the Capann monorepo (`@capann/website`). The
repository-wide rules, layout, and the shared packages are in the root
`AGENTS.md`; this file covers the website.

## What this is
Marketing landing page for **Capann**, a browser extension (draw, point, screenshot, screen-record on any page; one-time purchase, no subscription). Built by Duowork.
React site with the landing page (`/`), an interactive `/playground` that renders three realistic sample pages so visitors can annotate them with the installed extension, `/privacy`, and three Capann Premium utility pages (`/verify`, `/view-my-links`, `/upgraded`; see below). Content and visual design are ports of the static design export — do not invent copy or styling.

## Source of truth (design export, outside this repo)
`/Users/romeo/Desktop/Capann website/`
- `Capann Landing.dc.html` — full page structure + copy (authoritative, incl. FAQ)
- `uploads/capann-website-copy.md` — marketing copy
- `uploads/design-tokens.md` — toolbar design system (surfaces, borders, accents, text, radius, motion, translucency, states)
- `Capann Brand Sheet.dc.html` + `assets/README.md` — logo usage, palette (`#121212` ink, `#F6F5F2` paper, `#A78BFA` draw, `#86EFAC` recording, `#F5E8A6` highlight)
- `assets/{svg,png,favicon}/` — copied into this repo's `public/`; re-copy from here if assets change

## Stack
Vite 8 + React 19 (JS, no TypeScript) + Tailwind CSS v4 (`@tailwindcss/vite`) + `react-router` 7. Node 22. Lint: `oxlint`. The Premium helpers in `src/premium/*.js` carry JSDoc types from `@capann/contract` and are checked by `npm run typecheck` (`tsconfig.json`); the rest of the site isn't type-checked. React must stay on the same version as the extension (see the root `AGENTS.md`).

## Commands
Install once at the repository root (`npm install`). From the root:
- `npm run website:dev` — local dev server
- `npm run website:build` — production build to `apps/website/dist/` (always verify changes with this). `postbuild` copies `dist/index.html` to `dist/404.html` so deep links like `/playground` work on static hosting.
- `npm run website:preview` — serve `dist/` locally
- `npm run website:lint` — oxlint
- `npm run typecheck` — every workspace, including this site's Premium helpers

The same scripts without the `website:` prefix work from inside `apps/website`. There is no deploy script: GitHub Actions deploys the site (below).

## Deployment
Deployed at `https://capann.duowork.tech` from the monorepo's own GitHub Pages by `.github/workflows/website.yml`. Every push to `main` that touches `apps/website/`, `packages/`, the root `package.json`, or the lockfile runs `npm ci`, lint, the website typecheck, and the build, then publishes `dist/`; it can also be run by hand from the Actions tab (the `github-pages` environment only accepts `main` unless its branch rules are widened).
- One-time repository settings (listed at the top of the workflow): Pages source "GitHub Actions", custom domain `capann.duowork.tech` with HTTPS enforced, and the Actions **variables** `VITE_CAPANN_API_URL`, `VITE_CAPANN_EXTENSION_IDS`, `VITE_CAPANN_INSTALL_URL`. CI has no `.env.production` (it is gitignored), so those variables are what the deployed site gets; the workflow warns when `VITE_CAPANN_EXTENSION_IDS` is empty, since Premium sign-in can't finish without it.
- The custom domain is a Pages setting, so no `CNAME` file is needed in `public/`. DNS (at WhoGoHost): `capann.duowork.tech` must be a CNAME to the repository owner's Pages host, `<owner>.github.io` (`romeopeter.github.io` while the repo is `romeopeter/Capann`).
- `vite.config.js` sets `base: '/'` for the custom domain. If the site ever moves to a project path (`romeopeter.github.io/Capann/`), `base` must change with it.
- `postbuild` writes `dist/404.html` as an SPA fallback so deep links like `/playground` and `/privacy` boot the router on static hosting.
- `index.html` asset URLs are rewritten by Vite automatically; **hardcoded absolute public paths in JSX break under a non-root base** — always prefix with `import.meta.env.BASE_URL` (see the logo `<img>` usage in `src/pages/LandingPage.jsx` and `src/pages/PlaygroundPage.jsx`).

## Styling rules
- Tailwind utilities for general styling; custom CSS only where necessary (`src/index.css`, `src/playground/playground.css`).
- Playground sample pages live in `src/playground/samples/` and are styled by `playground.css`, entirely scoped under `.pg-sample` with `fb-` / `te-` / `dg-` prefixes. Keep it that way so sample palettes and selectors never leak into the landing page or the extension overlay. The playground shell itself uses Tailwind + the site tokens.
- The playground shell is intentionally **light** while the landing page stays dark: it is styled with Tailwind utilities on the brand mint (`#86EFAC`), near-white mint cards, and deep-emerald accents (`pg-*` tokens). The header uses the original brand icon (`capann-icon-dark.svg`); the sample pages keep their own palettes.
- Design tokens live in `@theme` in `src/index.css`, mapped 1:1 from `design-tokens.md`:
  canonical names (`bg-surface-base`, `rounded-panel`, `ease-morph`, `blur-panel`, …) + short landing aliases (`bg-panel`, `text-draw`, `bg-ink`, …). Both work; prefer canonical names in new code.
- Custom helpers: `.glass` (frosted panel), `.tool-active`, `.duration-morph`, `.delay-stagger-row`, `.font-display`.
- Token doc rule: never introduce new colors/radii/fonts silently — deviations are flagged in the `index.css` header comment (page bg `#141417`, browser mock `#0F0F12`, body `#B8B8C0`, hover `#C4B0FC`, save-ink `#0A2E1B` are landing-derived).
- Tailwind v4 tree-shakes unused non-color theme vars from output; utilities still generate on demand. Verified pattern: use the class, `npm run build`, grep `dist/assets/*.css`.

## App structure
- `src/App.jsx` — router shell (`BrowserRouter` with the Vite base as `basename`, `/` landing, `/playground`, `/privacy`, `/verify`, `/view-my-links`, `/upgraded`, catch-all landing) + scroll-to-top on route change.
- `src/pages/LandingPage.jsx` — entire landing page (data arrays `USES`/`FEATURE_GROUPS`/`SHORTCUTS`/`FAQS` + `ToolbarDemo` interactive toolbar mock with `useState` for tool/color/size). `ToolbarDemo` is a demo, not the real extension.
- `src/pages/PrivacyPage.jsx` — `/privacy` policy page on the dark landing palette: hero + date meta, sticky on-page contents (desktop only), ten policy sections rendered with small local `Paragraph`/`SubHeading`/`Bullets`/`Section` helpers. Policy copy is owner-supplied — don't rewrite it, only re-port it.
- `src/components/SiteFooter.jsx` — shared footer (Duowork line, Home / Playground / Privacy links, copyright) used by the landing and privacy pages.
- `src/pages/PlaygroundPage.jsx` — playground shell: intro, accessible experience tabs, manual activation bar, Reset, sample frame, challenge strip. No extension detection, no annotation canvas — the installed extension does the drawing.
- `src/playground/experiences.js` — tab copy + challenge strip data.
- `src/playground/samples/{FeedbackSample,TeachSample,DiagnoseSample}.jsx` — three self-contained sample pages with local-only state (all reset by remounting via a reset key).
- `src/playground/playground.css` — scoped sample styles and palettes.
- `src/main.jsx` — entry; `src/index.css` — theme + base styles; `index.html` — fonts (Big Shoulders Display + Sora via Google Fonts), favicons, meta.
- Brand icon in use: `svg/capann-icon-light.svg` ("light" = for dark backgrounds, per assets README).

## Capann Premium pages
Sign-in and link recovery for the Premium extension. Everything these pages exchange with the API and the extension is defined in `@capann/contract` (`packages/contract`): change it there, never by hand here, and the API, extension, and this site's helpers are all type-checked against it. No accounts or passwords: a user is an email proven by magic links.
- `src/pages/VerifyPage.jsx` — `/verify?token=…` (single-use, 15-min login token). Pings each extension ID (`capann-ping`) on load; exchanges the token (`POST /api/auth/verify`) **only on click**, because email scanners open links. Hands the 30-day session token to the extension (`capann-session`), and keeps it in memory so a failed hand-off can be retried without spending the link again. Never stores tokens.
- `src/pages/ViewMyLinksPage.jsx` — `/view-my-links?token=…` (reusable 15-min links token). `GET /api/links/list` with `Authorization: Bearer`; countdowns run on server time (skew from the response's `now`), re-rendered every 30s and on tab focus; under 24h is highlighted in cream.
- `src/pages/UpgradedPage.jsx` — `/upgraded`, the Bachs post-checkout redirect. Sends `capann-refresh`, retrying briefly because the webhook can lag.
- API calls go through `@capann/api-client` (`exchangeLoginToken`, `listLinks`, `ApiError`; the server's `error.message` is user-safe) with `API_URL` from `config.js`. Routes for `/verify` and `/view-my-links` come from the contract's `WEBSITE_PATHS`, which the API uses to build the emailed links.
- `src/premium/` — `config.js` (env), `extension.js` (`findExtension`, `handOffSession`, `refreshExtension`, and the underlying `sendToExtension`; pages never build messages themselves, so every message and reply is checked here), `chrome.d.ts` (the `chrome.runtime` slice a page gets), `usePrivatePage.js` (`noindex` + `referrer: no-referrer` while mounted, restored on leave), `PremiumLayout.jsx` (glass header, card, `Notice`, live `StatusLine`, button classes). Errors use `role="alert"`, progress `role="status"`; `--color-error` (#FCA5A5) is the flagged addition in `index.css`.
- Origin is strict: the extension accepts messages only from its exact site origin (`https://capann.duowork.tech`, or `http://localhost:5173` in a local build). Never serve these pages from `www` or another host. `vite.config.js` pins the dev server to port 5173 (`strictPort`) for the same reason.
- Env (Vite, all public): `VITE_CAPANN_API_URL`, `VITE_CAPANN_EXTENSION_IDS` (comma-separated; Web Store ID first, then any unpacked IDs), `VITE_CAPANN_INSTALL_URL` (falls back to `/#pricing`). They live in local, gitignored `.env.development` / `.env.production` (dev: `VITE_CAPANN_API_URL=http://127.0.0.1:8799` plus your unpacked ID; prod: the production API, the Web Store ID and listing URL). Without them the API defaults to production and no extension is found, so `/verify` always asks the visitor to install Capann.
- Local end-to-end, from the repository root: `npm run api:dev -- --port 8799` (magic links print to `apps/api/.wrangler-dev.log` with `EMAIL_TRANSPORT=console`), `npm run build:backend` (the extension, pointed at the local API and this site), load `apps/extension/dist` unpacked, put its ID in `.env.development.local` (or `VITE_CAPANN_EXTENSION_IDS=<id> npm run website:dev`), then `npm run website:dev`.

## Git
Part of the Capann monorepo: work on its `dev` branch like the other apps. This site's history up to the import is preserved there (imported with `git subtree`). Keep commits scoped. `node_modules/` and `dist/` are gitignored — never commit them.
