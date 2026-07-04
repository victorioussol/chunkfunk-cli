import { password } from "@inquirer/prompts";
import pc from "picocolors";
import { writeCredentials } from "../auth/credentials";

export interface LoginOptions {
  token?: string;
  stdout?: (text: string) => void;
}

export async function runLogin(options: LoginOptions = {}): Promise<{ path: string }> {
  const token =
    options.token ??
    (await password({
      message: "ChunkFunk API token",
      mask: "*",
    }));

  if (!token.trim()) throw new Error("API token is required.");

  const path = await writeCredentials({ token: token.trim() });
  const stdout = options.stdout ?? ((text) => process.stdout.write(text));
  stdout(`${pc.green("✓")} Logged in. Credentials saved to ${path}\n`);
  return { path };
}
