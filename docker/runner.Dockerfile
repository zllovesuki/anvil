ARG SANDBOX_VERSION=0.7.19
FROM docker.io/cloudflare/sandbox:${SANDBOX_VERSION}-python

ENV DEBIAN_FRONTEND=noninteractive \
    CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    PNPM_HOME=/opt/pnpm \
    PATH=/opt/pnpm:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    file \
    git \
    git-lfs \
    gnupg \
    jq \
    pkg-config \
    procps \
    rsync \
    unzip \
    wget \
    xz-utils \
    zip \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install --global corepack \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
    && corepack prepare pnpm@10.32.1 --activate \
    && corepack prepare yarn@4.12.0 --activate

WORKDIR /workspace
