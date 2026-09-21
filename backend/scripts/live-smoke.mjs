#!/usr/bin/env node
/** One-shot live smoke: POST search and poll until done. */
const base = process.env.API || 'http://localhost:4000';
const body = {
  product: process.argv[2] || 'perfume',
  country: 'AR',
  maxDepth: Number(process.argv[3] || 1),
  maxResults: Number(process.argv[4] || 5),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = await fetch(`${base}/api/search`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const queued = await post.json();
if (!post.ok) {
  console.error('POST failed', queued);
  process.exit(1);
}
console.log('queued', queued.searchId, body);

const start = Date.now();
for (;;) {
  const snap = await (await fetch(`${base}/api/search/${queued.searchId}`)).json();
  const p = snap.progress || {};
  process.stdout.write(
    `\r${snap.status} depth=${p.depth ?? '-'} nodes=${p.nodesVisited ?? '-'} results=${p.resultsFound ?? '-'} ${(Date.now() - start) / 1000}s   `,
  );
  if (snap.status === 'done' || snap.status === 'error') {
    console.log();
    if (snap.error) {
      console.error('ERROR', snap.error);
      process.exit(1);
    }
    const r = snap.result;
    console.log(
      JSON.stringify(
        {
          source: r.stats.source,
          results: r.results.length,
          pagesFetched: r.stats.pagesFetched,
          nodesVisited: r.stats.nodesVisited,
          elapsedMs: r.stats.elapsedMs,
          sample: r.results.slice(0, 5).map((x) => ({
            name: x.name,
            price: x.price,
            url: x.url,
            image: Boolean(x.image),
            store: x.store.name,
            freeShip: x.shipping.free ?? false,
          })),
        },
        null,
        2,
      ),
    );
    process.exit(r.stats.source === 'live' && r.results.length > 0 ? 0 : 2);
  }
  if (Date.now() - start > 180_000) {
    console.error('\ntimeout');
    process.exit(3);
  }
  await sleep(1500);
}
