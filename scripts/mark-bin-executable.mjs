import { chmod } from "node:fs/promises";

await chmod(new URL("../dist/chunkfunk", import.meta.url), 0o755);
