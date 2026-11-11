FROM node:24-slim
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm run build --workspace @signoff/console
ENV NODE_ENV=production \
    SIGNOFF_CONSOLE_MODE=simulated \
    SIGNOFF_CONSOLE_HOST=127.0.0.1 \
    SIGNOFF_CONSOLE_PORT=4180 \
    SIGNOFF_CONSOLE_TRANSITIONS=/app/apps/console/fixtures/simulated-transitions.jsonl \
    SIGNOFF_CONSOLE_OPERATORS=/var/signoff/operators.json \
    SIGNOFF_WARDEN_URL=http://127.0.0.1:8790 \
    SIGNOFF_WARDEN_READER_ID=demo-reader \
    SIGNOFF_WARDEN_READER_SECRET_FILE=/var/signoff/reader-secret.txt
EXPOSE 8080
CMD ["sh", "deploy/fly-console/entrypoint.sh"]
