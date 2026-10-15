import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Real browser coverage of pre-import editing; no production test hooks.
const external = process.env.PATH_EDITOR_URL;
const standalone = process.env.PATH_EDITOR_HTML;
const server = external || standalone ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5185', '--strictPort'], { detached: true, stdio: 'pipe' });
const url = external || 'http://127.0.0.1:5185';
let output = '', browser;
server?.stdout.on('data', b => output += b);
server?.stderr.on('data', b => output += b);
const svg = content => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 200 200">${content}</svg>`);
try {
  if (server) await expect.poll(async () => { if (server.exitCode !== null) throw new Error(output); try { return (await fetch(url)).ok; } catch { return false; } }, { timeout: 15000 }).toBe(true);
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined; });
  page.on('pageerror', error => errors.push(error.message));
  if (standalone) await page.setContent(await readFile(standalone, 'utf8'), { waitUntil: 'load' });
  else await page.goto(url);
  await page.evaluate(() => { window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined; });
  const open = async content => {
    await page.locator('#path-editor-file').setInputFiles({ name: 'editing.svg', mimeType: 'image/svg+xml', buffer: svg(content) });
    await expect(page.locator('#path-editor-dialog')).toBeVisible();
  };
  await expect(page.locator('#object-count')).toHaveText('0');
  // An invalid open contour must be editable, rather than rejected before the editor opens.
  await open('<path fill="none" stroke="black" d="M10 10L90 10L90 90L10 90"/>');
  await expect(page.locator('#path-editor-import')).toBeDisabled();
  await page.locator('#path-editor-close').click();
  await expect(page.locator('#path-editor-import')).toBeEnabled();
  const vertices = page.locator('#path-editor-canvas circle[data-contour][data-point]');
  await expect(vertices).toHaveCount(4);
  await vertices.first().click();
  const before = await vertices.first().getAttribute('cx');
  const box = await vertices.first().boundingBox();
  assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  assert.notEqual(await vertices.first().getAttribute('cx'), before, 'Dragging actually changes the selected vertex');
  await page.locator('#path-editor-add-point').click();
  await expect(vertices).toHaveCount(5);
  await page.locator('#path-editor-delete-point').click();
  await expect(vertices).toHaveCount(4);
  await page.locator('#path-editor-import').click();
  await expect(page.locator('#path-editor-dialog')).not.toBeVisible();
  await expect(page.locator('#object-count')).toHaveText('1');
  // Cancel must leave both scene object count and the old object name untouched.
  const oldName = await page.locator('#object-name').inputValue();
  const saveState = async () => {
    const download = page.waitForEvent('download');
    await page.locator('#project-save').click();
    return JSON.parse(await readFile(await (await download).path(), 'utf8')).state;
  };
  const beforeCancel = await saveState();
  await open('<path d="M0 0H50V50H0Z"/>');
  await page.locator('#path-editor-canvas').focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('w'); await page.keyboard.press('e'); await page.keyboard.press('r');
  await page.locator('#path-editor-cancel').click();
  await expect(page.locator('#object-count')).toHaveText('1');
  await expect(page.locator('#object-name')).toHaveValue(oldName);
  const afterCancel = await saveState();
  assert.deepEqual(afterCancel.objects, beforeCancel.objects, 'Modal shortcuts and cancel cannot alter the existing project');
  assert.equal(afterCancel.view.transformMode, beforeCancel.view.transformMode);
  assert.equal(afterCancel.view.wireframe, beforeCancel.view.wireframe);
  // Layer boundaries separate independent objects, while compound path holes stay together.
  await open('<g inkscape:groupmode="layer" inkscape:label="Donut" id="layer1"><path fill="none" d="M0 0H80V80H0Z M20 20V60H60V20Z"/></g><g inkscape:groupmode="layer" inkscape:label="Box" id="layer2"><path d="M100 0H180V80H100Z"/></g>');
  await expect(page.locator('.path-editor-list input[type="checkbox"]')).toHaveCount(2);
  await page.locator('#path-editor-import').click();
  await expect(page.locator('#object-count')).toHaveText('3');
  await expect(page.locator('#objects')).toContainText('Donut');
  await expect(page.locator('#objects')).toContainText('Box');
  const layeredState = await saveState();
  assert.equal(layeredState.objects[1].shape.holes.length, 1, 'The compound donut retains its real hole after import');
  assert.equal(layeredState.objects[2].shape.holes.length, 0, 'The unrelated layer is a separate solid');
  // Simplification remains a deliberate draft operation and exclusion prevents import.
  await open('<path d="M0 0L10 .1L20 -.1L30 .1L40 0L40 40L0 40Z"/><path d="M100 0H150V50H100Z"/>');
  await expect(vertices).toHaveCount(7);
  await page.locator('#path-editor-tolerance').fill('1');
  await page.locator('#path-editor-reduce').click();
  assert.equal(await vertices.count(), 4, 'Collinear redundant vertices are removed in the draft');
  await page.locator('.path-editor-list input[type="checkbox"]').nth(1).uncheck();
  await page.locator('#path-editor-import').click();
  await expect(page.locator('#object-count')).toHaveText('4');
  await page.setViewportSize({ width: 390, height: 844 });
  await open('<path d="M0 0H40V40H0Z"/>');
  const dimensions = await page.locator('#path-editor-dialog').evaluate(el => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth }));
  assert(dimensions.width <= 390 && dimensions.scroll <= dimensions.client + 1, 'Mobile editor has no horizontal overflow');
  await page.locator('#path-editor-cancel').click();
  assert.deepEqual(errors, []);
  if (standalone) assert.deepEqual(requests, [], 'Standalone editor makes zero network requests');
  console.log('Path editor browser checks passed: open unfilled contour repair, vertex drag/add/delete, import, cancellation, independent SVG layers, reduction and path exclusion.');
} finally {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
}
