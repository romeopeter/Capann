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

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/ (+ 404.html SPA fallback)
npm run lint     # oxlint
```
