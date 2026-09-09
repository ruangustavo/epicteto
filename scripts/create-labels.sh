#!/bin/sh
# Creates the lifecycle labels on a repo. Usage: scripts/create-labels.sh owner/repo
set -eu
repo="${1:?usage: create-labels.sh owner/repo}"
while IFS='|' read -r name color desc; do
  gh label create "$name" -R "$repo" --color "$color" --description "$desc" --force >/dev/null && echo "label $name"
done <<'LABELS'
agent|0E8A16|Trigger the agent on this issue
agent:running|FBCA04|Agent is working
agent:in-review|1D76DB|PR open, waiting for review
agent:needs-input|D93F0B|Agent is blocked: questions, failing checks, or an error
agent:quota-paused|BFD4F2|Codex quota exhausted, will retry
agent:done|5319E7|Merged
agent:abandoned|CCCCCC|Closed without merge
LABELS
