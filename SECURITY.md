# Security Policy

ChunkFunk is a local-first CLI that connects to user databases, so security reports are taken seriously.

## Supported versions

Only the latest published `0.x` version is currently supported.

## What to report privately

Please do not open a public issue for:

- A way to make ChunkFunk write to a user's database.
- A leaked connection string, token, secret, document, or chunk.
- Telemetry that includes private content or connection details.
- Command output that exposes sensitive data.
- A dependency or packaging issue that makes installs unsafe.

Use GitHub's private vulnerability reporting flow from the repository Security tab when available. If that is not available, open a public issue with only this title: `Security contact needed`. Do not include exploit details in that public issue.

## What is safe to file publicly

It is fine to open normal issues for:

- Incorrect findings.
- Schema auto-detection failures.
- Documentation bugs.
- Fixture/test failures.
- Confusing error messages.

Remove private data before sharing logs, schemas, screenshots, or reports.

## Security expectations for pull requests

Security-sensitive changes need tests. At minimum, they should show that:

- User database sessions remain read-only.
- Telemetry contains no document text, chunk text, URLs, tokens, or connection strings.
- Error paths do not print secrets.
- HTML reports do not load external resources.
