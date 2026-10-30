# ==============================================================================
# Build Stage
# ==============================================================================
FROM oven/bun:1-slim AS builder

WORKDIR /app

# Install production dependencies
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production

# Copy source files
COPY src ./src


# ==============================================================================
# Final Runtime Stage
# ==============================================================================
FROM oven/bun:1-slim AS runner

WORKDIR /app

# Version ARG from GitHub Action / build workflow
ARG VERSION=1.0.0

# Install runtime dependencies for Firefox / Camoufox, Impit and Xvfb
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    ca-certificates \
    curl \
    libgtk-3-0 \
    libdbus-glib-1-2 \
    libdbus-1-3 \
    libasound2 \
    libx11-xcb1 \
    libxcb-shm0 \
    libxcb-randr0 \
    libxcb-dri2-0 \
    libxcb-dri3-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxtst6 \
    libxss1 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Copy installed node_modules and built application from builder stage
COPY --from=builder /app /app

# Pre-fetch Camoufox browser binaries into the image so they don't need to be downloaded at first launch
RUN bun run camoufox:fetch

# Environment configuration with default values
ENV HOST=0.0.0.0 \
    PORT=3031 \
    BASE_PATH="" \
    CAMOUFOX_DATA_DIR=/data/camoufox \
    CAMOUFOX_IDLE_TIMEOUT=900 \
    ALLOW_LOCAL_ADDRESSES=false \
    NODE_ENV=production

# Ensure data directory for Camoufox exists
RUN mkdir -p ${CAMOUFOX_DATA_DIR}

VOLUME ${CAMOUFOX_DATA_DIR}

# Expose the default port
EXPOSE ${PORT}

CMD ["bun", "run", "start"]
