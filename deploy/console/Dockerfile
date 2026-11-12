# The operator console: a web app and a small server. It holds each operator's Warden secret only on the server, and it
# never writes to the agent's log. The operator file and the secrets are mounted, not copied in.
# Build from the repository root:  docker build -f deploy/console/Dockerfile -t signoff-console .
# NOT BUILT OR DEPLOYED: no container host or budget has been confirmed for this project (see deploy/README.md).
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production \
    SIGNOFF_CONSOLE_HOST=0.0.0.0 \
    SIGNOFF_CONSOLE_ALLOW_ALL_INTERFACES=1 \
    SIGNOFF_CONSOLE_PORT=4180 \
    SIGNOFF_LOCAL_DIR=/data \
    SIGNOFF_CONSOLE_OPERATORS=/data/console/operators.json \
    SIGNOFF_WARDEN_READER_SECRET_FILE=/data/console/reader.secret

COPY package.json package-lock.json ./
COPY apps/console/package.json apps/console/
COPY apps/agent/package.json apps/agent/
COPY apps/warden/package.json apps/warden/
COPY packages/ packages/
RUN npm ci --workspace @signoff/console --include-workspace-root=false

COPY apps/console/ apps/console/
COPY apps/agent/src/ apps/agent/src/
COPY deploy/entrypoint.mjs deploy/entrypoint.mjs
COPY tsconfig.base.json ./
RUN npm run build --workspace @signoff/console

USER node
EXPOSE 4180

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4180/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint writes the operator file and reader secret from the host secret store, then runs the console.
CMD ["node", "deploy/entrypoint.mjs", "console"]
