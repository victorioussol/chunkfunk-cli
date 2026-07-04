import { chmod } from "node:fs/promises";

await chmod(new URL("../dist/chunkfunk.mjs", import.meta.url), 0o755);
