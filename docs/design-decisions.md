# Design decisions

Each entry says what we chose, what we rejected, and why. The date is when the decision was made.

## GitHub Actions with a self-hosted runner, not a daemon (2026-09-08)

Chosen: the repo's own Actions workflow routes events to a runner you host.
Rejected: a webhook receiver behind a tunnel, or a poller, with its own queue.
Why: GitHub already gives you event filters, per-issue concurrency, a sender gate, logs and re-runs
in the PR's checks tab. A daemon would have to rewrite all of that. And since the runner is yours,
pi, Chromium and your repos' dependencies are already installed and warm.

## A GitHub App as the agent's identity (2026-09-08)

Chosen: an App you create, installed on the repos, with tokens minted per job.
Rejected: the default `GITHUB_TOKEN`; a PAT of your own account; a machine user.
Why: events produced with the default token never trigger other workflows, and its PRs belong to
`github-actions[bot]`. With your own PAT the agent's replies look exactly like your reviews, so the
trigger either loops or needs markers to tell them apart, and you can't approve your own PR. A
machine user costs a second account and a long-lived credential. With the App, PRs read as
`<slug>[bot]`, its events do trigger workflows, the sender gate is a single comparison, and it can
mint its own runner registration token.

## A PAT still exists, for one HTTP call (2026-09-08)

Chosen: a fine-grained PAT with `Pull requests: write`, used only to upload videos.
Rejected: uploading with the App; release assets; an external bucket; driving GitHub's UI.
Why: GitHub's attachment endpoint (`uploads.github.com/user-attachments/assets`) answers 404 to App
installation tokens. We tested it: `ghs_` got 404, `gho_` got 201. The `gh` CLI has the same rule
as an allowlist of token prefixes. The uploaded asset belongs to the repository, not to whoever
uploaded it, so the App can post the URL and GitHub renders the player under the App's name. The PAT
never posts anything, so it leaves no trace. Release assets don't render inline, and a bucket would
move the videos off GitHub.

## Which review events wake the agent (2026-09-09)

Chosen: a review submitted as "Request changes", or as "Comment" with text in the summary box.
Rejected: every `pull_request_review_comment`; every review regardless of state.
Why: GitHub stores a single inline comment as a review with state `commented` and an empty body,
which is indistinguishable from a batched review with one comment and no text. Reacting to each
inline comment would start N runs against the same worktree. The review state and body are the only
signals that separate "I'm done reviewing, go" from "I'm still typing". Approve never triggers.

## The container holds no token (2026-09-08)

Chosen: the orchestrator reads from GitHub and posts to GitHub. The model sees rendered prompts and
a worktree, and answers with files in a fixed shape.
Rejected: giving the agent `gh` and a token.
Why: posting stays deterministic and the comment format doesn't depend on the model. The prompts of
round 1 and round 2 are plain files you can diff. An issue body written to manipulate the model, or a
malicious `postinstall` in a dependency, can't push, comment, or read other repos.

## Configuration lives in three places (2026-09-08)

The workflow env holds `UI_GLOBS` and `CHECKS`, the gates the orchestrator evaluates without a
model call. The workflow file is already the one file you copy into a repo, so it costs nothing to
put them there. `AGENTS.md` holds the boot recipe and the conventions, as prose the model reads the
same way pi reads it on your laptop. The runner's `.env` holds every credential, so nothing secret
ever enters the target repository.

We rejected a manifest file that the orchestrator would parse for boot commands. It would either
duplicate `AGENTS.md` or turn a deterministic gate into prose parsing.

## Verification scripts live outside the repo (2026-09-08)

Chosen: the agent writes `boot.sh` and `verify.sh` into the issue's state directory on the runner.
The orchestrator replays them for every re-record. The agent only edits them when a replay fails.
Rejected: committing them to the branch; letting the agent improvise the recording each round.
Why: improvised recordings take a different path every round, so you can't compare two videos.
Committed scripts accumulate in the repo. Scripts in the state directory can be replayed and
diffed, and they disappear with the PR. The cost is that deleting the state directory loses them.

## Checks run in the workflow, and a red one goes back to the agent (2026-09-09)

Chosen: after the agent's turn, the orchestrator runs `CHECKS`. If a check fails on the branch but
passes on the base branch, the failure goes back into the same session, up to five turns. If it
also fails on the base branch it was already broken, so the PR opens and says so.
Rejected: trusting the agent's own report; opening a draft PR on the first red; detecting edits to
test scripts and flagging them.
Why: a red the agent introduced is the agent's job to fix, not the reviewer's. Comparing against
the base branch turns "the agent's fault" from a guess into a fact. Tamper detection was dropped
because the reviewer reads the diff anyway.

## The runner ships as a container (2026-09-09)

Chosen: `docker compose up` is the installation. The runner container mounts the Docker socket and
starts agent containers on the host daemon.
Rejected: a bare-metal guide per OS; a WSL2-specific path for Windows.
Why: "any machine" in practice means "any machine with Docker". Mounting the socket gives the
container root-equivalent access to the host, and the docs say so. In code, the one consequence is
that every path the orchestrator hands to `docker run` is translated from `/agent-data` to
`HOST_AGENT_DATA`.
