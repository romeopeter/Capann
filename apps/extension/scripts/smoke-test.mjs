// Manual verification helper (not shipped, not part of build) — launches the
// built extension in real Chromium via Playwright and exercises the pencil
// tool end-to-end. Run with: node scripts/smoke-test.mjs
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distPath = path.join(root, 'dist');
const testPageDir =
  '/tmp/claude-0/-home-user-ScreenSlate/724d3f37-42dd-5f4e-bcef-f4d3f0b5b2ba/scratchpad/testpage';

const server = createServer(async (req, res) => {
  try {
    const body = await readFile(path.join(testPageDir, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});
await new Promise((resolve) => server.listen(8973, resolve));

const userDataDir = '/tmp/claude-0/-home-user-ScreenSlate/724d3f37-42dd-5f4e-bcef-f4d3f0b5b2ba/scratchpad/pw-profile';

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    `--disable-extensions-except=${distPath}`,
    `--load-extension=${distPath}`,
    '--headless=new',
    '--no-sandbox',
  ],
});

const consoleErrors = [];

try {
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto('http://localhost:8973/', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const hostExists = await page.evaluate(() => !!document.getElementById('capann-host'));
  console.log('overlay host injected:', hostExists);
  if (!hostExists) throw new Error('overlay host div was not injected by content script');

  const launcher = page.locator('.launcher');
  await launcher.waitFor({ state: 'visible', timeout: 5000 });
  await launcher.click();
  console.log('clicked launcher to enable draw mode');

  const panelVisible = await page.evaluate(() => {
    const host = document.getElementById('capann-host');
    const panel = host?.shadowRoot?.querySelector('.panel');
    return panel ? !panel.hasAttribute('hidden') : false;
  });
  console.log('toolbar panel expanded:', panelVisible);
  if (!panelVisible) throw new Error('toolbar panel did not expand after clicking launcher');

  // Pencil is the default active tool. Drag across the live canvas.
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(300, 260, { steps: 10 });
  await page.mouse.move(400, 200, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const hasInk = await page.evaluate(() => {
    const host = document.getElementById('capann-host');
    const canvas = host?.shadowRoot?.querySelectorAll('canvas')[0];
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const candidates = [
      [250, 230],
      [300, 260],
      [350, 230],
    ];
    return candidates.some(([x, y]) => ctx.getImageData(x * dpr, y * dpr, 1, 1).data[3] > 0);
  });
  console.log('pencil stroke rendered onto objects canvas:', hasInk);
  if (!hasInk) throw new Error('expected non-transparent pixel after drawing a pencil stroke');

  // Switch to eraser and click on the stroke to remove it.
  await page.locator('.tool-btn[title="Eraser"]').click();
  await page.mouse.click(300, 260);
  await page.waitForTimeout(200);
  const erased = await page.evaluate(() => {
    const host = document.getElementById('capann-host');
    const canvas = host?.shadowRoot?.querySelectorAll('canvas')[0];
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const candidates = [
      [250, 230],
      [300, 260],
      [350, 230],
    ];
    return candidates.every(([x, y]) => ctx.getImageData(x * dpr, y * dpr, 1, 1).data[3] === 0);
  });
  console.log('eraser removed the stroke:', erased);
  if (!erased) throw new Error('eraser tool did not remove the pencil stroke');

  if (consoleErrors.length) {
    console.log('Console errors observed:', consoleErrors);
    throw new Error('console errors were logged during the test');
  }

  console.log('\nSMOKE TEST PASSED');
} finally {
  await context.close();
  server.close();
}
