#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { botIdentity, renderPrompt, runAgent, runChecks, runShell, type CheckResult, type ContainerMounts } from "../src/agent";
import { loadConfig, paths, type RunConfig } from "../src/config";
import * as git from "../src/git";
import * as gh from "../src/github";
import { checksTable, parseResult, prBody, statusComment } from "../src/report";
import * as review from "../src/review";
import { composeDown, composeUp, uiTouched, uploadAttachment } from "../src/video";

const cfg = loadConfig();
const p = paths(cfg);
const runUrl = process.env.RUN_URL;
mkdirSync(`${p.state}/videos`, { recursive: true });
mkdirSync(`${p.piHome}/skills`, { recursive: true });
await Bun.$`cp -R ${cfg.agentHome}/skills/verify-ui ${p.piHome}/skills/`.quiet();

const log = (msg: string) => console.log(`[agent-run] ${msg}`);
let checks: CheckResult[] = [];
const mounts: ContainerMounts = { worktree: p.worktree, bareRepo: p.bareRepo, state: p.state, piHome: p.piHome };
const RUNNING = "agent:running";
const TERMINAL = ["agent:in-review", "agent:needs-input", "agent:quota-paused"];

async function finish(phase: string, label: string, extra: { prUrl?: string; detail?: string } = {}) {
  await gh.upsertStatusComment(cfg, statusComment({ phase, runUrl, checks, ...extra }));
  await gh.setLabels(cfg, [label], [RUNNING, ...TERMINAL.filter((l) => l !== label)]);
}

async function reportFatal(err: unknown): Promise<never> {
  const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
  const message = err instanceof Error ? `${err.message}\n${stderr}` : String(err);
  log(`fatal: ${message}`);
  await finish("failed: orchestrator error", "agent:needs-input", {
    detail: `<details><summary>error</summary>\n\n\`\`\`\n${message.slice(-3000)}\n\`\`\`\n</details>`,
  }).catch(() => {});
  process.exit(1);
}

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

const MAX_ATTEMPTS = 5;

/** Is this check also red on main? Then the agent did not cause it. */
async function preExisting(check: CheckResult): Promise<boolean> {
  await git.ensureBaselineWorktree(p.bareRepo, p.baselineWorktree);
  const baselineMounts: ContainerMounts = { ...mounts, worktree: p.baselineWorktree };
  const [onMain] = await runChecks(cfg, baselineMounts, [check.name]);
  return onMain ? !onMain.ok : false;
}

/**
 * Runs the checks. A failure the agent introduced goes back to the agent in the same session
 * until green or MAX_ATTEMPTS turns. A failure that is also red on main is reported and not retried.
 */
async function checksWithRetry(resultFile: string, prUrl?: string): Promise<{ green: boolean; preExisting: CheckResult | null }> {
  for (let attempt = 1; ; attempt++) {
    await gh.upsertStatusComment(cfg, statusComment({ phase: `running: checks (attempt ${attempt}/${MAX_ATTEMPTS})`, runUrl, checks, prUrl }));
    checks = await runChecks(cfg, mounts);
    const failed = checks.find((c) => !c.ok);
    log(`checks attempt ${attempt}: ${checks.map((c) => `${c.name}=${c.ok}`).join(" ")}`);
    if (!failed) return { green: true, preExisting: null };
    if (await preExisting(failed)) {
      log(`${failed.name} is also red on main; not the agent's fault`);
      return { green: false, preExisting: failed };
    }
    if (attempt === MAX_ATTEMPTS) return { green: false, preExisting: null };
    const prompt = await renderTemplate("checks-failed-prompt.md", {
      attempt: String(attempt + 1),
      max: String(MAX_ATTEMPTS),
      check: failed.name,
      output: failed.output.slice(-6000),
      result_file: resultFile,
    });
    const run = await runAgent(cfg, mounts, prompt, `checks-failed-${attempt}.md`);
    log(`retry agent exited ${run.exitCode}`);
    await git.commitLeftovers(p.worktree, botIdentity(cfg));
  }
}

interface Verification {
  url: string | null;
  scenario: string | null;
  failure: string | null;
}

function renderTemplate(name: string, vars: Record<string, string>): Promise<string> {
  return Bun.file(`${cfg.agentHome}/templates/${name}`)
    .text()
    .then((t) => Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v), t));
}

async function recordRound(mountsNet: ContainerMounts, round: number) {
  const script = [
    "set -e",
    "sh /state/boot.sh",
    'URL="$(cat /state/app-url)"',
    "mkdir -p /state/videos",
    'agent-browser open "$URL"',
    `agent-browser record start /state/videos/round-${round}.webm`,
    "set +e",
    "sh /state/verify.sh; rc=$?",
    "agent-browser record stop",
    "agent-browser close",
    "exit $rc",
  ].join("\n");
  return runShell(cfg, mountsNet, script, 600);
}

async function verifyUi(issue: gh.Issue, files: string[], prUrl: string): Promise<Verification> {
  const none: Verification = { url: null, scenario: null, failure: null };
  if (!uiTouched(files, cfg.uiGlobs)) return none;
  if (!cfg.attachToken) return { ...none, failure: "UI changed but ATTACH_TOKEN is not configured; no video." };

  await gh.upsertStatusComment(cfg, statusComment({ phase: "running: recording verification", runUrl, checks, prUrl }));
  const stack = await composeUp(cfg, p.worktree, p.state);
  const mountsNet: ContainerMounts = { ...mounts, network: stack?.network };
  const round = readdirSync(`${p.state}/videos`, { withFileTypes: true }).length + 1;
  const fileList = files.map((f) => `- ${f}`).join("\n");
  try {
    if (!existsSync(`${p.state}/boot.sh`) || !existsSync(`${p.state}/verify.sh`)) {
      const prompt = await renderTemplate("verify-prompt.md", { issue: String(issue.number), title: issue.title, body: issue.body ?? "", files: fileList });
      const run = await runAgent(cfg, mountsNet, prompt, "verify-prompt.md");
      log(`verify agent exited ${run.exitCode}`);
    }
    let rec = await recordRound(mountsNet, round);
    if (rec.exitCode !== 0) {
      log(`replay failed (${rec.exitCode}); asking the agent to repair`);
      const prompt = await renderTemplate("verify-repair-prompt.md", { exit_code: String(rec.exitCode), output: rec.output.slice(-4000), files: fileList });
      await runAgent(cfg, mountsNet, prompt, "verify-repair-prompt.md");
      rec = await recordRound(mountsNet, round);
    }
    await Bun.write(`${p.state}/record-round-${round}.log`, rec.output);
    if (rec.exitCode !== 0) {
      return { ...none, failure: `Verification replay failed (exit ${rec.exitCode}).\n\n<details><summary>output</summary>\n\n\`\`\`\n${rec.output.slice(-3000)}\n\`\`\`\n</details>` };
    }
    const url = await uploadAttachment(cfg, `${p.state}/videos/round-${round}.webm`);
    const scenarioFile = Bun.file(`${p.state}/verify-result.md`);
    const scenario = (await scenarioFile.exists()) ? ((await scenarioFile.text()).match(/## Scenario\s*\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() ?? null) : null;
    log(`video uploaded: ${url}`);
    return { url, scenario, failure: null };
  } finally {
    await composeDown(stack);
  }
}

function verificationMarkdown(v: Verification): string {
  if (v.url) return ["### Verification", v.scenario ?? "", "", v.url].join("\n");
  if (v.failure) return `### Verification\n${v.failure}`;
  return "";
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

  const outcome2 = await checksWithRetry("result.md");
  const green = outcome2.green;
  const finalResult = parseResult(await Bun.file(`${p.state}/result.md`).text()) ?? result;
  if (outcome2.preExisting) finalResult.notes += `\n\n⚠ \`${outcome2.preExisting.name}\` also fails on \`main\`; this failure predates the change.`;

  await git.pushBranch(cfg, p.worktree, branch);
  let body = prBody(issue.number, finalResult, checks);
  const existing = await gh.findOpenPr(cfg, branch);
  const openAsReady = green || outcome2.preExisting !== null;
  const prNumber = existing ?? Number((await gh.createPr(cfg, { branch, title: issue.title, body, draft: !openAsReady })).split("/").pop());
  const prUrl = `https://github.com/${cfg.repo}/pull/${prNumber}`;
  log(`PR ${prUrl}`);

  if (green) {
    const verification = await verifyUi(issue, await git.changedFiles(p.worktree), prUrl);
    const section = verificationMarkdown(verification);
    if (section) body = body.replace(`Closes #${issue.number}`, `${section}\n\nCloses #${issue.number}`);
  }
  await gh.updatePrBody(cfg, prNumber, body);

  if (green) return finish("in review", "agent:in-review", { prUrl });
  if (outcome2.preExisting) return finish(`in review (\`${outcome2.preExisting.name}\` already red on main)`, "agent:in-review", { prUrl });
  return finish(`needs input: checks still failing after ${MAX_ATTEMPTS} attempts, PR opened as draft`, "agent:needs-input", { prUrl });
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
  const outcome2 = await checksWithRetry("review-result.md", prUrl);
  const green = outcome2.green || outcome2.preExisting !== null;

  await git.pushBranch(cfg, p.worktree, pr.headRef);
  const sha = await git.headSha(p.worktree);
  const verification = green
    ? await verifyUi(await gh.fetchIssue(cfg), await git.changedFiles(p.worktree), prUrl)
    : { url: null, scenario: null, failure: null };

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
    "",
    verificationMarkdown(verification),
  ].join("\n");
  await review.commentOnPr(cfg, prNumber, summary);

  await Bun.file(`${p.state}/review-result.md`).delete();
  return green
    ? finish("in review", "agent:in-review", { prUrl })
    : finish(`needs input: checks still failing after ${MAX_ATTEMPTS} attempts`, "agent:needs-input", { prUrl });
}

async function rerecord(cfg: RunConfig, prNumber: number) {
  const prUrl = `https://github.com/${cfg.repo}/pull/${prNumber}`;
  const pr = await review.fetchPullRequest(cfg, prNumber);
  await gh.setLabels(cfg, [RUNNING], TERMINAL);
  await git.ensureBareRepo(cfg, p.bareRepo);
  await git.ensureWorktree(p.bareRepo, p.worktree, pr.headRef);
  const issue = await gh.fetchIssue(cfg);
  const verification = await verifyUi(issue, await git.changedFiles(p.worktree), prUrl);
  const section = verificationMarkdown(verification);
  const body = await gh.prBody(cfg, prNumber);
  const closes = `Closes #${cfg.issueNumber}`;
  const stripped = body.replace(/### Verification[\s\S]*?(?=Closes #)/, "");
  await gh.updatePrBody(cfg, prNumber, stripped.replace(closes, `${section}\n\n${closes}`));
  if (verification.url) await review.commentOnPr(cfg, prNumber, `Re-recorded the verification video:\n\n${verification.url}`);
  return finish(verification.url ? "in review" : "needs input: re-record failed", verification.url ? "agent:in-review" : "agent:needs-input", {
    prUrl,
    detail: verification.failure ?? undefined,
  });
}

try {
  if (cfg.mode.kind === "rerecord") {
    await rerecord(cfg, cfg.mode.prNumber);
  } else if (cfg.mode.kind === "review") {
    await reviewRound(cfg, cfg.mode.prNumber, cfg.mode.reviewBody);
  } else {
    await implement(cfg);
  }
} catch (err) {
  await reportFatal(err);
}
