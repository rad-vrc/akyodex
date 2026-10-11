// Local-only diagnostic, not a timing assertion for shared CI machines.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.RENDER_BASE_URL || 'http://localhost:3108';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('This authenticated UI fixture must only run against a local server');
}
const output = path.resolve('output/playwright/rendering', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const software = process.env.RENDER_GPU !== 'on';
const viewport = { width: Number(process.env.RENDER_WIDTH || 4800), height: Number(process.env.RENDER_HEIGHT || 2700) };
const deviceScaleFactor = Number(process.env.RENDER_SCALE || 0.8);
const browser = await chromium.launch({ channel: process.env.RENDER_CHANNEL || 'chrome', headless: true, args: software ? ['--disable-gpu'] : [] });
const session = await browser.newBrowserCDPSession();
const { gpu } = await session.send('SystemInfo.getInfo');
const report = { browser: browser.version(), featureStatus: gpu.featureStatus, viewport, deviceScaleFactor, results: [] };
console.log(JSON.stringify(report));
try {
  for (let round = 0; round < Number(process.env.RENDER_ROUNDS || 3); round++) {
    for (const route of ['admin', 'zukan']) {
      for (const variant of round % 2 ? ['current', 'previous-effects'] : ['previous-effects', 'current']) {
        const context = await browser.newContext({ viewport, deviceScaleFactor, locale: 'ja-JP', serviceWorkers: 'block', bypassCSP: true });
        try {
          if (variant === 'previous-effects') {
            // Reproduce the previous decorations while the real compositor stays software.
            await context.addInitScript(() => {
              const original = HTMLCanvasElement.prototype.getContext;
              HTMLCanvasElement.prototype.getContext = function (type, ...args) {
                if (type === 'webgl') return {
                  RENDERER: 7937, isContextLost: () => false,
                  getParameter: () => 'Rendering comparison fixture',
                  getExtension: name => name === 'WEBGL_lose_context' ? { loseContext() {} } : null,
                };
                return original.call(this, type, ...args);
              };
            });
          }
          const page = await context.newPage();
          await page.route('**/api/admin/verify-session', r => r.fulfill({ json: { authenticated: true, role: 'owner' } }));
          await page.route('**/api/admin/next-id', r => r.fulfill({ json: { nextId: '9999' } }));
          await page.route('**/*', r => {
            if (!['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) || /sentry|dify/i.test(r.request().url())) return r.abort();
            return r.fallback();
          });
          await page.goto(`${baseURL}/${route}`, { waitUntil: 'networkidle', timeout: 120_000 });
          if (route === 'admin') await page.getByRole('button', { name: '編集・削除', exact: true }).click();
          if (variant === 'previous-effects') await page.addStyleTag({ content: '.admin-edit-scroll{will-change:auto!important}' });
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(() => {
            const table = document.querySelector('table');
            if (table) table.parentElement.scrollTop = 1800;
            else window.scrollTo(0, 2100);
          });
          await page.waitForTimeout(2000);
          await page.evaluate(() => {
            const table = document.querySelector('table');
            if (table) table.parentElement.scrollTop = 0;
            else window.scrollTo(0, 300);
          });
          await page.waitForTimeout(5000);
          await page.mouse.move(1, 1);
          const mode = await page.locator('html').getAttribute('data-reduced-effects');
          const mini = await page.locator('.mini-akyo').count();
          if (software && variant === 'current' && (mode !== 'true' || mini)) throw new Error('Automatic reduction failed');
          if (!round) await page.screenshot({ path: path.join(output, `${route}-${variant}.png`) });
          const cdp = await context.newCDPSession(page);
          const events = [];
          cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
          await cdp.send('Tracing.start', { categories: 'devtools.timeline,cc,benchmark', transferMode: 'ReportEvents' });
          await page.evaluate(() => {
            window.renderFrames = []; window.renderMeasuring = true;
            const tick = t => { if (window.renderMeasuring) { window.renderFrames.push(t); requestAnimationFrame(tick); } };
            requestAnimationFrame(tick);
          });
          const point = route === 'admin' ? await page.locator('table').evaluate(el => {
            const b = el.parentElement.getBoundingClientRect(); return { x: b.x+b.width/2, y: b.y+b.height/2 };
          }) : { x: viewport.width/2, y: 650 };
          await cdp.send('Input.synthesizeScrollGesture', { ...point, yDistance: -1800, speed: 600, gestureSourceType: 'mouse' });
          const scrollEnd = await page.evaluate(() => document.querySelector('table')?.parentElement.scrollTop ?? window.scrollY);
          if (scrollEnd < 1000) throw new Error('The comparison did not actually scroll');
          await cdp.send('Input.synthesizeScrollGesture', { ...point, yDistance: 1800, speed: 600, gestureSourceType: 'mouse' });
          const frames = await page.evaluate(() => {
            window.renderMeasuring = false;
            return window.renderFrames.slice(1).map((t,i) => t-window.renderFrames[i]);
          });
          const ended = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
          await cdp.send('Tracing.end'); await ended;
          const duration = name => events.filter(e => e.ph === 'X' && e.name === name).reduce((sum,e) => sum + e.dur/1000, 0);
          frames.sort((a,b) => a-b);
          const result = { route, variant, round, mode, mini, scrollEnd,
            frameMedianMs: frames[Math.floor(frames.length*.5)], frameP95Ms: frames[Math.floor(frames.length*.95)],
            rasterMs: duration('RasterTask'), drawMs: duration('DirectRenderer::DrawFrame') };
          report.results.push(result);
          console.log(JSON.stringify(result));
          if (process.env.RENDER_TRACE === '1') await writeFile(path.join(output, `${route}-${variant}-${round}.json`), JSON.stringify({ traceEvents: events }));
        } finally { await context.close(); }
      }
    }
  }
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`Saved: ${output}`);
  await browser.close();
}
