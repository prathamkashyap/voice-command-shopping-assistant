import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { renderPrecacheManifest } from '../scripts/update-precache.mjs';
import { STATIC_ASSETS } from '../public/precache-manifest.js';

const publicRoot = new URL('../public/', import.meta.url);
const applicationOrigin = 'https://app.invalid';
const assetPaths = new Set(STATIC_ASSETS);
const readAsset = path => readFile(new URL(path.slice(1), publicRoot), 'utf8');

function assertReference(reference, from) {
  if (reference.startsWith('#')) return;
  const url = new URL(reference, applicationOrigin + from);
  if (url.origin !== applicationOrigin) return;
  assert.ok(assetPaths.has(url.pathname), `${from} requires missing release asset ${url.pathname}`);
}

test('the precache version and content match the complete release shell', async () => {
  assert.equal(await readAsset('/precache-manifest.js'), await renderPrecacheManifest(),
    'Regenerate with node scripts/update-precache.mjs after changing public assets');
});

test('the HTML shell, module graph, and manifest reference shipped files', async () => {
  const html = await readAsset('/index.html');
  for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assertReference(reference, '/index.html');
  }
  for (const path of STATIC_ASSETS.filter(path => path.endsWith('.js'))) {
    const module = await readAsset(path);
    for (const [, reference] of module.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
      assertReference(reference, path);
    }
  }
  const manifest = JSON.parse(await readAsset('/manifest.json'));
  for (const icon of [...manifest.icons, ...manifest.shortcuts.flatMap(shortcut => shortcut.icons)]) {
    assertReference(icon.src, '/manifest.json');
  }
});
