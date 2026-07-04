import { confirm, select } from "@inquirer/prompts";

export interface Choice {
  name: string;
  value: string;
}

/**
 * The interaction surface used by introspection, injected so tests can drive the
 * interactive column picker with scripted answers (no TTY).
 */
export interface IntrospectPrompts {
  confirm(message: string, defaultYes: boolean): Promise<boolean>;
  select(message: string, choices: Choice[]): Promise<string>;
  /** Like select but with an appended "none" option that resolves to null. */
  selectOptional(message: string, choices: Choice[]): Promise<string | null>;
}

const NONE = "__none__";

/** Production prompts backed by @inquirer/prompts. */
export const inquirerPrompts: IntrospectPrompts = {
  confirm: (message, defaultYes) => confirm({ message, default: defaultYes }),
  select: (message, choices) => select({ message, choices }),
  async selectOptional(message, choices) {
    const value = await select({
      message,
      choices: [...choices, { name: "(none)", value: NONE }],
    });
    return value === NONE ? null : value;
  },
};
