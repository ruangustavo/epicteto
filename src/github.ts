import { $ } from "bun";
import type { RunConfig } from "./config";

export interface IssueComment {
  user: { login: string; type: string };
  body: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
}

const STATUS_MARKER = "<!-- agent-status -->";

export async function fetchIssue(cfg: RunConfig): Promise<Issue> {
  return await $`gh api repos/${cfg.repo}/issues/${cfg.issueNumber}`.json();
}

export async function fetchIssueComments(cfg: RunConfig): Promise<IssueComment[]> {
  return await $`gh api --paginate repos/${cfg.repo}/issues/${cfg.issueNumber}/comments`.json();
}

export async function setLabels(cfg: RunConfig, add: string[], remove: string[]): Promise<void> {
  for (const label of remove) {
    await $`gh api -X DELETE repos/${cfg.repo}/issues/${cfg.issueNumber}/labels/${encodeURIComponent(label)}`.quiet().nothrow();
  }
  if (add.length > 0) {
    const body = JSON.stringify({ labels: add });
    await $`gh api -X POST repos/${cfg.repo}/issues/${cfg.issueNumber}/labels --input - < ${new Response(body)}`.quiet();
  }
}

export async function upsertStatusComment(cfg: RunConfig, markdown: string): Promise<void> {
  const body = `${STATUS_MARKER}\n${markdown}`;
  const comments = await fetchIssueComments(cfg);
  const existing = comments.find((c) => c.user.type === "Bot" && c.body.startsWith(STATUS_MARKER));
  const payload = new Response(JSON.stringify({ body }));
  if (existing) {
    const all: { id: number; body: string }[] =
      await $`gh api --paginate repos/${cfg.repo}/issues/${cfg.issueNumber}/comments`.json();
    const id = all.find((c) => c.body.startsWith(STATUS_MARKER))?.id;
    if (id) {
      await $`gh api -X PATCH repos/${cfg.repo}/issues/comments/${id} --input - < ${payload}`.quiet();
      return;
    }
  }
  await $`gh api -X POST repos/${cfg.repo}/issues/${cfg.issueNumber}/comments --input - < ${payload}`.quiet();
}

export async function findOpenPr(cfg: RunConfig, branch: string): Promise<number | null> {
  const prs: { number: number }[] =
    await $`gh pr list -R ${cfg.repo} --head ${branch} --state open --json number`.json();
  return prs[0]?.number ?? null;
}

export async function createPr(
  cfg: RunConfig,
  opts: { branch: string; title: string; body: string; draft: boolean },
): Promise<string> {
  const draft = opts.draft ? ["--draft"] : [];
  const url = await $`gh pr create -R ${cfg.repo} --base main --head ${opts.branch} --title ${opts.title} --body ${opts.body} ${draft}`.text();
  return url.trim();
}

export async function updatePrBody(cfg: RunConfig, prNumber: number, body: string): Promise<void> {
  await $`gh pr edit ${prNumber} -R ${cfg.repo} --body ${body}`.quiet();
}

export async function prBody(cfg: RunConfig, prNumber: number): Promise<string> {
  return (await $`gh pr view ${prNumber} -R ${cfg.repo} --json body --jq .body`.text()).trimEnd();
}
