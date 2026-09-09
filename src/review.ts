import { $ } from "bun";
import type { RunConfig } from "./config";

export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  comments: { databaseId: number; author: string; body: string; diffHunk: string }[];
}

export interface PullRequestInfo {
  number: number;
  headRef: string;
  headSha: string;
  threads: ReviewThread[];
}

interface ThreadsResponse {
  data: {
    repository: {
      pullRequest: {
        headRefName: string;
        headRefOid: string;
        reviewThreads: {
          nodes: {
            id: string;
            isResolved: boolean;
            path: string;
            line: number | null;
            comments: { nodes: { databaseId: number; author: { login: string } | null; body: string; diffHunk: string }[] };
          }[];
        };
      };
    };
  };
}

const THREADS_QUERY = `query($o:String!,$r:String!,$n:Int!){
  repository(owner:$o,name:$r){ pullRequest(number:$n){
    headRefName headRefOid
    reviewThreads(first:100){ nodes{ id isResolved path line
      comments(first:50){ nodes{ databaseId author{login} body diffHunk } } } } } } }`;

export async function fetchPullRequest(cfg: RunConfig, prNumber: number): Promise<PullRequestInfo> {
  const res: ThreadsResponse =
    await $`gh api graphql -f query=${THREADS_QUERY} -F o=${cfg.owner} -F r=${cfg.name} -F n=${prNumber}`.json();
  const pr = res.data.repository.pullRequest;
  return {
    number: prNumber,
    headRef: pr.headRefName,
    headSha: pr.headRefOid,
    threads: pr.reviewThreads.nodes
      .filter((t) => !t.isResolved)
      .map((t) => ({
        id: t.id,
        path: t.path,
        line: t.line,
        comments: t.comments.nodes.map((c) => ({
          databaseId: c.databaseId,
          author: c.author?.login ?? "unknown",
          body: c.body,
          diffHunk: c.diffHunk,
        })),
      })),
  };
}

export function issueNumberFromBranch(branch: string): number | null {
  const m = branch.match(/^agent\/(\d+)-/);
  return m ? Number(m[1]) : null;
}

export async function renderReviewPrompt(
  cfg: RunConfig,
  opts: { pr: PullRequestInfo; issue: number; reviewBody: string; conflicts: string[] },
): Promise<string> {
  const template = await Bun.file(`${cfg.agentHome}/templates/review-prompt.md`).text();
  const threads = opts.pr.threads
    .map((t) => {
      const where = t.line ? `${t.path}:${t.line}` : t.path;
      const hunk = t.comments[0]?.diffHunk ? `\`\`\`diff\n${t.comments[0].diffHunk}\n\`\`\`\n` : "";
      const comments = t.comments.map((c) => `**@${c.author}:** ${c.body}`).join("\n\n");
      return `### thread:${t.id}\nLocation: \`${where}\`\n${hunk}${comments}`;
    })
    .join("\n\n");
  const rebase =
    opts.conflicts.length > 0
      ? `# Rebase conflicts\n\nThe branch could not be rebased on the base branch. Run \`git rebase ${cfg.baseBranch}\`, resolve conflicts in these files first, then continue:\n${opts.conflicts.map((f) => `- ${f}`).join("\n")}`
      : "";
  return template
    .replace("{{pr}}", String(opts.pr.number))
    .replace("{{issue}}", String(opts.issue))
    .replace("{{rebase}}", rebase)
    .replace("{{review_body}}", opts.reviewBody.trim() || "(no summary, see threads)")
    .replace("{{threads}}", threads || "(none)");
}

export type ThreadStatus = "addressed" | "not-applicable";
export interface ThreadReply {
  id: string;
  status: ThreadStatus;
  message: string;
}
export interface ReviewResult {
  summary: string;
  replies: ThreadReply[];
}

export function parseReviewResult(markdown: string): ReviewResult | null {
  const summary = markdown.match(/## Summary\s*\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim();
  if (summary === undefined) return null;
  const replies: ThreadReply[] = [];
  const blockRe = /### thread:(\S+)\s*\nstatus:\s*(addressed|not-applicable)\s*\n([\s\S]*?)(?=\n### thread:|$)/g;
  for (const m of markdown.matchAll(blockRe)) {
    replies.push({ id: m[1], status: m[2] as ThreadStatus, message: m[3].trim() });
  }
  return { summary, replies };
}

export async function replyToThread(cfg: RunConfig, prNumber: number, commentId: number, body: string): Promise<void> {
  const payload = new Response(JSON.stringify({ body }));
  await $`gh api -X POST repos/${cfg.repo}/pulls/${prNumber}/comments/${commentId}/replies --input - < ${payload}`.quiet();
}

export async function resolveThread(threadId: string): Promise<void> {
  const mutation = `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }`;
  await $`gh api graphql -f query=${mutation} -F id=${threadId}`.quiet();
}

export async function commentOnPr(cfg: RunConfig, prNumber: number, body: string): Promise<void> {
  const payload = new Response(JSON.stringify({ body }));
  await $`gh api -X POST repos/${cfg.repo}/issues/${prNumber}/comments --input - < ${payload}`.quiet();
}
