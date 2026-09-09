# The runner container: GitHub Actions runner + the epicteto orchestrator.
# Talks to the host's Docker daemon through the mounted socket to start agent containers.
FROM debian:bookworm-slim

ARG RUNNER_VERSION=2.337.0
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq unzip tar libicu72 libkrb5-3 zlib1g liblttng-ust1 libssl3 \
 && rm -rf /var/lib/apt/lists/*

# Docker CLI + compose plugin (daemon is the host's, via /var/run/docker.sock)
RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

# gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Bun (runs the orchestrator) + Node (pi login helper)
RUN curl -fsSL https://bun.sh/install | bash && ln -s /root/.bun/bin/bun /usr/local/bin/bun
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
ARG PI_VERSION=0.85.1
RUN npm i -g @earendil-works/pi-coding-agent@${PI_VERSION}

# GitHub Actions runner
RUN mkdir -p /runner && cd /runner \
 && case "${TARGETARCH}" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) echo "unsupported arch ${TARGETARCH}" && exit 1 ;; esac \
 && curl -fsSL -o runner.tar.gz "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${arch}-${RUNNER_VERSION}.tar.gz" \
 && tar xzf runner.tar.gz && rm runner.tar.gz

ENV RUNNER_ALLOW_RUNASROOT=1
ENV AGENT_HOME=/epicteto
ENV AGENT_DATA=/agent-data
ENV PI_CODING_AGENT_DIR=/agent-data/pi-home
ENV PI_TELEMETRY=0

COPY . /epicteto
RUN cd /epicteto && bun install --frozen-lockfile --production 2>/dev/null || (cd /epicteto && bun install)

WORKDIR /runner
ENTRYPOINT ["/epicteto/runner/entrypoint.sh"]
