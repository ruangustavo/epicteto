# agent-runner

Runs an autonomous coding agent (pi + Codex subscription) against GitHub issues, on a self-hosted
Actions runner. Target repos install `workflow/agent.yml`; this repo is cloned on the runner host at
`$AGENT_HOME` and invoked by that workflow.

Runtime layout on the host (`$AGENT_DATA`):

```
pi-home/                         # pi's ~/.pi/agent for the agent: auth.json lives here
<owner>/<repo>/repo.git          # bare clone, fetched every run
<owner>/<repo>/worktrees/issue-N # one worktree per issue, persists until the PR closes
<owner>/<repo>/state/issue-N     # prompt.md, session.jsonl, result.md, agent-output.log, checks.log
```

Build the image: `docker build -t agent-runner:local .`
