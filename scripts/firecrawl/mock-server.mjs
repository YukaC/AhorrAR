#!/usr/bin/env node
/**
 * Firecrawl mock server.
 *
 * Replays the fixtures recorded by record.mjs with the same API shape as
 * Firecrawl (POST /v2/scrape, /v2/map, /v2/search), so the app can develop
 * against a Firecrawl-like API without burning credits.
 *
 * Usage:
 *   node scripts/firecrawl/mock-server.mjs   # listens on :4101 (PORT env)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 4101);
const FIXTURES_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

async function loadFixtures() {
  const manifest = JSON.parse(await readFile(join(FIXTURES_DIR, 'manifest.json'), 'utf8'));
  const fixtures = new Map();
  for (const target of manifest.targets) {
    const raw = JSON.parse(await readFile(join(FIXTURES_DIR, target.fixture), 'utf8'));
    fixtures.set(`${target.path}|${JSON.stringify(target.request)}`, raw.response);
  }
  return fixtures;
}

function matchFixture(fixtures, path, body) {
  const exact = fixtures.get(`${path}|${JSON.stringify(body)}`);
  if (exact) return exact;
  // Fall back to matching by the identifying field (url for scrape/map, query for search).
  for (const [key, response] of fixtures) {
    const [fixturePath, fixtureBodyRaw] = key.split('|');
    if (fixturePath !== path) continue;
    const fixtureBody = JSON.parse(fixtureBodyRaw);
    if (path === '/v2/search' && fixtureBody.query === body.query) return response;
    if (fixtureBody.url === body.url) return response;
  }
  return null;
}

const fixtures = await loadFixtures();

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const body = rawBody ? JSON.parse(rawBody) : {};
  const path = req.url.split('?')[0];

  const response = matchFixture(fixtures, path, body);
  res.setHeader('Content-Type', 'application/json');
  if (!response) {
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, error: `No fixture for ${path}. Run record.mjs first.` }));
    return;
  }
  process.stderr.write(`${req.method} ${path} -> fixture\n`);
  res.end(JSON.stringify(response));
});

server.listen(PORT, () => {
  process.stderr.write(`Firecrawl mock listening on http://localhost:${PORT}\n`);
});