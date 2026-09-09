# Design decisions

Each entry: what we chose, what we rejected, why. Dates are when the decision was made.

## GitHub Actions with a self-hosted runner, not a daemon (2026-09-08)

Chosen: the repo's own Actions workflow routes events to a runner you host.
Rejected: a webhook receiver behind a tunnel, or a poller, with its own queue.
Why: GitHub already provides the deterministic layer for free: event filters, per-issue
concurrency, the sender gate, logs and re-runs in the PR's checks tab. A daemon rewrites all of
that. The runner being self-hosted means pi, Chromium, and your repos' stacks are warm.

## A GitHub App as the agent's identity (2026-09-08)

Chosen: an App you create, installed on the repos, with tokens minted per job.
Rejected: the default `GITHUB_TOKEN`; a PAT of your own account; a machine user.
Why: the default token's events never trigger other workflows and its PRs belong to
`github-actions[bot]`. Your own PAT makes the agent's replies indistinguishable from your reviews,
so the trigger loops or needs markers, and you cannot approve your own PR. A machine user burns a
second account and a long-lived credential. The App's PRs read as `<slug>[bot]`, its events
trigger workflows, the sender gate is one comparison, and it can mint its own runner registration.

## A PAT still exists, for one HTTP call (2026-09-08)

Chosen: a fine-grained PAT with `Pull requests: write`, used only to upload videos.
Rejected: uploading with the App; release assets; an external bucket; driving GitHub's UI.
Why: GitHub's attachment endpoint (`uploads.github.com/user-attachments/assets`) returns 404 for
App installation tokens. We tested it: `ghs_` → 404, `gho_` → 201. The `gh` CLI encodes the same
rule in an allowlist of token prefixes. The uploaded asset is bound to the repository, not the
uploader, so the App can post the URL and GitHub renders the player under the App's name. The PAT
never posts anything, so nothing it does is visible. Release assets don't render inline and an
external bucket takes the videos off GitHub.

## Which review events wake the agent (2026-09-09)

Chosen: a review submitted as "Request changes", or as "Comment" with a non-empty summary.
Rejected: every `pull_request_review_comment`; every review regardless of state.
Why: a single inline comment is stored as a review with state `commented` and an empty body,
identical to a batched review with one comment and no text. Reacting to each inline comment fans
out into N runs against the same worktree. The review state and body are the only signals that
distinguish "I finished reviewing, act" from "I'm still typing". Approve never triggers.

## The container holds no token (2026-09-08)

Chosen: the orchestrator reads GitHub and posts to GitHub; the model only sees rendered prompts
and a worktree. Results come back as files with a fixed shape.
Rejected: giving the agent `gh` and a token.
Why: posting stays deterministic and the comment format doesn't depend on the model. Prompts of
round 1 and round 2 are plain files you can diff. A prompt-injected issue body or a malicious
`postinstall` in a dependency cannot push, comment, or read other repos.

## Configuration lives in three places on purpose (2026-09-08)

- The workflow env: `UI_GLOBS` and `CHECKS`. Deterministic gates that the orchestrator evaluates
  without a model call. The workflow file is already the one file you copy into a repo.
- `AGENTS.md`: the boot recipe and conventions. Prose the model reads, the way pi reads it locally.
- The runner's `.env`: every credential. Nothing secret ever enters the target repository.

Rejected: a manifest file the orchestrator parses for boot commands. It would either duplicate
`AGENTS.md` or turn a deterministic gate into prose parsing.

## Verification scripts live outside the repo (2026-09-08)

Chosen: the agent writes `boot.sh` and `verify.sh` into the issue's state directory on the runner.
The orchestrator replays them for every re-record. The agent edits them only when a replay fails.
Rejected: committing them to the branch; letting the agent improvise the recording each round.
Why: improvised recordings drive a different path every round, so videos can't be compared.
Committed scripts pile up in the repo. State-directory scripts are replayable, diffable, and die
with the PR. The cost: they are lost if the state directory is deleted.

## Checks are run by the workflow, and a red one goes back to the agent (2026-09-09)

Chosen: after the agent's turn, the orchestrator runs `CHECKS`. If one fails on the branch but
passes on the base branch, the failure is fed back into the same session, up to five turns. If it
also fails on the base branch, it's pre-existing: the PR opens and says so.
Rejected: trusting the agent's own report; opening a draft PR on the first red; "tamper flags"
that detect edits to test scripts.
Why: a red the agent introduced is the agent's job to fix, not the reviewer's. The base-branch
comparison is what makes "the agent's fault" a fact instead of a guess. Tamper detection was
dropped in favour of human review of the diff, which happens anyway.

## The runner ships as a container (2026-09-09)

Chosen: `docker compose up` is the installation. The runner container mounts the Docker socket
and starts agent containers on the host daemon.
Rejected: a bare-metal guide per OS; a WSL2-specific path for Windows.
Why: "any machine" in practice means "any machine with Docker". The socket mount is root-equivalent
access to the host and is disclosed as such. The one consequence in code is that every path the
orchestrator hands to `docker run` is translated from `/agent-data` to `HOST_AGENT_DATA`.
