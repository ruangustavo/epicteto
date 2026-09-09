import type { CheckResult } from "./agent";

export interface AgentResult {
  problem: string;
  fix: string;
  notes: string;
  questions: string | null;
}

export function parseResult(markdown: string): AgentResult | null {
  const section = (name: string) => {
    const m = markdown.match(new RegExp(`## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`));
    return m ? m[1].trim() : null;
  };
  const problem = section("Problem");
  const fix = section("Fix");
  if (problem === null || fix === null) return null;
  return { problem, fix, notes: section("Notes") ?? "None.", questions: section("Questions") };
}

export function prBody(issueNumber: number, result: AgentResult, checks: CheckResult[]): string {
  return [
    "### Problem",
    result.problem,
    "",
    "### Fix",
    result.fix,
    "",
    "### Notes",
    result.notes,
    "",
    checksTable(checks),
    "",
    `Closes #${issueNumber}`,
  ].join("\n");
}

export function checksTable(checks: CheckResult[]): string {
  if (checks.length === 0) return "Checks: not run.";
  const cells = checks.map((c) => `${c.name} ${c.ok ? "✅" : "❌"}`);
  return `Checks: ${cells.join(" · ")}`;
}

export function statusComment(opts: {
  phase: string;
  runUrl: string | undefined;
  checks: CheckResult[];
  prUrl?: string;
  detail?: string;
}): string {
  const lines = [`**Agent status:** ${opts.phase}`];
  if (opts.runUrl) lines.push(`Run: ${opts.runUrl}`);
  if (opts.prUrl) lines.push(`PR: ${opts.prUrl}`);
  lines.push(checksTable(opts.checks));
  const failed = opts.checks.find((c) => !c.ok);
  if (failed) {
    lines.push("", `<details><summary>${failed.name} output</summary>`, "", "```", failed.output.slice(-3000), "```", "</details>");
  }
  if (opts.detail) lines.push("", opts.detail);
  return lines.join("\n");
}
