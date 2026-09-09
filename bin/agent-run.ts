#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { botIdentity, renderPrompt, runAgent, runChecks, type CheckResult } from "../src/agent";
import { loadConfig, paths } from "../src/config";
import * as git from "../src/git";
import * as gh from "../src/github";
import { parseResult, prBody, statusComment } from "../src/report";

const cfg = loadConfig();
const p = paths(cfg);
const runUrl = process.env.RUN_URL;
mkdirSync(p.state, { recursive: true });
mkdirSync(p.piHome, { recursive: true });

const log = (msg: string) => console.log(`[agent-run] ${msg}`);
let checks: CheckResult[] = [];

async function finish(phase: string, labels: { add: string[]; remove: string[] }, extra: { prUrl?: string; detail?: string } = {}) {
  await gh.upsertStatusComment(cfg, statusComment({ phase, runUrl, checks, ...extra }));
  await gh.setLabels(cfg, labels.add, labels.remove);
}

process.on("unhandledRejection", async (err) => {
  const message = err instanceof Error ? `${err.message}\n${(err as { stderr?: Buffer }).stderr?.toString() ?? ""}` : String(err);
  log(`fatal: ${message}`);
  await finish("failed: orchestrator error", { add: ["agent:needs-input"], remove: ["agent:running"] }, {
    detail: `<details><summary>error</summary>\n\n\`\`\`\n${message.slice(-3000)}\n\`\`\`\n</details>`,
  }).catch(() => {});
  process.exit(1);
});

const issue = await gh.fetchIssue(cfg);
const comments = await gh.fetchIssueComments(cfg);
const branch = git.branchName(issue.number, issue.title);
log(`issue #${issue.number} "${issue.title}" → ${branch}`);

await gh.setLabels(cfg, ["agent:running"], ["agent:in-review", "agent:needs-input", "agent:quota-paused"]);
await gh.upsertStatusComment(cfg, statusComment({ phase: "running: implementing", runUrl, checks }));

await git.ensureBareRepo(cfg, p.bareRepo);
await git.ensureWorktree(p.bareRepo, p.worktree, branch);
const mounts = { worktree: p.worktree, bareRepo: p.bareRepo, state: p.state, piHome: p.piHome };

const prompt = await renderPrompt(cfg, issue, comments);
const run = await runAgent(cfg, mounts, prompt);
log(`agent exited ${run.exitCode}`);

if (run.quotaExhausted) {
  await finish("paused: Codex quota exhausted", { add: ["agent:quota-paused"], remove: ["agent:running"] });
  process.exit(0);
}

const resultFile = Bun.file(`${p.state}/result.md`);
const result = (await resultFile.exists()) ? parseResult(await resultFile.text()) : null;
if (!result) {
  await finish("needs input: agent produced no result file", { add: ["agent:needs-input"], remove: ["agent:running"] }, {
    detail: `<details><summary>agent output</summary>\n\n\`\`\`\n${run.output.slice(-3000)}\n\`\`\`\n</details>`,
  });
  process.exit(run.exitCode === 0 ? 1 : run.exitCode);
}

if (result.questions) {
  await finish("needs input: the agent has questions", { add: ["agent:needs-input"], remove: ["agent:running"] }, {
    detail: `### Questions\n${result.questions}`,
  });
  process.exit(0);
}

await git.commitLeftovers(p.worktree, botIdentity(cfg));
if (!(await git.hasCommitsAheadOfMain(p.worktree))) {
  await finish("needs input: agent made no changes", { add: ["agent:needs-input"], remove: ["agent:running"] });
  process.exit(1);
}

await gh.upsertStatusComment(cfg, statusComment({ phase: "running: checks", runUrl, checks }));
checks = await runChecks(cfg, mounts);
const green = checks.every((c) => c.ok);
log(`checks ${green ? "green" : "red"}: ${checks.map((c) => `${c.name}=${c.ok}`).join(" ")}`);

await git.pushBranch(cfg, p.worktree, branch);
const body = prBody(issue.number, result, checks);
const existing = await gh.findOpenPr(cfg, branch);
let prUrl: string;
if (existing) {
  await gh.updatePrBody(cfg, existing, body);
  prUrl = `https://github.com/${cfg.repo}/pull/${existing}`;
} else {
  prUrl = await gh.createPr(cfg, { branch, title: issue.title, body, draft: !green });
}
log(`PR ${prUrl}`);

if (green) {
  await finish("in review", { add: ["agent:in-review"], remove: ["agent:running"] }, { prUrl });
} else {
  await finish("needs input: checks failed, PR opened as draft", { add: ["agent:needs-input"], remove: ["agent:running"] }, { prUrl });
}
