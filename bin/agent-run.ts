#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { botIdentity, renderPrompt, runAgent, runChecks, type CheckResult, type ContainerMounts } from "../src/agent";
import { loadConfig, paths, type RunConfig } from "../src/config";
import * as git from "../src/git";
import * as gh from "../src/github";
import { checksTable, parseResult, prBody, statusComment } from "../src/report";
import * as review from "../src/review";

const cfg = loadConfig();
const p = paths(cfg);
const runUrl = process.env.RUN_URL;
mkdirSync(p.state, { recursive: true });
mkdirSync(p.piHome, { recursive: true });

const log = (msg: string) => console.log(`[agent-run] ${msg}`);
let checks: CheckResult[] = [];
const mounts: ContainerMounts = { worktree: p.worktree, bareRepo: p.bareRepo, state: p.state, piHome: p.piHome };
const RUNNING = "agent:running";
const TERMINAL = ["agent:in-review", "agent:needs-input", "agent:quota-paused"];

async function finish(phase: string, label: string, extra: { prUrl?: string; detail?: string } = {}) {
  await gh.upsertStatusComment(cfg, statusComment({ phase, runUrl, checks, ...extra }));
  await gh.setLabels(cfg, [label], [RUNNING, ...TERMINAL.filter((l) => l !== label)]);
}

process.on("unhandledRejection", async (err) => {
  const message = err instanceof Error ? `${err.message}\n${(err as { stderr?: Buffer }).stderr?.toString() ?? ""}` : String(err);
  log(`fatal: ${message}`);
  await finish("failed: orchestrator error", "agent:needs-input", {
    detail: `<details><summary>error</summary>\n\n\`\`\`\n${message.slice(-3000)}\n\`\`\`\n</details>`,
  }).catch(() => {});
  process.exit(1);
});

function agentOutputDetails(output: string): string {
  return `<details><summary>agent output</summary>\n\n\`\`\`\n${output.slice(-3000)}\n\`\`\`\n</details>`;
}

async function runAgentAndChecks(prompt: string, resultFileName: string): Promise<{ output: string; resultText: string | null } | "quota" | "no-result"> {
  const run = await runAgent(cfg, mounts, prompt);
  log(`agent exited ${run.exitCode}`);
  if (run.quotaExhausted) return "quota";
  const file = Bun.file(`${p.state}/${resultFileName}`);
  if (!(await file.exists())) return "no-result";
  return { output: run.output, resultText: await file.text() };
}

async function implement(cfg: RunConfig) {
  const issue = await gh.fetchIssue(cfg);
  const comments = await gh.fetchIssueComments(cfg);
  const branch = git.branchName(issue.number, issue.title);
  log(`issue #${issue.number} "${issue.title}" → ${branch}`);

  await gh.setLabels(cfg, [RUNNING], TERMINAL);
  await gh.upsertStatusComment(cfg, statusComment({ phase: "running: implementing", runUrl, checks }));
  await git.ensureBareRepo(cfg, p.bareRepo);
  await git.ensureWorktree(p.bareRepo, p.worktree, branch);

  const prompt = await renderPrompt(cfg, issue, comments);
  const outcome = await runAgentAndChecks(prompt, "result.md");
  if (outcome === "quota") return finish("paused: Codex quota exhausted", "agent:quota-paused");
  if (outcome === "no-result") return finish("needs input: agent produced no result file", "agent:needs-input");

  const result = parseResult(outcome.resultText ?? "");
  if (!result) return finish("needs input: result file is malformed", "agent:needs-input", { detail: agentOutputDetails(outcome.output) });
  if (result.questions) return finish("needs input: the agent has questions", "agent:needs-input", { detail: `### Questions\n${result.questions}` });

  await git.commitLeftovers(p.worktree, botIdentity(cfg));
  if (!(await git.hasCommitsAheadOfMain(p.worktree))) return finish("needs input: agent made no changes", "agent:needs-input");

  await gh.upsertStatusComment(cfg, statusComment({ phase: "running: checks", runUrl, checks }));
  checks = await runChecks(cfg, mounts);
  const green = checks.every((c) => c.ok);
  log(`checks ${green ? "green" : "red"}: ${checks.map((c) => `${c.name}=${c.ok}`).join(" ")}`);

  await git.pushBranch(cfg, p.worktree, branch);
  const body = prBody(issue.number, result, checks);
  const existing = await gh.findOpenPr(cfg, branch);
  const prUrl = existing
    ? (await gh.updatePrBody(cfg, existing, body), `https://github.com/${cfg.repo}/pull/${existing}`)
    : await gh.createPr(cfg, { branch, title: issue.title, body, draft: !green });
  log(`PR ${prUrl}`);

  return green
    ? finish("in review", "agent:in-review", { prUrl })
    : finish("needs input: checks failed, PR opened as draft", "agent:needs-input", { prUrl });
}

async function reviewRound(cfg: RunConfig, prNumber: number, reviewBody: string) {
  const pr = await review.fetchPullRequest(cfg, prNumber);
  const prUrl = `https://github.com/${cfg.repo}/pull/${prNumber}`;
  log(`PR #${prNumber} on ${pr.headRef}: ${pr.threads.length} unresolved thread(s)`);
  if (pr.threads.length === 0 && reviewBody.trim() === "") {
    log("nothing to address");
    return;
  }

  await gh.setLabels(cfg, [RUNNING], TERMINAL);
  await gh.upsertStatusComment(cfg, statusComment({ phase: "running: addressing review", runUrl, checks, prUrl }));
  await git.ensureBareRepo(cfg, p.bareRepo);
  await git.ensureWorktree(p.bareRepo, p.worktree, pr.headRef);
  const conflicts = await git.rebaseOnMain(p.worktree, botIdentity(cfg));
  if (conflicts.length) log(`rebase conflicts: ${conflicts.join(", ")}`);

  const prompt = await review.renderReviewPrompt(cfg, { pr, issue: cfg.issueNumber, reviewBody, conflicts });
  const outcome = await runAgentAndChecks(prompt, "review-result.md");
  if (outcome === "quota") return finish("paused: Codex quota exhausted", "agent:quota-paused", { prUrl });
  if (outcome === "no-result") return finish("needs input: agent produced no review result", "agent:needs-input", { prUrl });
  const result = review.parseReviewResult(outcome.resultText ?? "");
  if (!result) return finish("needs input: review result is malformed", "agent:needs-input", { prUrl, detail: agentOutputDetails(outcome.output) });

  await git.commitLeftovers(p.worktree, botIdentity(cfg));
  await gh.upsertStatusComment(cfg, statusComment({ phase: "running: checks", runUrl, checks, prUrl }));
  checks = await runChecks(cfg, mounts);
  const green = checks.every((c) => c.ok);
  log(`checks ${green ? "green" : "red"}`);

  await git.pushBranch(cfg, p.worktree, pr.headRef);
  const sha = await git.headSha(p.worktree);

  for (const thread of pr.threads) {
    const reply = result.replies.find((r) => r.id === thread.id);
    const first = thread.comments[0];
    if (!reply || !first) continue;
    const prefix = reply.status === "addressed" ? `Addressed in ${sha}: ` : "Not applicable: ";
    await review.replyToThread(cfg, prNumber, first.databaseId, `${prefix}${reply.message}`);
    if (reply.status === "addressed") await review.resolveThread(thread.id);
  }
  const unanswered = pr.threads.filter((t) => !result.replies.some((r) => r.id === t.id));
  const summary = [
    `Addressed the review in ${sha}:`,
    "",
    result.summary,
    "",
    checksTable(checks),
    unanswered.length ? `\n${unanswered.length} thread(s) were not answered by the agent and remain open.` : "",
  ].join("\n");
  await review.commentOnPr(cfg, prNumber, summary);

  await Bun.file(`${p.state}/review-result.md`).delete();
  return green
    ? finish("in review", "agent:in-review", { prUrl })
    : finish("needs input: checks failed after review round", "agent:needs-input", { prUrl });
}

if (cfg.mode.kind === "review") {
  await reviewRound(cfg, cfg.mode.prNumber, cfg.mode.reviewBody);
} else {
  await implement(cfg);
}
