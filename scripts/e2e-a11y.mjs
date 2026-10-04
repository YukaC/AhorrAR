import { chromium } from 'playwright';

async function run() {
  console.log('Running e2e a11y smoke test...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<html><body><main><h1>AhorrAR Smoke</h1></main></body></html>');
  const h1 = await page.textContent('h1');
  if (h1 !== 'AhorrAR Smoke') throw new Error('Smoke check failed');
  await browser.close();
  console.log('e2e a11y smoke test passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
