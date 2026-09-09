# Architecture

There are four pieces. Each one does one job.

```text
┌──────────────┐  event   ┌─────────────────────┐  job   ┌──────────────────────────┐
│   GitHub     │ ───────▶ │  Actions workflow   │ ─────▶ │  Runner container        │
│ issues, PRs, │          │  in your repo       │        │  Actions runner +        │
│ labels, App  │ ◀─────── │  (no secrets)       │        │  orchestrator (Bun)      │
└──────────────┘  gh api  └─────────────────────┘        └───────────┬──────────────┘
                                                                     │ docker run (host socket)
                                                          ┌──────────▼──────────────┐
                                                          │  Agent container         │
                                                          │  pi + Codex, Bun, Node,  │
                                                          │  Chromium, agent-browser │
                                                          │  sees only /work /state  │
                                                          └──────────────────────────┘
```

GitHub holds all the state you can see: the labels, one status comment per issue that gets edited in
place, the PR, the review threads. It also emits the events. A GitHub App you own is the agent's
identity there.

The workflow (`workflow/agent.yml`, copied into your repo) is the gate. It decides whether a run
happens at all (label name, review state, who sent the event), which issue the run belongs to, and
that only one run per issue happens at a time. It carries no secrets. `UI_GLOBS` and `CHECKS` are
configuration, and they are the only things in it.

The runner container (`runner/Dockerfile`) hosts GitHub's Actions runner and the orchestrator,
`bin/agent-run.ts`. When it starts it signs a JWT with the App's key, mints a registration token and
registers itself. For each job it mints a one-hour installation token. It owns git, the tokens and
the Docker socket. Nothing else has credentials.

The agent container (`Dockerfile`) is where the model runs. It gets the worktree at `/work`, a
scratch directory at `/state`, and pi's credential directory. It has no GitHub token. It talks to the
orchestrator through files only: it reads `/state/prompt.md` and writes `/state/result.md`.

The rule behind the split: the model never touches GitHub, and the workflow never touches the model.
The orchestrator sits in the middle and turns GitHub state into prompts and result files into
GitHub actions.

## Implement flow

```text
you        label issue #3 "agent"
GitHub     issues.labeled → workflow
workflow   resolve job: gate ok, issue=3 → run job → agent-run
agent-run  labels +agent:running · status comment "running: implementing"
           git: fetch base branch into bare repo · worktree add agent/3-<slug>
           render prompt.md from the issue and its human comments
container  pi -p --session /state/session.jsonl "<prompt>"
           model reads AGENTS.md, edits /work, commits, writes /state/result.md
agent-run  checks: CHECKS in order inside the container, stop at first red
             red on branch, green on base → failure goes back to the same session, up to 5 turns
             red on branch, red on base  → pre-existing, noted in the PR, not retried
           push as the App · PR with Problem / Fix / Notes from result.md
           diff matches UI_GLOBS?
             compose up the repo's services (host ports stripped, own network per issue)
container    pi with the verify-ui skill → /state/boot.sh, /state/verify.sh, scenario bullets
container    boot.sh → agent-browser open → record start → verify.sh → record stop
             replay failed? one repair turn, replay again
agent-run    upload round-1.webm with ATTACH_TOKEN → URL into the PR body · compose down
           labels -running +agent:in-review · status comment "in review"
```

## Review flow

```text
you        submit a review: "Request changes", or "Comment" with a summary text
workflow   gate ok · issue number parsed from the branch name · agent-run with PR=4
agent-run  GraphQL: unresolved threads (path, line, hunk, comments) + your review body
           git rebase <base branch>; conflicts, if any, go into the prompt
container  pi --session (same session as the implement run) "<threads>"
           writes /state/review-result.md: per thread, addressed | not-applicable, plus a summary
agent-run  checks with the same retry rule · push
           per thread: reply "Addressed in <sha>: …" and resolve, or "Not applicable: …" and leave open
           summary comment · new video if the diff still matches UI_GLOBS · back to agent:in-review
```

## On disk

Everything the runner needs between rounds lives under `HOST_AGENT_DATA`:

```text
pi-home/                         pi's config dir for the agent: auth.json (Codex), skills/verify-ui
<owner>/<repo>/
├── repo.git                     bare clone; receives only the base branch
├── worktrees/issue-N/           the branch, node_modules warm, persists until the PR closes
├── worktrees/baseline/          detached base branch, to tell pre-existing failures apart
└── state/issue-N/
    ├── session.jsonl            pi's memory of the issue, resumed every round
    ├── prompt.md, result.md     one pair per turn, diffable
    ├── boot.sh, verify.sh       replayed for every re-record
    └── videos/round-N.webm
```

## Labels as state

`agent` is the label you add. The orchestrator then moves the issue through `agent:running`,
`agent:in-review` and `agent:needs-input`. `agent:quota-paused`, `agent:done` and `agent:abandoned`
exist but nothing sets them yet. Labels are easy to filter on and easy to reset by hand when
something goes wrong, which is why state lives there and nowhere else.
