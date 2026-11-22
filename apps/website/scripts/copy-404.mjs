import { copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Static hosting (GitHub Pages) has no SPA rewrite. Serving index.html as
// 404.html lets deep links such as /playground boot the router.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

await copyFile(resolve(root, 'dist/index.html'), resolve(root, 'dist/404.html'))
console.log('playground: copied dist/index.html → dist/404.html')
