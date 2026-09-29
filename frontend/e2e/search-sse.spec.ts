import { expect, test } from '@playwright/test';

const shipping = {
  confirmed: true,
  country: 'AR',
  type: 'local',
  free: false,
  note: 'Envío confirmado',
};

const cheap = {
  rank: 1,
  name: 'Notebook HP 15 Ryzen 5',
  price: 799999,
  currency: 'ARS',
  store: { name: 'musimundo.com', logo: null, local: true, siteUrl: 'https://musimundo.com/' },
  url: 'https://musimundo.com/p/nb-cheap',
  image: null,
  shipping: { ...shipping, free: true },
  depth: 0,
  sourceUrl: 'https://musimundo.com/',
};

const expensive = {
  rank: 2,
  name: 'Notebook Lenovo IdeaPad 15 Intel i5',
  price: 999999,
  currency: 'ARS',
  store: { name: 'fravega.com', logo: null, local: true, siteUrl: 'https://fravega.com/' },
  url: 'https://fravega.com/p/nb-expensive',
  image: null,
  shipping,
  depth: 0,
  sourceUrl: 'https://fravega.com/',
};

const params = { product: 'notebook', country: 'AR', maxDepth: 2, maxResults: 25 };

/**
 * E2E SSE mock (T53): no Scrapling. Intercepts API + fakes EventSource progress.
 */
test('SSE partials render and cheapest relevant is #1', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeEventSource {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      readyState = 0;
      url: string;
      constructor(url: string) {
        this.url = url;
        this.readyState = 1;
        const cheap = (window as unknown as { __E2E_CHEAP__: unknown }).__E2E_CHEAP__;
        const expensive = (window as unknown as { __E2E_EXPENSIVE__: unknown }).__E2E_EXPENSIVE__;
        queueMicrotask(() => {
          this.onmessage?.(
            new MessageEvent('message', {
              data: JSON.stringify({
                searchId: 'e2e-mock-1',
                status: 'running',
                depth: 1,
                nodesVisited: 2,
                resultsFound: 1,
                results: [expensive],
              }),
            }),
          );
        });
        queueMicrotask(() => {
          this.onmessage?.(
            new MessageEvent('message', {
              data: JSON.stringify({
                searchId: 'e2e-mock-1',
                status: 'done',
                depth: 2,
                nodesVisited: 4,
                resultsFound: 2,
                results: [cheap, expensive],
                message: 'Búsqueda completada',
              }),
            }),
          );
        });
      }
      close() {
        this.readyState = 2;
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return false;
      }
    }
    (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  await page.addInitScript(
    ({ cheapOffer, expensiveOffer }) => {
      (window as unknown as { __E2E_CHEAP__: unknown }).__E2E_CHEAP__ = cheapOffer;
      (window as unknown as { __E2E_EXPENSIVE__: unknown }).__E2E_EXPENSIVE__ = expensiveOffer;
    },
    { cheapOffer: cheap, expensiveOffer: expensive },
  );

  await page.route('**/api/search', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ searchId: 'e2e-mock-1', status: 'queued', params }),
      });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/search/e2e-mock-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        searchId: 'e2e-mock-1',
        status: 'done',
        params,
        createdAt: new Date().toISOString(),
        progress: {
          searchId: 'e2e-mock-1',
          status: 'done',
          depth: 2,
          nodesVisited: 4,
          resultsFound: 2,
          message: 'Búsqueda completada',
        },
        result: {
          query: params,
          generatedAt: new Date().toISOString(),
          event: {
            activeToday: false,
            nextEvent: { name: 'Hot Sale', date: '2026-05-12', daysLeft: 200 },
          },
          results: [cheap, expensive],
          stats: {
            source: 'live',
            nodesVisited: 4,
            linksQueued: 4,
            pagesFetched: 2,
            maxDepthReached: 1,
            skippedNoShipping: 0,
            skippedDedupe: 0,
            elapsedMs: 100,
          },
          message: 'Búsqueda live completada.',
        },
        error: null,
      }),
    });
  });

  await page.route('**/api/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, mode: 'live', crawler: 'scrapling' }),
    });
  });

  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Producto' }).fill('notebook');
  await page.getByRole('button', { name: 'Buscar' }).click();

  await expect(page.getByText('Notebook HP 15 Ryzen 5').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Mejor precio').first()).toBeVisible();
});
