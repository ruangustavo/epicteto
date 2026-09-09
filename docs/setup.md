# Setup

Tested on macOS (arm64) with Docker Desktop. The container images are Linux amd64 and arm64, so a
Linux VPS or Docker Desktop on Windows should behave the same; those are not yet verified.

## 1. Create the GitHub App

```bash
git clone https://github.com/ruangustavo/epicteto && cd epicteto
bun run scripts/create-app.ts <app-name>          # add --org <org> for an organization
```

Open the printed `localhost` URL and click **Create GitHub App**. The script saves the private key
to `secrets/app-private-key.pem` and prints `APP_ID` and the bot login (`<slug>[bot]`).

Then install the App on your repository: the script prints the installation URL. Permissions the
manifest requests: Contents, Issues, Pull requests (write), Administration (write, to register the
runner), Metadata (read).

## 2. Optional: the video token

Videos are uploaded with a fine-grained personal access token, because GitHub's attachment endpoint
refuses App tokens (see [design decisions](design-decisions.md)). Create one at
`github.com/settings/personal-access-tokens/new` with access to the target repository only and
**Pull requests: Read and write**. Skip this and the agent runs without videos; the PR says why.

## 3. Configure and start the runner

```bash
cp .env.example .env
```

Fill in: `REPO` (or `ORG`), `APP_ID`, `APP_PRIVATE_KEY_FILE`, `HOST_AGENT_DATA` (an absolute path
on this machine; it will hold worktrees, sessions and videos), and `ATTACH_TOKEN` if you created one.

```bash
docker compose run --rm runner login    # pi opens: /login → OpenAI Codex → device code
docker compose up -d
docker compose logs -f runner           # "Listening for Jobs" means it registered
```

The first start builds the agent image (Chromium, pi, agent-browser), a few minutes.

## 4. Prepare the repository

```bash
scripts/create-labels.sh owner/repo
cp workflow/agent.yml /path/to/repo/.github/workflows/epicteto.yml
```

Edit the `env` block at the top of the workflow:

- `EPICTETO_OWNER`: your GitHub login. Only this login can trigger the agent.
- `EPICTETO_BOT`: the bot login printed in step 1.
- `UI_GLOBS`: paths that count as UI, e.g. `apps/web/**`. Empty disables videos.
- `CHECKS`: commands run in order inside the agent container, first one is setup. Empty means
  `bun install, bun run typecheck, bun run lint, bun run test, bun run build`.

Make sure the repo has an `AGENTS.md` with a boot recipe (how to install, migrate, seed, start,
and what URL means "ready") and the check commands. The agent reads it; the orchestrator does not.
If the app needs services, a `docker-compose.yml` at the repo root is started per issue with host
ports removed; the agent reaches services by their compose name (`db`), not `localhost`.

## 5. First issue

Write an issue with a "What to build" section and acceptance criteria. Add the `agent` label.
Watch the status comment on the issue. A PR should appear within a few minutes.

To ask for changes: review the PR, add inline comments, choose **Request changes** and submit. A
"Comment" review also triggers if you write something in the summary box. Single inline comments
posted one by one do not.

To re-record the video without code changes: Actions → epicteto → Run workflow, with the issue and
PR numbers and `rerecord` checked.

## Where things are when something goes wrong

- The status comment on the issue links to the Actions run; the run log has the orchestrator's lines.
- `HOST_AGENT_DATA/<owner>/<repo>/state/issue-N/` has the prompt, the agent output, the checks
  log, and the recording log.
- A stuck `agent:running` label after a crash: remove and re-add `agent`, or run the workflow by hand.
