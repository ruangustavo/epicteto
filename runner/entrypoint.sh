#!/bin/sh
# Registers this container as a self-hosted runner using a token minted by the GitHub App,
# builds the agent image if missing, then listens for jobs. `login` runs the one-time Codex OAuth.
set -eu

: "${REPO:?set REPO=owner/name (or ORG=name for an org-level runner)}"
: "${APP_ID:?set APP_ID}"
export APP_PRIVATE_KEY_PATH="${APP_PRIVATE_KEY_PATH:-/run/secrets/app-private-key.pem}"
: "${HOST_AGENT_DATA:?set HOST_AGENT_DATA to the agent-data path on the Docker host}"
: "${RUNNER_NAME:=epicteto-$(hostname)}"
: "${AGENT_IMAGE:=epicteto-agent:local}"

mkdir -p /agent-data/pi-home

if [ "${1:-}" = "login" ]; then
  echo "Opening pi. Type /login, choose OpenAI Codex, then the device-code method. Quit pi when done."
  exec pi
fi

if ! docker image inspect "$AGENT_IMAGE" >/dev/null 2>&1; then
  echo "Building agent image $AGENT_IMAGE (first run only)…"
  docker build -t "$AGENT_IMAGE" /epicteto
fi

if ! pi auth check --provider openai-codex >/dev/null 2>&1; then
  echo "No Codex credential in /agent-data/pi-home. Run: docker compose run --rm runner login" >&2
  exit 1
fi

token="$(cd /epicteto && bun run runner/registration-token.ts)"
if [ -n "${ORG:-}" ]; then url="https://github.com/${ORG}"; else url="https://github.com/${REPO}"; fi
./config.sh --unattended --replace --url "$url" --token "$token" --name "$RUNNER_NAME" --labels epicteto --work _work

cat > .env <<ENV
AGENT_HOME=/epicteto
AGENT_DATA=/agent-data
HOST_AGENT_DATA=${HOST_AGENT_DATA}
APP_ID=${APP_ID}
APP_PRIVATE_KEY_PATH=${APP_PRIVATE_KEY_PATH}
ATTACH_TOKEN=${ATTACH_TOKEN:-}
AGENT_MODEL=${AGENT_MODEL:-openai-codex/gpt-5.5}
AGENT_IMAGE=${AGENT_IMAGE}
PI_TELEMETRY=0
ENV

cleanup() { ./config.sh remove --token "$(cd /epicteto && bun run runner/registration-token.ts remove)" >/dev/null 2>&1 || true; }
trap cleanup TERM INT
./run.sh &
wait $!
