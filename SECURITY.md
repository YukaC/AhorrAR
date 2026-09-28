# Security Policy

## Supported versions

Security fixes are accepted against the `main` branch of this repository.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security bugs that could put users or operators at risk.

1. Prefer a **private GitHub Security Advisory** on [YukaC/AhorrAR](https://github.com/YukaC/AhorrAR), or
2. Contact the maintainers via a private channel listed on the GitHub profile/org.

Include:
- description of the issue
- steps to reproduce
- impact assessment
- any suggested fix

We aim to acknowledge reports within **7 days**.

## Scope (examples)

In scope:
- remote code execution, SSRF against the crawler/API
- secrets leakage in the repo or client bundles
- auth bypass on OAuth callback routes (when enabled)

Out of scope:
- denial of service against third-party shops you crawl
- issues that only affect outdated forks
- missing best-practice headers without a demonstrated impact

## Operator responsibilities

If you deploy AhorrAR:
- never commit `.env`, tokens, or `MELI_CLIENT_SECRET`
- keep dependencies updated (`npm audit`, `uv lock`)
- rate-limit public search endpoints if exposed to the internet
- respect robots.txt / site terms and local law

## Safe Harbor

Good-faith research that follows this policy and avoids privacy harm / data destruction will not be treated as malicious by the maintainers.

## CodeQL false positives (documented)

These CodeQL findings are intentionally left as-is. They are not URL/HTML security
controls; they are content classifiers or parsers.

| Alert | Path:line | Rule | Why wontfix |
| --- | --- | --- | --- |
| #1–4, #9–11 (and py siblings) | `scripts/audit_pdp_links.py:88`, `scripts/probe_ar_shops.py:80,82`, `scraper/.../crawl.py:301`, `scraper/.../parsers.py:572`, `backend/test/live.test.ts:58`, `backend/test/seeds.test.ts:99,171` | `*/incomplete-url-substring-sanitization` | Checks look for the literal host string `cdn.shopify.com` (or similar) **inside HTML body text**, not as a URL sanitizer. CodeQL assumes URL-sanitization context. |
| #6 | `backend/src/search/parsers/generic.ts:65` | `js/incomplete-multi-character-sanitization` | Strips `<script>` tags only to feed JSON-LD into `JSON.parse`. Output is never re-injected into HTML. |
| #7 | `backend/src/search/seeds.ts:208` | `js/double-escaping` | `decodeHtmlEntities` decodes Bing/DDG href entities (`&amp;` first). Not an encode path; no XSS sink. |

Real fix shipped: `backend/src/utils/ids.ts` — rejection sampling for unbiased `shortId` (was `js/biased-cryptographic-random`).

## Dependabot wontfix (documented)

| Alert | Package | Why wontfix |
| --- | --- | --- |
| #1 | `stream-json` (via `crawlee` → `@crawlee/core`) | Patched line is `>=3.5.0`. Crawlee 3.18 still imports `stream-json/streamers/StreamArray` (1.x layout). Forcing 3.7.0 breaks backend suites (`Cannot find module .../StreamArray`). Waiting on crawlee to support stream-json 3.x. |
