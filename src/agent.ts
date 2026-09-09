import { $ } from "bun";
import type { RunConfig } from "./config";
import type { Issue, IssueComment } from "./github";

export interface ContainerMounts {
  worktree: string;
  state: string;
  piHome: string;
}

export function botIdentity(cfg: RunConfig) {
  return {
    name: `${cfg.appSlug}[bot]`,
    email: `${cfg.appId}+${cfg.appSlug}[bot]@users.noreply.github.com`,
  };
}

export async function renderPrompt(cfg: RunConfig, issue: Issue, comments: IssueComment[]): Promise<string> {
  const template = await Bun.file(`${cfg.agentHome}/templates/prompt.md`).text();
  const humanComments = comments.filter((c) => c.user.type !== "Bot");
  const rendered = humanComments.length
    ? `# Comments\n\n${humanComments.map((c) => `**@${c.user.login}:**\n${c.body}`).join("\n\n")}`
    : "";
  return template
    .replace("{{number}}", String(issue.number))
    .replace("{{title}}", issue.title)
    .replace("{{body}}", issue.body ?? "(no description)")
    .replace("{{comments}}", rendered);
}

function dockerRun(cfg: RunConfig, mounts: ContainerMounts, extraEnv: Record<string, string>, command: string[]) {
  const identity = botIdentity(cfg);
  const env = Object.entries({
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
    ...extraEnv,
  }).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return $`docker run --rm ${env} \
    -v ${mounts.worktree}:/work -v ${mounts.state}:/state -v ${mounts.piHome}:/root/.pi/agent \
    -w /work ${cfg.image} ${command}`;
}

export interface AgentRun {
  exitCode: number;
  output: string;
  quotaExhausted: boolean;
}

export async function runAgent(cfg: RunConfig, mounts: ContainerMounts, prompt: string): Promise<AgentRun> {
  await Bun.write(`${mounts.state}/prompt.md`, prompt);
  const proc = await dockerRun(cfg, mounts, {}, [
    "sh",
    "-c",
    `pi -p --model "$AGENT_MODEL" --session /state/session.jsonl --no-extensions -- "$(cat /state/prompt.md)"`,
  ])
    .env({ ...process.env, AGENT_MODEL: cfg.model })
    .nothrow();
  const output = proc.stdout.toString() + proc.stderr.toString();
  await Bun.write(`${mounts.state}/agent-output.log`, output);
  return {
    exitCode: proc.exitCode,
    output,
    quotaExhausted: /usage limit|rate limit|quota/i.test(output) && proc.exitCode !== 0,
  };
}

export interface CheckResult {
  name: string;
  ok: boolean;
  output: string;
}

const CHECKS = ["typecheck", "lint", "test", "build"] as const;

export async function runChecks(cfg: RunConfig, mounts: ContainerMounts): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const install = await dockerRun(cfg, mounts, {}, ["bun", "install"]).nothrow();
  if (install.exitCode !== 0) {
    return [{ name: "install", ok: false, output: install.stdout.toString() + install.stderr.toString() }];
  }
  for (const name of CHECKS) {
    const proc = await dockerRun(cfg, mounts, {}, ["bun", "run", name]).nothrow();
    const output = proc.stdout.toString() + proc.stderr.toString();
    results.push({ name, ok: proc.exitCode === 0, output });
    if (proc.exitCode !== 0) break;
  }
  await Bun.write(`${mounts.state}/checks.log`, results.map((r) => `### ${r.name} (${r.ok ? "ok" : "FAILED"})\n${r.output}`).join("\n\n"));
  return results;
}
