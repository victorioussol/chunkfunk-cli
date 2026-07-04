import { Command } from "commander";
import pc from "picocolors";
import { runInit } from "./commands/init";
import { runLogin } from "./commands/login";
import { DEFAULT_MIN_SCORE, runScan } from "./commands/scan";
import { runSync } from "./commands/sync";
import { runShowTelemetry } from "./commands/telemetry";
import { readPackageVersion } from "./version";

const program = new Command();

program
  .name("chunkfunk")
  .description("Scan a RAG database read-only and report what's stale, duplicated, or broken.")
  .version(readPackageVersion())
  .option("--show-telemetry", "print the exact anonymous telemetry payload that would be sent, then exit")
  .action(async (opts: { showTelemetry?: boolean }) => {
    if (!opts.showTelemetry) {
      program.help();
      return;
    }
    try {
      await runShowTelemetry();
    } catch (error) {
      process.stderr.write(pc.red(`✗ ${(error as Error).message}\n`));
      process.exitCode = 1;
    }
  });

program
  .command("init")
  .description("Introspect the database and write chunkfunk.yaml")
  .option("--yes", "accept detected mapping without prompting", false)
  .option("--force", "re-introspect even if chunkfunk.yaml already exists", false)
  .option("--connection-env <name>", "env var holding the connection string", "DATABASE_URL")
  .option("--name <name>", "name for this RAG system", "my-rag")
  .action(async (opts: { yes: boolean; force: boolean; connectionEnv: string; name: string }) => {
    try {
      const result = await runInit({
        yes: opts.yes,
        force: opts.force,
        connectionEnv: opts.connectionEnv,
        systemName: opts.name,
      });
      if (!result.created) {
        process.stderr.write(pc.dim("chunkfunk.yaml already initialized; use --force to redo.\n"));
        return;
      }
      const intro = result.introspection;
      process.stderr.write(
        pc.green("✓ ") +
          `Mapped ${pc.bold(result.config.mapping?.table ?? "")} ` +
          `(${intro?.recipeId}, ${intro?.embeddingModelGuess ?? "unknown model"})\n` +
          pc.dim(`  wrote ${result.path}\n`),
      );
    } catch (error) {
      process.stderr.write(pc.red(`✗ ${(error as Error).message}\n`));
      process.exitCode = 1;
    }
  });

program
  .command("scan")
  .description("Scan the database read-only and report findings")
  .option("--json", "print ReportV1 to stdout (logs go to stderr)", false)
  .option("--html <path>", "also write a self-contained HTML report")
  .option("--ci", "no prompts; exit 1 when the score is below --min-score", false)
  .option("--min-score <n>", "minimum acceptable health score for --ci", String(DEFAULT_MIN_SCORE))
  .option("--yes", "accept a detected mapping without prompting", false)
  .action(
    async (opts: {
      json: boolean;
      html?: string;
      ci: boolean;
      minScore: string;
      yes: boolean;
    }) => {
      try {
        const { exitCode } = await runScan({
          json: opts.json,
          htmlPath: opts.html,
          ci: opts.ci,
          minScore: Number(opts.minScore),
          yes: opts.yes,
        });
        process.exitCode = exitCode;
      } catch (error) {
        process.stderr.write(pc.red(`✗ ${(error as Error).message}\n`));
        process.exitCode = 1;
      }
    },
  );

program
  .command("login")
  .description("Store a ChunkFunk API token locally")
  .option("--token <token>", "API token (otherwise prompted)")
  .action(async (opts: { token?: string }) => {
    try {
      await runLogin({ token: opts.token });
    } catch (error) {
      process.stderr.write(pc.red(`✗ ${(error as Error).message}\n`));
      process.exitCode = 1;
    }
  });

program
  .command("sync")
  .description("Scan and sync the report to ChunkFunk")
  .option("--yes", "accept a detected mapping without prompting", false)
  .option("--api-url <url>", "ChunkFunk API URL", undefined)
  .action(async (opts: { yes: boolean; apiUrl?: string }) => {
    try {
      await runSync({ yes: opts.yes, apiUrl: opts.apiUrl });
    } catch (error) {
      process.stderr.write(pc.red(`✗ ${(error as Error).message}\n`));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(pc.red(`✗ ${(error as Error).message}\n`));
  process.exitCode = 1;
});
