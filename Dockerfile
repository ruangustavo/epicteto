FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates curl unzip procps \
      chromium ffmpeg fonts-liberation fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash \
 && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
 && ln -s /root/.bun/bin/bunx /usr/local/bin/bunx

ARG PI_VERSION=0.85.1
ARG AGENT_BROWSER_VERSION=0.36.0
RUN npm i -g @earendil-works/pi-coding-agent@${PI_VERSION} agent-browser@${AGENT_BROWSER_VERSION}

# Debian's chromium: Chrome for Testing has no linux/arm64 builds.
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PI_TELEMETRY=0
WORKDIR /work
