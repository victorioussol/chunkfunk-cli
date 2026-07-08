# Maintainer Review Guide

This guide is for Victor when reviewing outside contributions.

## First pass

Ask four questions before reading deeply:

1. Is this change in scope for ChunkFunk?
2. Does it keep user databases read-only?
3. Does it protect private data?
4. Is the pull request small enough to review confidently?

If the answer is no, say that early and explain the safer path.

## Review checklist

- The pull request solves one clear problem.
- The README or docs change matches actual behavior.
- Tests cover the main risk.
- No user database write paths were added.
- No new telemetry fields were added without discussion.
- No private data appears in fixtures, snapshots, logs, or reports.
- CLI output is understandable to a builder who is not deep in the code.

## How to respond

Use direct, practical comments:

- "This is useful, but it needs a fixture so we can keep it working."
- "This would weaken the read-only guarantee. Let's solve it another way."
- "Can you split this into a docs PR and a behavior PR?"
- "This is close. The missing piece is the failure case test."

## When to merge

Merge when:

- CI is green.
- The change is understandable.
- The privacy/read-only boundary is intact.
- The contributor has answered open review questions.

## When to close

Close when:

- The change pushes ChunkFunk outside its mission.
- The contributor will not remove unsafe behavior.
- The issue has gone stale after a clear maintainer response.

Leave a short explanation so future contributors understand the decision.
