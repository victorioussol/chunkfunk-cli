# Your First ChunkFunk Contribution

Welcome. You do not need to understand the whole project to make a useful contribution.

## Pick one small door

Good first contributions usually fit one of these shapes:

- Fix a confusing sentence in the docs.
- Add a real schema shape to a `schema support` issue.
- Turn a schema report into a fixture.
- Add a test for one detector edge case.
- Improve an error message so a builder knows what to do next.
- Confirm that a bug is reproducible and add exact steps.

## A safe first pull request

Try this size:

- One problem.
- One or two files.
- One clear before/after.
- Tests if behavior changed.

That is enough. You do not need to redesign the tool.

## What maintainers care about

ChunkFunk exists to help builders trust their RAG databases. The review will care most about:

- Does the scanner stay read-only?
- Is private data protected?
- Will this help a builder understand what is wrong?
- Can we keep this working with tests?

## If you are not sure

Open an issue or draft pull request. Partial context is fine as long as private data is removed.

The most useful sentence is: "Here is the RAG layout I use, and here is where ChunkFunk gets confused."
