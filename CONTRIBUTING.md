# Contributing

Thanks for helping keep offline recovery dependable.

## Ground rules

- **Never break old bundles.** Changes must keep every file in `test-vectors/` opening. A change to the bundle format means a new `formatVersion`, a new section in `FORMAT.md` and new test vectors; old versions stay supported forever.
- **No network access.** The tool must keep working from a local file with the Content Security Policy in `index.html` unchanged.
- **Small and auditable.** New runtime dependencies need a strong reason.

## Development

```sh
pnpm install
pnpm dev:tool     # recover.html with hot reload
pnpm test
pnpm lint
pnpm typecheck
```

## Commits

Commits follow `type: :gitmoji: summary`, for example `feat: :sparkles: show progress while deriving keys` or `fix: :bug: accept codes pasted with line breaks`.
