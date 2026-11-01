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
import { mkdirSync, copyFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

// Edition: `--edition=free|premium` overrides capann.config.json, which holds
// the default for the checked-out branch (dev/premium: premium, free: free).
const EDITIONS = ['free', 'premium'];
const config = JSON.parse(readFileSync(path.join(root, 'capann.config.json'), 'utf8'));
const editionArg = process.argv.find((arg) => arg.startsWith('--edition='));
const edition = editionArg ? editionArg.slice('--edition='.length) : config.edition;
if (!EDITIONS.includes(edition)) {
  console.error(`Unknown edition "${edition}". Use one of: ${EDITIONS.join(', ')}.`);
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'icons'), { recursive: true });
mkdirSync(path.join(dist, 'offscreen'), { recursive: true });
mkdirSync(path.join(dist, 'permissions'), { recursive: true });

copyFileSync(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
for (const file of readdirSync(path.join(root, 'icons'))) {
  copyFileSync(path.join(root, 'icons', file), path.join(dist, 'icons', file));
}
copyFileSync(path.join(root, 'src/offscreen/offscreen.html'), path.join(dist, 'offscreen.html'));
copyFileSync(path.join(root, 'src/permissions/permissions.html'), path.join(dist, 'permissions.html'));

const entryPoints = {
  'background/service-worker': path.join(root, 'src/background/service-worker.ts'),
  'content/overlay': path.join(root, 'src/content/overlay.tsx'),
  'offscreen/recorder': path.join(root, 'src/offscreen/recorder.ts'),
  'permissions/permissions': path.join(root, 'src/permissions/permissions.ts'),
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
  define: { __CAPANN_EDITION__: JSON.stringify(edition) },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`Watching for changes (${edition} edition)...`);
} else {
  await build(options);
  console.log(`Built ${edition} edition into ${dist}`);
}
