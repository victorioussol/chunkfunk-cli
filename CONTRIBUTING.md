# Contributing to ChunkFunk

Thanks for helping make RAG systems easier to inspect and maintain.

ChunkFunk is early, and that is good news for contributors: schema support, docs, tests, examples, and report clarity all have direct impact. You do not need to be an expert in the whole codebase to help.

## What ChunkFunk protects

ChunkFunk connects to databases that may contain private product, customer, or internal knowledge. These rules are not optional:

- Never add code that writes to a user's database.
- Never send document text, chunk text, connection strings, tokens, or source URLs in telemetry.
- Never log secrets or full connection strings.
- Keep telemetry default-off and easy to inspect with `chunkfunk --show-telemetry`.
- Prefer small, reviewable pull requests.

If a change needs to touch these boundaries, open an issue first.

## Good first contributions

These are useful and beginner-friendly:

- Add docs for a real RAG stack you use.
- Add a fixture for a common Postgres/pgvector schema.
- Improve a confusing error message.
- Add a test for a schema auto-detection edge case.
- Improve the README or sample report explanation.
- Reproduce an issue and add the exact steps.

Look for issues labeled `good first issue`, `documentation`, `schema support`, or `help wanted`.

If this is your first open-source contribution, start with [docs/first-contribution.md](docs/first-contribution.md).

## How to contribute

1. Open or pick an issue.
2. Say what you plan to change.
3. Keep the pull request focused on one problem.
4. Include tests or explain why tests do not apply.
5. Fill out the pull request checklist.

Small pull requests are welcome. A clear 20-line fix is better than a huge mixed refactor.

## Local setup

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
```

Some integration tests need a seeded Postgres + pgvector fixture database. The Docker path is:

```bash
npm run fixtures:up
npm run fixtures:seed
FIXTURES_PG_URL="postgresql://postgres:postgres@127.0.0.1:55432/postgres" npm test
npm run fixtures:down
```

If Docker is not available, any local Postgres with pgvector works. Set `FIXTURES_PG_URL` to that server before running the fixture seed and tests.

## Adding schema support

Schema support is one of the best ways to help.

Please include:

- The tool/framework name, if any.
- A sanitized table shape, not private data.
- Which column contains chunk text.
- Which column contains embeddings.
- Which column or metadata path identifies source/document IDs.
- Whether the schema has timestamps.
- A fixture or test when possible.

Do not paste private documents, real customer data, production connection strings, or secrets into issues.

## Pull request review

Victor is the maintainer and final reviewer. Review will focus on:

- Does this keep user databases read-only?
- Does this protect private data?
- Does this solve one clear problem?
- Does the test coverage match the risk?
- Does the user-facing text make the tool easier to trust?

You can expect direct, practical review comments. The goal is to help the change land, not to make contribution feel like a trial.

Maintainer-specific review guidance lives in [docs/maintainer-review-guide.md](docs/maintainer-review-guide.md).

## Release notes

User-facing changes should include a short note in the pull request body. The maintainer will use those notes when preparing releases.
