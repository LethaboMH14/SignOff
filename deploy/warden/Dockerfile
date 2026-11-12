# The Warden: the only service that holds the Warden's keys and co-signs payments. It runs in its own container, with its
# state on a persistent volume and its keys mounted as a secret. Nothing secret is copied into this image.
# Build from the repository root:  docker build -f deploy/warden/Dockerfile -t signoff-warden .
# NOT BUILT OR DEPLOYED: no container host or budget has been confirmed for this project (see deploy/README.md).
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production \
    SIGNOFF_LOCAL_DIR=/data

COPY package.json package-lock.json ./
COPY apps/warden/package.json apps/warden/
COPY apps/agent/package.json apps/agent/
COPY apps/console/package.json apps/console/
COPY packages/ packages/
RUN npm ci --workspace @signoff/warden --include-workspace-root=false

COPY apps/warden/ apps/warden/
COPY deploy/entrypoint.mjs deploy/entrypoint.mjs
COPY tsconfig.base.json ./

USER node
VOLUME ["/data"]
EXPOSE 8080

# Ready when the health answer shows readiness; the synthetic Testnet check is separate and read-only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/v1/health').then((r)=>r.json()).then((b)=>process.exit(b.ready===true?0:1)).catch(()=>process.exit(1))"

# The entrypoint writes the Warden secrets from the host secret store, refuses to start if one is missing, then runs the Warden.
CMD ["node", "deploy/entrypoint.mjs", "warden"]
