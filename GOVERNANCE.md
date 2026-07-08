# Governance

ChunkFunk is currently a maintainer-led open-source project.

## Maintainer

Victor Solares is the maintainer and final reviewer.

## Project direction

The project is focused on helping builders inspect and maintain existing RAG databases safely. The core product promise is:

- local-first
- read-only by construction
- privacy-preserving
- useful without an account
- clear enough for builders to trust

Changes that make ChunkFunk harder to trust, harder to inspect, or more likely to expose private data will be declined even if they are technically interesting.

## Decision process

For small fixes, a pull request with passing checks is enough.

For larger changes, open an issue first so the maintainer can confirm the direction before anyone spends time implementing it.

Large changes include:

- New telemetry fields.
- New network calls.
- New database access patterns.
- New report formats.
- New schema recipes that need fixtures.
- Changes to scoring logic.

## Review standard

The maintainer reviews for correctness, privacy, product clarity, and user trust. The preferred outcome is a small, understandable change that can be safely released.

The maintainer review playbook is in [docs/maintainer-review-guide.md](docs/maintainer-review-guide.md).
