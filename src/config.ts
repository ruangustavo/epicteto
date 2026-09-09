export type RunMode =
  | { kind: "implement" }
  | { kind: "review"; prNumber: number; reviewBody: string }
  | { kind: "rerecord"; prNumber: number };

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
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

export function loadConfig(): RunConfig {
  const repo = required("REPO");
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`REPO must be owner/name, got ${repo}`);
  const pr = process.env.PR;
  const mode: RunMode = pr
    ? process.env.RERECORD === "true"
      ? { kind: "rerecord", prNumber: Number(pr) }
      : { kind: "review", prNumber: Number(pr), reviewBody: process.env.REVIEW_BODY ?? "" }
    : { kind: "implement" };
  return {
    mode,
    repo,
    owner,
    name,
    issueNumber: Number(required("ISSUE")),
    token: required("GH_TOKEN"),
    appSlug: required("APP_SLUG"),
    appId: required("APP_ID"),
    agentHome: required("AGENT_HOME"),
    agentData: required("AGENT_DATA"),
    model: process.env.AGENT_MODEL ?? "openai-codex/gpt-5.5",
    image: process.env.AGENT_IMAGE ?? "agent-runner:local",
    uiGlobs: (process.env.UI_GLOBS ?? "").split(",").map((g) => g.trim()).filter(Boolean),
    attachToken: process.env.ATTACH_TOKEN || null,
  };
}

export function paths(cfg: RunConfig) {
  const base = `${cfg.agentData}/${cfg.owner}/${cfg.name}`;
  return {
    bareRepo: `${base}/repo.git`,
    worktree: `${base}/worktrees/issue-${cfg.issueNumber}`,
    state: `${base}/state/issue-${cfg.issueNumber}`,
    piHome: `${cfg.agentData}/pi-home`,
  };
}
