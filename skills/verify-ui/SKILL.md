---
name: verify-ui
description: Boot the app under test and write replayable agent-browser scripts that demonstrate a UI change. Use when asked to produce /state/boot.sh and /state/verify.sh for a verification video.
---

# verify-ui

You produce two shell scripts that the orchestrator replays deterministically to record a video.
You do not record the video yourself.

## Environment facts

- You are inside a container. There is no `docker` here. Do not try to start containers.
- Services from the repo's `docker-compose.yml` are ALREADY running and reachable by their compose
  service name (for example `db`), not `localhost`. Point connection strings at the service name.
- The app's own processes (API, web dev server) run inside this container, started by your `boot.sh`.
- `agent-browser` and Chromium are installed. Recording is handled outside your scripts.
- Read `AGENTS.md` for the boot recipe, then adapt it to the facts above.

## /state/boot.sh (required)

Idempotent script that leaves the app ready and returns. It must:

1. Export the env the app needs (database URL with the compose service hostname, ports).
2. Install dependencies if missing, run migrations and seed if the recipe has them.
3. Start the servers in the background: `nohup ... > /state/app.log 2>&1 &`
4. Wait until the UI answers, polling with `curl -sf` and a timeout of at most 90 seconds.
5. Write the URL the video should start on to `/state/app-url` (one line, no newline needed).

## /state/verify.sh (required)

Straight-line `agent-browser` commands that demonstrate the acceptance criteria of the issue.
Rules:

- Use `set -e`. Every command must be deterministic: no `snapshot`, no reading refs at runtime.
  Use CSS or text selectors (`agent-browser find text "Status" click`, `agent-browser select "select" paid`).
- Start from the page already open at `/state/app-url`; you may navigate with `agent-browser open <url>`.
- Between meaningful steps add `agent-browser wait 700` so the video is readable.
- Assert what the issue promised with `agent-browser wait --text "..."` or `agent-browser is visible <sel>`.
  A failing assertion must make the script exit non-zero.
- Keep it under ~25 commands and under 60 seconds of wall time.

## Workflow

1. Write `/state/boot.sh`, run `sh /state/boot.sh`, confirm the URL in `/state/app-url` responds.
2. Explore with `agent-browser open "$(cat /state/app-url)"` and `agent-browser snapshot -i` to find stable selectors.
3. Write `/state/verify.sh`, run `sh /state/verify.sh`, fix until it exits 0.
4. Run `agent-browser close`. Leave the servers running or kill them; either is fine.
5. Write `/state/verify-result.md` with a `## Scenario` section: 3 to 6 bullets describing what the video shows.

## agent-browser quick reference

```bash
agent-browser open <url>
agent-browser find text "Status" click          # click by visible text
agent-browser find role combobox click
agent-browser select "select" paid              # <select> by CSS, then option value
agent-browser fill "input[name=q]" "text"
agent-browser click "button[type=submit]"
agent-browser wait --text "No invoices."        # assert text appears
agent-browser wait --url "**/invoices*"
agent-browser is visible "table"                # exits non-zero when not visible
agent-browser wait 700
agent-browser close
```
