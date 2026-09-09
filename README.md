# epicteto

An autonomous coding agent for GitHub issues, running on your own machine with your own Codex subscription.

You add a label to an issue. A runner you host picks it up, implements the issue in an isolated
worktree inside a container, runs your repo's checks, opens a pull request, and, when the change
touches the UI, boots the app, drives it in a headless browser and attaches a video to the PR.
You review. When you request changes, the agent picks them up thread by thread, replies to each
one with the commit that addressed it, and records a fresh video. The loop continues until you merge.

It is modelled on [robobun](https://github.com/oven-sh/bun/pulls?q=author%3Arobobun), the bot that
opens most of Bun's pull requests, with one difference: robobun's brain is private, and this one you run.

```text
you: label "agent" on issue #3
     └─ PR #4 opens 2 min later: Problem / Fix / Notes, checks green, video inline
you: review → "Request changes" with 3 inline comments
     └─ 90 s later: each thread answered "Addressed in a1b2c3d: …", threads resolved, new video
you: merge
```

## What you need

- A machine with Docker: a VPS, a Windows desktop with Docker Desktop, a Mac. Linux amd64 or arm64 containers.
- A ChatGPT Plus or Pro subscription. The agent is [pi](https://github.com/badlogic/pi-mono) using
  OpenAI's Codex OAuth, which OpenAI [endorses for open-source clients](https://developers.openai.com/community/codex-for-oss).
- Admin on the GitHub repository you want it to work on.
- A repository in the Node ecosystem with an `AGENTS.md` that says how to boot and check it.

## Setup

Three commands on the host, one click on GitHub, one file in your repo. See [docs/setup.md](docs/setup.md).

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
- [Limitations](docs/limitations.md): what is not built yet, and what is deliberately out.

## License

MIT
