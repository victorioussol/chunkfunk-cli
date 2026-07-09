# Terminal Transcript

This transcript was captured from the bundled CLI against the fake
`fixture_langchain` database. The command examples are shown with `npx chunkfunk`
because that is how users run the published package. The local temp path and
database URL were normalized so the transcript is safe to publish.

The scan uses `--ci --min-score 0` only to keep the transcript non-interactive.
For normal local use, run `npx chunkfunk scan`.

```bash
$ DATABASE_URL="postgresql://chunkfunk_readonly:password@localhost:5432/fixture_langchain" npx chunkfunk init --yes --name docs-fixture
✓ Mapped public.langchain_pg_embedding (langchain-pgvector, openai text-embedding-3-small or ada-002 (guess))
  wrote ./chunkfunk.yaml

$ DATABASE_URL="postgresql://chunkfunk_readonly:password@localhost:5432/fixture_langchain" npx chunkfunk scan --ci --min-score 0
Running detectors…

  ChunkFunk   73/100  health · RAG rot: noticeable · 298 chunks · 0 sources
  freshness  --  duplication  58  quality  83  risk  25  coverage 100

CRITICAL (4)
  exact_duplicate  10.1% of the corpus is exact-duplicated
  risky_chunk  Chunk contains what looks like a secret
  risky_chunk  Chunk contains what looks like a secret
  risky_chunk  Chunk contains what looks like a secret

WARNING (31)
  exact_duplicate  3 chunks are exact duplicates
  exact_duplicate  3 chunks are exact duplicates
  exact_duplicate  3 chunks are exact duplicates
  exact_duplicate  3 chunks are exact duplicates
  exact_duplicate  3 chunks are exact duplicates
  exact_duplicate  … +5 more
  near_duplicate  Two chunks are near-duplicates
  near_duplicate  Two chunks are near-duplicates
  near_duplicate  Two chunks are near-duplicates
  near_duplicate  Two chunks are near-duplicates
  near_duplicate  Two chunks are near-duplicates
  near_duplicate  … +15 more
  architecture  Your index has no timestamps — staleness can't be measured

INFO (26)
  thin_chunk  Thin chunk (short)
  thin_chunk  Thin chunk (short)
  thin_chunk  Thin chunk (short)
  thin_chunk  Thin chunk (short)
  thin_chunk  Thin chunk (short)
  thin_chunk  … +20 more
  architecture  Mapped embedding column has no approximate vector index yet

Fix first
  1. 10.1% of the corpus is exact-duplicated
  2. Chunk contains what looks like a secret
  3. Two chunks are near-duplicates
  4. Your index has no timestamps — staleness can't be measured
  5. Thin chunk (short)

  Share-safe: no chunk text, metadata values, source locators, or connection strings are printed.
  Run `chunkfunk sync` to track your health score over time.
```

The terminal GIF source remains in [chunkfunk-demo.tape](chunkfunk-demo.tape).
No fake GIF recording is committed.
