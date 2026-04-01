# ---- build ----
    FROM node:20-bookworm-slim AS build

    WORKDIR /app
    
    # System deps to build native modules
    RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
      libvips-dev libheif-dev \
      && rm -rf /var/lib/apt/lists/*
    
    # pnpm
    RUN corepack enable
    
    COPY package.json pnpm-lock.yaml ./
    RUN pnpm install --frozen-lockfile
    
    COPY . .
    
    # If you have model download script, keep it
    RUN pnpm run download-models || echo "Model download failed; will download on startup"
    
# ---- cloudflared ----
FROM cloudflare/cloudflared:latest AS cloudflared

# ---- runtime ----
FROM node:20-bookworm-slim
    
    WORKDIR /app
    ENV NODE_ENV=production \
      PORT=3001
    
    # Runtime libs + cloudflared tunnel client
    RUN apt-get update && apt-get install -y --no-install-recommends \
      libvips libheif1 ca-certificates \
      && rm -rf /var/lib/apt/lists/*
    
    # pnpm via corepack (no global install needed)
    RUN corepack enable
    
    # Copy built app + deps
    COPY --from=build /app /app
    COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
    COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
    RUN chmod +x /usr/local/bin/docker-entrypoint.sh
    
    EXPOSE 3001
    
    HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
      CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||3001) + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    
    ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
