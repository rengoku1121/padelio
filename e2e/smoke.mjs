/**
 * Browser smoke test (Playwright Chromium). Run from repo root:
 *   python -m http.server 8765
 *   node e2e/smoke.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const LZString = require(join(__dirname, '../js/lz-string.min.js'));

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';

const allowConsoleError = (text) => {
  const t = String(text);
  return (
    /tailwindcss\.com/i.test(t) ||
    /Failed to load resource.*favicon/i.test(t) ||
    /googletagmanager/i.test(t) ||
    /Failed to load resource.*403/i.test(t) ||
    /ResizeObserver loop/i.test(t)
  );
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem('padelio_update_tip_dismissed_session', '1');
    } catch {}
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  page.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error' && !allowConsoleError(t)) {
      consoleErrors.push(t);
    }
  });

  // --- Home: scripts & version ---
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const versionText = await page.locator('#app-version').textContent();
  if (!versionText || !/Version\s+1\.6\.15/i.test(versionText.trim())) {
    throw new Error(`Expected #app-version "Version 1.6.15", got: ${versionText}`);
  }

  const lzOk = await page.evaluate(() => typeof window.LZString !== 'undefined');
  if (!lzOk) throw new Error('LZString not on window (lz-string.min.js not loaded?)');

  const navigateToOk = await page.evaluate(() => typeof window.navigateTo === 'function');
  if (!navigateToOk) throw new Error('navigateTo missing');

  // --- New tournament wizard (1 court, 4 players) ---
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: /Start New Tournament/i }).click();
  await page.locator('button[onclick="selectMode(\'normal\')"]').click();
  await page.fill('#tournament-title', 'E2E Smoke');
  await page.locator('#page-new-title').getByRole('button', { name: /^Continue$/i }).click();
  await page.locator('.court-btn[data-courts="1"]').click();
  await page.locator('#btn-to-points').click();
  await page.locator('#new-points-standard .points-btn[data-points="21"]').click();
  await page.locator('#btn-to-players').click();

  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
  for (const n of names) {
    await page.fill('#player-name', n);
    await page.getByRole('button', { name: 'Add player' }).click();
  }

  await page.locator('#btn-start').click();
  await page.waitForTimeout(3500);

  const roundsVisible = await page.locator('#page-rounds').evaluate((el) => !el.classList.contains('hidden'));
  if (!roundsVisible) throw new Error('Expected rounds page right after creating tournament');

  const roundInd = await page.locator('#round-indicator').textContent();
  if (!/Round\s+1/i.test(roundInd || '')) {
    throw new Error(`Expected Round 1 indicator, got: ${roundInd}`);
  }

  await page.evaluate(() => window.navigateTo('home'));
  await page.waitForTimeout(800);
  const listText = await page.locator('#tournament-list').textContent();
  if (!listText || !/E2E Smoke/i.test(listText)) {
    throw new Error('Tournament list should show "E2E Smoke" after start');
  }

  // --- Share viewer via LZ hash (minimal valid payload) ---
  const minimal = {
    v: 1,
    title: 'LinkTest',
    mode: 'normal',
    courts: 1,
    points_to_win: 21,
    players: JSON.stringify(
      names.map((name) => ({ name, gender: null }))
    ),
    rounds: JSON.stringify([]),
    current_round: 1
  };
  const enc = 'l' + LZString.compressToEncodedURIComponent(JSON.stringify(minimal));
  // Query avoids BFCache restoring index without re-running scripts (same-tab hash-only nav).
  const shareUrl = `${BASE}/?_=${Date.now()}#p=${enc}`;
  await page.goto(shareUrl, { waitUntil: 'load' });

  await page.waitForFunction(
    () => {
      const pageEl = document.querySelector('#page-share-view');
      const titleEl = document.getElementById('share-view-title');
      return (
        pageEl &&
        !pageEl.classList.contains('hidden') &&
        titleEl &&
        titleEl.textContent.trim() === 'LinkTest'
      );
    },
    { timeout: 25000 }
  );

  await browser.close();

  if (pageErrors.length) {
    console.error('Uncaught page errors:', pageErrors);
    process.exit(1);
  }
  if (consoleErrors.length) {
    console.error('Console errors:', consoleErrors);
    process.exit(1);
  }

  console.log('SMOKE OK — home, wizard, round 1 after create, LZ share viewer');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
