import { $ } from "bun";
import { existsSync } from "node:fs";
import type { RunConfig } from "./config";
import { assetSchema, readJson } from "./github-api";

export function uiTouched(files: string[], globs: string[]): boolean {
  if (globs.length === 0) return false;

  const matchers = globs.map((g) => new Bun.Glob(g));

  return files.some((f) => matchers.some((m) => m.match(f)));
}

export interface ComposeStack {
  project: string;
  network: string;
}

function composeFile(worktree: string): string | null {
  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    if (existsSync(`${worktree}/${name}`)) return `${worktree}/${name}`;
  }

  return null;
}

/** Boots the repo's compose services with host ports removed; the agent container joins the network instead. */
export async function composeUp(
  cfg: RunConfig,
  worktree: string,
  stateDir: string,
): Promise<ComposeStack | null> {
  const file = composeFile(worktree);

  if (!file) return null;

  const project = `agent-${cfg.name}-${cfg.issueNumber}`.toLowerCase();
  const services = (await $`docker compose -f ${file} config --services`.text())
    .split("\n")
    .filter(Boolean);
  const override = `services:\n${services.map((s) => `  ${s}:\n    ports: !reset []\n`).join("")}`;
  const overridePath = `${stateDir}/compose.override.yml`;

  await Bun.write(overridePath, override);
  await $`docker compose -p ${project} -f ${file} -f ${overridePath} up -d --wait`.quiet();

  return {
    project,
    network: `${project}_default`,
  };
}

export async function composeDown(stack: ComposeStack | null): Promise<void> {
  if (!stack) return;

  await $`docker compose -p ${stack.project} down -v --remove-orphans`.quiet().nothrow();
}

export async function uploadAttachment(cfg: RunConfig, filePath: string): Promise<string> {
  if (!cfg.attachToken) throw new Error("ATTACH_TOKEN is not set");

  const repoId: number = await $`gh api repos/${cfg.repo} --jq .id`.json();
  const name = filePath.split("/").pop() ?? "video.webm";
  const url = new URL("https://uploads.github.com/user-attachments/assets");

  url.searchParams.set("name", name);
  url.searchParams.set("content_type", "video/webm");
  url.searchParams.set("repository_id", String(repoId));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.attachToken}`,
      "Content-Type": "application/octet-stream",
      Accept: "application/vnd.github+json",
    },
    body: Bun.file(filePath),
  });
  const asset = await readJson(res, assetSchema, "attachment upload");

  return asset.url;
}
