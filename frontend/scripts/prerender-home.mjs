// Prerenders the home page into dist/index.html so JS-less crawlers
// (Claude.ai, Google) see real content instead of an empty #root shell.
// Runs after `vite build`; fails the build if the prerender is missing.
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const frontendRoot = path.resolve(import.meta.dirname, '..');
const distIndexHtml = path.join(frontendRoot, 'dist', 'index.html');
const ROOT_TAG = '<div id="root"></div>';
const IDLE_MARKER = '¿Qué querés ahorrar hoy?';

const server = await createServer({
  root: frontendRoot,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { default: App } = await server.ssrLoadModule('/src/App.tsx');
  const prerenderedHtml = renderToStaticMarkup(createElement(App));

  const indexHtml = await readFile(distIndexHtml, 'utf8');
  if (!indexHtml.includes(ROOT_TAG)) {
    throw new Error(`Prerender failed: ${ROOT_TAG} not found in ${distIndexHtml}`);
  }
  const outputHtml = indexHtml.replace(ROOT_TAG, `<div id="root">${prerenderedHtml}</div>`);
  await writeFile(distIndexHtml, outputHtml);

  if (!outputHtml.includes(IDLE_MARKER)) {
    throw new Error(
      `Prerender check failed: idle marker "${IDLE_MARKER}" missing from ${distIndexHtml}`,
    );
  }
  console.log(`Prerendered home into ${distIndexHtml} (${prerenderedHtml.length} chars)`);
} finally {
  await server.close();
}