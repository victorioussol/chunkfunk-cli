import type { IntrospectPrompts } from "../../src/introspect/prompts";

/** Deterministic prompts for driving the interactive picker in tests. */
export class ScriptedPrompts implements IntrospectPrompts {
  private ci = 0;
  private si = 0;
  private oi = 0;

  constructor(
    private readonly answers: {
      confirm?: boolean[];
      select?: string[];
      selectOptional?: (string | null)[];
    },
  ) {}

  async confirm(): Promise<boolean> {
    return this.answers.confirm?.[this.ci++] ?? true;
  }

  async select(): Promise<string> {
    const value = this.answers.select?.[this.si++];
    if (value === undefined) throw new Error("ScriptedPrompts: no select answer left");
    return value;
  }

  async selectOptional(): Promise<string | null> {
    return this.answers.selectOptional?.[this.oi++] ?? null;
  }
}

/** Prompts that fail if used — asserts a flow was fully non-interactive. */
export const throwingPrompts: IntrospectPrompts = {
  confirm: () => {
    throw new Error("unexpected confirm()");
  },
  select: () => {
    throw new Error("unexpected select()");
  },
  selectOptional: () => {
    throw new Error("unexpected selectOptional()");
  },
};
