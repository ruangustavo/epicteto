export type RunMode =
  | { kind: "implement" }
  | {
      kind: "review";
      prNumber: number;
      reviewBody: string;
    }
  | {
      kind: "rerecord";
      prNumber: number;
    };

export interface RunConfig {
  mode: RunMode;
  repo: string;
  owner: string;
  name: string;
  issueNumber: number;
  token: string;
  appSlug: string;
  appId: string;
  agentHome: string;
  agentData: string;
  model: string;
  image: string;
  uiGlobs: string[];
  attachToken: string | null;
  /** Commands run in order inside the container; the first one is setup (install) and always runs before any other. */
  checks: string[];
  baseBranch: string;
  /** Where AGENT_DATA lives on the Docker host, when the orchestrator itself runs in a container. */
  hostAgentData: string;
}

function required(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`missing env ${name}`);

  return value;
}

const DEFAULT_CHECKS = [
  "bun install",
  "bun run typecheck",
  "bun run lint",
  "bun run test",
  "bun run build",
];

export async function loadConfig(): Promise<RunConfig> {
  const repo = required("REPO");
  const [owner, name] = repo.split("/");

  if (!owner || !name) throw new Error(`REPO must be owner/name, got ${repo}`);

  const pr = process.env.PR;
  const mode: RunMode = pr
    ? process.env.RERECORD === "true"
      ? {
          kind: "rerecord",
          prNumber: Number(pr),
        }
      : {
          kind: "review",
          prNumber: Number(pr),
          reviewBody: process.env.REVIEW_BODY ?? "",
        }
    : { kind: "implement" };

  return {
    mode,
    repo,
    owner,
    name,
    issueNumber: Number(required("ISSUE")),
    token: await resolveToken(repo),
    appSlug: await resolveAppSlug(),
    appId: required("APP_ID"),
    agentHome: required("AGENT_HOME"),
    agentData: required("AGENT_DATA"),
    model: process.env.AGENT_MODEL ?? "openai-codex/gpt-5.5",
    image: process.env.AGENT_IMAGE ?? "epicteto-agent:local",
    uiGlobs: (process.env.UI_GLOBS ?? "")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
    attachToken: process.env.ATTACH_TOKEN || null,
    checks: (process.env.CHECKS ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean).length
      ? (process.env.CHECKS ?? "")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
      : DEFAULT_CHECKS,
    baseBranch: process.env.BASE_BRANCH || "main",
    hostAgentData: process.env.HOST_AGENT_DATA || required("AGENT_DATA"),
  };
}

async function resolveToken(repo: string): Promise<string> {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

  const appId = required("APP_ID");
  const keyPath = required("APP_PRIVATE_KEY_PATH");
  const { mintInstallationToken } = await import("./app-token");
  const token = await mintInstallationToken(appId, await Bun.file(keyPath).text(), { repo });

  process.env.GH_TOKEN = token;

  return token;
}

async function resolveAppSlug(): Promise<string> {
  if (process.env.APP_SLUG) return process.env.APP_SLUG;

  const { fetchAppSlug } = await import("./app-token");

  return fetchAppSlug(required("APP_ID"), await Bun.file(required("APP_PRIVATE_KEY_PATH")).text());
}

/** Translates a path under AGENT_DATA to the equivalent path on the Docker host. */
export function hostPath(cfg: RunConfig, p: string): string {
  return p.startsWith(cfg.agentData) ? cfg.hostAgentData + p.slice(cfg.agentData.length) : p;
}

export function paths(cfg: RunConfig) {
  const base = `${cfg.agentData}/${cfg.owner}/${cfg.name}`;

  return {
    bareRepo: `${base}/repo.git`,
    worktree: `${base}/worktrees/issue-${cfg.issueNumber}`,
    baselineWorktree: `${base}/worktrees/baseline`,
    state: `${base}/state/issue-${cfg.issueNumber}`,
    piHome: `${cfg.agentData}/pi-home`,
  };
}
