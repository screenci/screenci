# ── Runtime image ─────────────────────────────────────────────────────────────
FROM docker.io/library/node:25.2.1-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    ffmpeg \
    x11-utils \
    && rm -rf /var/lib/apt/lists/*

# ── Dependency layer (cached until package.json changes) ──────────────────────
# Install screenci as a workspace package so npm creates the bin link.
COPY package.json ./screenci/
RUN printf '{"private":true,"workspaces":["screenci"]}' > package.json && npm install

# Playwright browser download: only re-runs when the playwright version changes.
RUN npx playwright install chromium --with-deps

# ── screenci build output ─────────────────────────────────────────────────────
COPY dist ./screenci/dist/

# Explicit bin wrapper — no npm bin-linking magic needed.
RUN printf '#!/bin/sh\nexec node /app/screenci/dist/cli.js "$@"\n' > /app/node_modules/.bin/screenci && \
    chmod +x /app/node_modules/.bin/screenci

# Create .screenci directory for recordings
RUN mkdir -p .screenci

# Add node_modules/.bin to PATH
ENV PATH="/app/node_modules/.bin:${PATH}"

CMD ["echo", "Container ready"]
