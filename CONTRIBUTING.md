# Contributing to AhorrAR

Thanks for contributing. This is an open-source, Argentina-focused price comparer.

## Ground rules

1. Read [`SPEC.md`](SPEC.md) before large changes (especially §V invariants).
2. Keep UI strings in Spanish; code identifiers in English.
3. Do not add dependencies without discussion.
4. Never commit secrets (`.env`, OAuth tokens, API keys).
5. Respect third-party site terms; prefer official APIs when available (see [`docs/ML.md`](docs/ML.md)).

## Dev setup

```bash
npm run install:all
cd scraper && uv sync
npm run dev:scraper   # :4100
npm run dev:backend   # :4000
npm run dev:frontend  # :5173
```

## Tests

```bash
npm test
```

## Pull requests

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, …).
- One logical change per PR when possible.
- Update SPEC §T/§B when behavior or bugs change.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
