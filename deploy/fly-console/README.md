# Fly demo: the simulated console

A public demo of the operator console on Fly.io. It shows SIMULATED replay data only. A stub Warden stands in for the real
Warden, which is not deployed. No keys, no Testnet actions and no payments happen here.

## Repeat it on your own Fly account

1. Install the CLI and sign in: `winget install --id Fly-io.flyctl`, then `flyctl auth login` in a new terminal.
2. Check out the `deploy/fly-console` branch.
3. In `fly.toml`, change `app = "signoff-console-demo"` to a name nobody else has used.
4. Create the operator file and the reader secret in a private folder outside the repository. Use a password file for
   each account; never type a password on the command line:
   - `npm run console:operator -- add <name>.operator operator --principal demo-operator --secret-file <private>/operator-secret.txt --password-file <private>/operator-password.txt --file <private>/operators.json`
   - `npm run console:operator -- add <name>.viewer viewer --password-file <private>/viewer-password.txt --file <private>/operators.json`
   - Make the operator and reader secrets with 32 random bytes in base64 each.
5. Create the app and set its secrets. The values come from the private folder, and they are never committed:
   - `flyctl apps create <app-name> --org personal`
   - `flyctl secrets set -a <app-name> SIGNOFF_OPERATORS_B64="$(base64 -w0 <private>/operators.json)" SIGNOFF_READER_SECRET="$(cat <private>/reader-secret.txt)"`
6. Deploy from the repository root: `flyctl deploy --remote-only -c fly.toml -a <app-name> --yes`, then `flyctl scale count 1 -a <app-name> --yes`.
7. Check `https://<app-name>.fly.dev/api/health` (it answers `ok`, mode `simulated`), then sign in with the viewer or operator account.

## Notes

- The proxy in `proxy.mjs` is needed because the console listens on loopback only, by design. Do not change that to
  `0.0.0.0` in the console; it refuses that address.
- `deploy/console/Dockerfile` sets the host to `0.0.0.0`, which the console refuses. This demo does not use it.
- Stopping and starting: the machine stops when idle and starts on the next request, so the first load can be slow.
