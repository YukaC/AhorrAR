#!/usr/bin/env node
/**
 * Firecrawl recorder (VCR pattern).
 *
 * Calls the Firecrawl API for a small set of representative targets and saves
 * the raw responses as JSON fixtures under ./fixtures/. The mock server
 * (mock-server.mjs) replays those fixtures locally, so the app can develop
 * against a Firecrawl-like API without burning credits.
 *
 * Usage:
 *   node scripts/firecrawl/record.mjs
 *
 * Auth: FIRECRAWL_API_KEY env var, or the CLI credentials stored by
 * `firecrawl config` (~/.config/firecrawl-cli/credentials.json).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = process.env.FIRECRAWL_API_URL ?? 'https://api.firecrawl.dev';
const FIXTURES_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

async function loadApiKey() {
  if (process.env.FIRECRAWL_API_KEY) return process.env.FIRECRAWL_API_KEY;
  try {
    const credentialsPath = join(homedir(), '.config', 'firecrawl-cli', 'credentials.json');
    const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
    if (credentials.apiKey) return credentials.apiKey;
  } catch {
    // No stored credentials; fall through to the error below.
  }
  throw new Error('No Firecrawl API key. Set FIRECRAWL_API_KEY or run `firecrawl config` first.');
}

async function callFirecrawl(path, body, apiKey) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Firecrawl ${path} failed (HTTP ${response.status}): ${json.error ?? JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

// Representative targets: a JS-heavy retail homepage, URL discovery on the
// same site, and a product search. ~3-5 credits per run on the free plan.
// v2 shapes (verified against the live API):
//   scrape: formats are strings; metadata is included by default.
//   map:    links come back as [{ url, title, description }].
//   search: returns { data: { web: [{ url, title, description, position }] } }.
const targets = [
  {
    name: 'scrape-fravega-home',
    path: '/v2/scrape',
    body: {
      url: 'https://www.fravega.com',
      formats: ['markdown', 'links'],
      onlyMainContent: true,
    },
  },
  {
    name: 'map-fravega',
    path: '/v2/map',
    body: { url: 'https://www.fravega.com', limit: 50 },
  },
  {
    name: 'search-iphone16-ar',
    path: '/v2/search',
    body: { query: 'iPhone 16 Argentina', limit: 3 },
  },
];

const apiKey = await loadApiKey();
await mkdir(FIXTURES_DIR, { recursive: true });
const manifest = { recordedAt: new Date().toISOString(), apiUrl: API_URL, targets: [] };

for (const target of targets) {
  process.stderr.write(`Recording ${target.name}... `);
  const json = await callFirecrawl(target.path, target.body, apiKey);
  const fixturePath = join(FIXTURES_DIR, `${target.name}.json`);
  await writeFile(fixturePath, JSON.stringify({ request: target, response: json }, null, 2));
  manifest.targets.push({ name: target.name, path: target.path, request: target.body, fixture: `${target.name}.json` });
  process.stderr.write(`OK (${fixturePath})\n`);
}

await writeFile(join(FIXTURES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
process.stderr.write(`Done. ${manifest.targets.length} fixtures recorded.\n`);