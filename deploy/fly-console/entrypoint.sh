#!/bin/sh
# Starts the demo on Fly: a stub Warden (simulated data only), the console on loopback, and the proxy on the public port.
set -eu
mkdir -p /var/signoff
umask 077
printf '%s' "$SIGNOFF_OPERATORS_B64" | base64 -d > /var/signoff/operators.json
printf '%s' "$SIGNOFF_READER_SECRET" > /var/signoff/reader-secret.txt
node deploy/fly-console/stub-warden.mjs &
npx tsx apps/console/src/server/main.ts &
exec node deploy/fly-console/proxy.mjs
