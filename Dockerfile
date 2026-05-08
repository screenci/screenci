# ── Runtime image ─────────────────────────────────────────────────────────────
FROM docker.io/library/node:25.2.1-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    ffmpeg \
    x11-utils \
    && rm -rf /var/lib/apt/lists/*

# ── Dependency layer (cached until package.json changes) ──────────────────────
# Install through a workspace to keep dependency resolution unchanged, then
# replace the workspace symlink with a real package under node_modules. Playwright
# skips transforms for node_modules packages, but follows workspace symlinks to
# /app/screenci and can rewrite compiled ESM as CJS while loading TS configs.
COPY package.json ./screenci/
RUN printf '{"private":true,"workspaces":["screenci"]}' > package.json && \
    npm install && \
    rm /app/node_modules/screenci && \
    mkdir -p /app/node_modules/screenci

# Playwright browser download: only re-runs when the playwright version changes.
RUN npx playwright install chromium --with-deps

# ── screenci build output ─────────────────────────────────────────────────────
COPY dist ./screenci/dist/
COPY package.json ./node_modules/screenci/package.json
COPY dist ./node_modules/screenci/dist/

# Explicit bin wrapper — no npm bin-linking magic needed.
RUN printf '#!/bin/sh\nexec node /app/screenci/dist/cli.js "$@"\n' > /app/node_modules/.bin/screenci && \
    chmod +x /app/node_modules/.bin/screenci

# Create .screenci directory for recordings
RUN mkdir -p .screenci

# Add node_modules/.bin to PATH
ENV PATH="/app/node_modules/.bin:${PATH}"

CMD ["echo", "Container ready"]
