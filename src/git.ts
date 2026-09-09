import { $ } from "bun";
import { existsSync } from "node:fs";
import type { RunConfig } from "./config";

function remoteUrl(cfg: RunConfig): string {
  return `https://x-access-token:${cfg.token}@github.com/${cfg.repo}.git`;
}

export function branchName(issueNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `agent/${issueNumber}-${slug}`;
}

export async function ensureBareRepo(cfg: RunConfig, bareRepo: string): Promise<void> {
  if (!existsSync(bareRepo)) {
    await $`git clone --bare --quiet ${remoteUrl(cfg)} ${bareRepo}`.quiet();
  }
  const refspec = "+refs/heads/main:refs/heads/main";
  await $`git -C ${bareRepo} fetch --quiet --prune ${remoteUrl(cfg)} ${refspec}`.quiet();
}

export async function ensureWorktree(bareRepo: string, worktree: string, branch: string): Promise<void> {
  if (existsSync(worktree)) {
    await $`git -C ${worktree} checkout --quiet ${branch}`.quiet();
    return;
  }
  await $`git -C ${bareRepo} worktree add --quiet -B ${branch} ${worktree} main`.quiet();
}

export async function hasCommitsAheadOfMain(worktree: string): Promise<boolean> {
  const count = await $`git -C ${worktree} rev-list --count main..HEAD`.text();
  return Number(count.trim()) > 0;
}

export async function commitLeftovers(worktree: string, identity: { name: string; email: string }): Promise<boolean> {
  const status = await $`git -C ${worktree} status --porcelain`.text();
  if (status.trim() === "") return false;
  await $`git -C ${worktree} add -A`.quiet();
  await $`git -C ${worktree} -c user.name=${identity.name} -c user.email=${identity.email} commit --quiet -m "chore: uncommitted agent changes"`.quiet();
  return true;
}

export async function pushBranch(cfg: RunConfig, worktree: string, branch: string): Promise<void> {
  await $`git -C ${worktree} push --quiet --force ${remoteUrl(cfg)} HEAD:refs/heads/${branch}`.quiet();
}

export async function changedFiles(worktree: string): Promise<string[]> {
  const out = await $`git -C ${worktree} diff --name-only main...HEAD`.text();
  return out.split("\n").filter(Boolean);
}

export async function headSha(worktree: string): Promise<string> {
  return (await $`git -C ${worktree} rev-parse --short HEAD`.text()).trim();
}

/** Rebases the worktree on main. Returns the conflicting files (empty when clean); aborts on conflict. */
export async function rebaseOnMain(worktree: string, identity: { name: string; email: string }): Promise<string[]> {
  const result = await $`git -C ${worktree} -c user.name=${identity.name} -c user.email=${identity.email} rebase --quiet main`.quiet().nothrow();
  if (result.exitCode === 0) return [];
  const conflicts = (await $`git -C ${worktree} diff --name-only --diff-filter=U`.text()).split("\n").filter(Boolean);
  await $`git -C ${worktree} rebase --abort`.quiet().nothrow();
  return conflicts;
}
