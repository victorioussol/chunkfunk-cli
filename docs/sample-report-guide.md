# Sample Report Guide

Open the fake rotten fixture report here:
[sample-rotten-langchain-report.html](sample-rotten-langchain-report.html).

The sample uses generated fixture data. It does not contain real documents,
customers, source URLs, credentials, or production database details.

## What The Sample Shows

The current sample scores `73/100` with `RAG rot: noticeable`. The exact score
can change as detectors improve, but the report is meant to show the first
things a RAG operator should inspect before debugging prompts or models.

The fixture plants several common RAG maintenance problems:

- exact duplicate chunks
- near-duplicate chunks
- very short chunks
- fake secret-looking strings
- missing timestamps
- no approximate vector index on the mapped embedding column

## How To Read It

Start at the top:

- `health` is the overall database-level score.
- `RAG rot` is a plain-language label for the same score.
- `freshness`, `duplication`, `quality`, `risk`, and `coverage` show which area
  pulled the score down.

Then scan findings by severity:

- `CRITICAL` means fix or investigate before trusting retrieval.
- `WARNING` means the system may work, but debugging will be harder.
- `INFO` means useful context or a lower-urgency improvement.

The `Fix first` list is the triage path. It groups repeated row-level findings
so the report does not tell you to fix the same class of problem five times.

## Privacy Guarantees In The Report

The sample report uses the same privacy rules as real scans:

- no chunk text
- no document text
- no raw metadata values
- no source locators
- no connection strings

Evidence blocks use counts, percentages, safe refs, safe metadata keys, and
hash-style labels. That makes the report safe to share in an issue or screenshot
when you still need help understanding the result.

## What To Do With Your Own Report

If your first scan looks like this sample:

- fix obvious risk findings first
- remove or collapse duplicate chunks
- add source/citation locators before relying on generated citations
- add timestamps if users ask freshness or "latest" questions
- add an HNSW or IVFFlat pgvector index once the table is large enough

ChunkFunk does not prove your retrieval chain is good. It tells you whether the
stored evidence layer looks healthy enough to debug retrieval seriously.
