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
