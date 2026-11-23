# Capann ![](public/png/capann-icon-light-32.png)

Capann helps guide attention and capture clean screen recording.

Marketing website for the browser tool.

- `/` — landing page
- `/playground` — interactive playground with three sample pages to annotate using the installed Capann extension
- `/privacy` — privacy policy
- `/verify?token=…` — Capann Premium sign-in (emailed by the extension)
- `/view-my-links?token=…` — recover live share links (emailed from the side panel's "Lost a link?")
- `/upgraded` — post-checkout page that asks the extension to re-check Premium

The Premium pages read `VITE_CAPANN_API_URL`, `VITE_CAPANN_EXTENSION_IDS` (comma-separated, Web Store ID first) and `VITE_CAPANN_INSTALL_URL`. Set them in local, gitignored `.env.development` / `.env.production` files (for development, point the API at `http://127.0.0.1:8799` and list your unpacked extension's ID). They only work on the exact origin the extension trusts: `https://capann.duowork.tech`, or `http://localhost:5173` for a local build.

This is the `apps/website` workspace of the Capann monorepo. Install once at
the repository root, then run its scripts from there:

```bash
npm install              # at the repo root
npm run website:dev      # local dev server (http://localhost:5173)
npm run website:build    # production build to apps/website/dist (+ 404.html SPA fallback)
npm run website:lint     # oxlint
npm run typecheck        # includes this site's Premium helpers (src/premium/*.js)
```

Deploys are automatic: `.github/workflows/website.yml` publishes the site to
this repository's GitHub Pages (`https://capann.duowork.tech`) on every push to
`main` that touches it. The deployed site's `VITE_CAPANN_*` values are GitHub
Actions variables (Settings → Secrets and variables → Actions → Variables).

(`npm run dev`, `build`, and so on also work from inside `apps/website`.)
