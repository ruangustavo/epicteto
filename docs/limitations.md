# Limitations

As of 2026-09-09. What isn't built comes first, then what was left out on purpose.

## Not built yet

- Codex quota. When the 5-hour or weekly window runs out, the run fails. Nothing pauses or retries.
  The plan is an `agent:quota-paused` label and a scheduled re-dispatch.
- Cleanup. Merging or closing a PR does not remove the worktree, the compose project or the state
  directory, and does not set `agent:done`. State grows until you delete it.
- Stale handling. There is no reminder or auto-close for PRs nobody reviews.
- Plain PR comments. Only review submissions are listened to. A comment in the PR's conversation
  tab does nothing.
- Parallelism. One runner container runs one job at a time. Several containers on one host would
  work but share the Codex quota and `pi-home/auth.json`. Not tested.
- Approving or merging. The agent never does either. It only opens and updates PRs.

## Left out on purpose, or bounded

- Node ecosystem only. The agent image ships Bun and Node. Anything else needs another image.
- The Docker socket is root-equivalent. The runner container can start any container on the host.
  Run it on a machine you would let the agent own.
- Codex OAuth is a subscription, not an API. The rate limits are OpenAI's ChatGPT windows. pi's
  provider follows OpenAI's [Codex for OSS](https://developers.openai.com/community/codex-for-oss) guidance.
- Video needs three things: `ATTACH_TOKEN`, a non-empty `UI_GLOBS`, and an app that boots from
  `AGENTS.md` inside the container. If any is missing the PR says so instead of attaching a video.
  Compose files with bind mounts don't work, because the compose CLI runs inside the runner container.
- Rebasing rewrites hashes. The branch is rebased on the base branch at the start of each round, so
  commit hashes cited in earlier thread replies go stale. With squash-merge this doesn't matter.
- Retry cap. A check the agent broke goes back to it at most five times. After that the PR opens as
  a draft with `agent:needs-input`.
- Short videos. The `verify-ui` skill asks for 700 ms between steps, so recordings are a few seconds.
