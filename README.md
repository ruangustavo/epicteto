# epicteto

A coding agent for GitHub issues that runs on your own machine with your own Codex subscription.

You add a label to an issue. A runner you host picks it up, implements the issue in a worktree
inside a container, runs your repo's checks and opens a pull request. When the change touches the
UI it also boots the app, drives it in a headless browser and attaches a video to the PR. You review.
When you request changes, the agent goes through your comments thread by thread, replies to each one
with the commit that addressed it, and records a new video. This repeats until you merge.

The workflow copies [robobun](https://github.com/oven-sh/bun/pulls?q=author%3Arobobun), the bot
that opens most of Bun's pull requests. robobun's code is private. This one you run yourself.

```text
you: label "agent" on issue #3
     └─ PR #4 opens 2 min later: Problem / Fix / Notes, checks green, video inline
you: review → "Request changes" with 3 inline comments
     └─ 90 s later: each thread answered "Addressed in a1b2c3d: …", threads resolved, new video
you: merge
```

## What you need

- A machine with Docker. A VPS, a Windows desktop with Docker Desktop, or a Mac. The containers are Linux amd64 or arm64.
- A ChatGPT Plus or Pro subscription. The agent is [pi](https://github.com/badlogic/pi-mono) using
  OpenAI's Codex OAuth, which OpenAI allows for [open-source clients](https://developers.openai.com/community/codex-for-oss).
- Admin on the GitHub repository you want it to work on.
- A repository in the Node ecosystem with an `AGENTS.md` that explains how to boot and check it.

## Setup

Three commands on the host, one click on GitHub, one file in your repo. The full walkthrough is in [docs/setup.md](docs/setup.md).

```bash
git clone https://github.com/ruangustavo/epicteto && cd epicteto
cp .env.example .env                 # fill REPO, APP_ID, HOST_AGENT_DATA, optionally ATTACH_TOKEN
docker compose run --rm runner login # Codex device-code login, once
docker compose up -d
```

## Documentation

- [Architecture](docs/architecture.md): the four pieces, the two flows, what persists on disk.
- [Design decisions](docs/design-decisions.md): what was chosen, what was rejected, and why. Read this before opening an issue that says "why not X".
- [Setup](docs/setup.md): the full walkthrough, including the GitHub App and the video token.
- [Limitations](docs/limitations.md): what is missing, and what was left out on purpose.

## License

MIT
