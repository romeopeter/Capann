/**
 * build.mjs
 *
 * esbuild-based bundler for ScreenSlate Chrome extension.
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
import { mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'icons'), { recursive: true });

copyFileSync(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
for (const file of readdirSync(path.join(root, 'icons'))) {
  copyFileSync(path.join(root, 'icons', file), path.join(dist, 'icons', file));
}

const entryPoints = {
  'background/service-worker': path.join(root, 'src/background/service-worker.ts'),
  'content/overlay': path.join(root, 'src/content/overlay.tsx'),
};

const options = {
  entryPoints,
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome102',
  sourcemap: 'inline',
  logLevel: 'info',
  jsx: 'automatic',
  jsxDev: false,
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await build(options);
  console.log(`Built extension into ${dist}`);
}
