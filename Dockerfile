FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash \
 && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
 && ln -s /root/.bun/bin/bunx /usr/local/bin/bunx

ARG PI_VERSION=0.85.1
RUN npm i -g @earendil-works/pi-coding-agent@${PI_VERSION}

ENV PI_TELEMETRY=0
WORKDIR /work
