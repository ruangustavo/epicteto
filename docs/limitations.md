# Limitations

As of 2026-09-09. Things not built are listed before things deliberately out.

## Not built yet

- **Codex quota.** When the 5-hour or weekly window is exhausted, the run fails; nothing pauses or
  retries. Planned: `agent:quota-paused` plus a scheduled re-dispatch.
- **Cleanup.** Merging or closing a PR does not remove the worktree, the compose project, or the
  state directory, and does not set `agent:done`. State grows until you delete it.
- **Stale handling.** No reminder or auto-close for PRs nobody reviews.
- **Plain PR comments.** Only review submissions are listened to. A comment in the PR's
  conversation tab does nothing.
- **Parallelism.** One runner container runs one job at a time. Several containers on one host
  work but share the Codex quota and `pi-home/auth.json`; not tested.
- **Approve or merge by the agent.** Never. The agent only opens and updates PRs.

## Deliberately out, or bounded

- **Node ecosystem only.** The agent image ships Bun and Node. Anything else needs another image.
- **The Docker socket is root-equivalent.** The runner container can start any container on the
  host. Run it on a machine you'd let the agent own.
- **Codex OAuth is a subscription, not an API.** Rate limits are OpenAI's ChatGPT windows. pi's
  provider follows OpenAI's [Codex for OSS](https://developers.openai.com/community/codex-for-oss) guidance.
- **Video needs three things**: `ATTACH_TOKEN`, a non-empty `UI_GLOBS`, and an app that boots from
  `AGENTS.md` inside the container. Missing any of them, the PR says so instead of attaching a video.
  Compose files with bind mounts are not supported, since the compose CLI runs inside the runner
  container.
- **Rebase rewrites hashes.** The branch is rebased on the base branch at the start of each round,
  so commit hashes cited in earlier thread replies go stale. Squash-merge and it doesn't matter.
- **Retry cap.** A check the agent broke goes back to it at most five times, then the PR opens as
  a draft with `agent:needs-input`.
- **Recording pause length.** The `verify-ui` skill asks for 700 ms between steps; videos are short.
