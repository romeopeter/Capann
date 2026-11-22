/**
 * build.mjs
 *
 * esbuild-based bundler for Capann Chrome extension.
 * Compiles TypeScript + React (JSX) to browser-compatible JavaScript.
 *
 * Usage:
 * - `npm run build`: Production build to dist/
 * - `npm run watch`: Development mode with auto-rebuild on file changes
 *
 * Key features:
 * - TypeScript → JavaScript compilation
 * - React JSX transformation (automatic runtime)
 * - Bundle splitting (background service worker + content script)
 * - Manifest and icon copying
 */

import { build, context } from 'esbuild';
import { mkdirSync, copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

// Edition: `--edition=free|premium` overrides capann.config.json, which holds
// the default for the checked-out branch (dev/premium: premium, free: free).
const EDITIONS = ['free', 'premium'];
const config = JSON.parse(readFileSync(path.join(root, 'capann.config.json'), 'utf8'));
const argValue = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const edition = argValue('edition') ?? config.edition;
if (!EDITIONS.includes(edition)) {
  console.error(`Unknown edition "${edition}". Use one of: ${EDITIONS.join(', ')}.`);
  process.exit(1);
}
const premium = edition === 'premium';

// Premium backend and website. `--api-url=` / `--site-url=` point a local build
// at `wrangler dev` and the website's dev server without editing the config.
function origin(name, value) {
  try {
    const url = new URL(value);
    if (url.pathname !== '/' || url.search || url.hash) throw new Error('path');
    return url.origin;
  } catch {
    console.error(`${name} must be a bare origin like https://example.com, got "${value}".`);
    process.exit(1);
  }
}
const apiUrl = origin('apiUrl', argValue('api-url') ?? config.apiUrl);
const siteUrl = origin('siteUrl', argValue('site-url') ?? config.siteUrl);

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'icons'), { recursive: true });
mkdirSync(path.join(dist, 'offscreen'), { recursive: true });
mkdirSync(path.join(dist, 'permissions'), { recursive: true });
mkdirSync(path.join(dist, 'sidepanel'), { recursive: true });

// The manifest is generated per edition. The free build ships exactly
// manifest.json (which includes the side panel: its Screenshot tab is free);
// Premium adds only the website, as the one page allowed to hand the
// extension a sign-in session.
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (premium) {
  // Match patterns cannot name a port, and a pattern without one matches all,
  // so a localhost dev site still connects.
  const site = new URL(siteUrl);
  manifest.externally_connectable = { matches: [`${site.protocol}//${site.hostname}/*`] };
}
writeFileSync(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const file of readdirSync(path.join(root, 'icons'))) {
  copyFileSync(path.join(root, 'icons', file), path.join(dist, 'icons', file));
}
copyFileSync(path.join(root, 'src/offscreen/offscreen.html'), path.join(dist, 'offscreen.html'));
copyFileSync(path.join(root, 'src/permissions/permissions.html'), path.join(dist, 'permissions.html'));
copyFileSync(path.join(root, 'src/sidepanel/sidepanel.html'), path.join(dist, 'sidepanel.html'));

const entryPoints = {
  'background/service-worker': path.join(root, 'src/background/service-worker.ts'),
  'content/overlay': path.join(root, 'src/content/overlay.tsx'),
  'offscreen/recorder': path.join(root, 'src/offscreen/recorder.ts'),
  'permissions/permissions': path.join(root, 'src/permissions/permissions.ts'),
  'sidepanel/sidepanel': path.join(root, 'src/sidepanel/sidepanel.tsx'),
};

const options = {
  entryPoints,
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  sourcemap: 'inline',
  logLevel: 'info',
  jsx: 'automatic',
  jsxDev: false,
  define: {
    __CAPANN_EDITION__: JSON.stringify(edition),
    __CAPANN_API_URL__: JSON.stringify(apiUrl),
    __CAPANN_SITE_URL__: JSON.stringify(siteUrl),
  },
};

const target = premium ? ` (api ${apiUrl}, site ${siteUrl})` : '';
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`Watching for changes (${edition} edition${target})...`);
} else {
  await build(options);
  console.log(`Built ${edition} edition into ${dist}${target}`);
}
