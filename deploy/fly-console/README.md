# Fly demo: the simulated console

A public demo of the operator console on Fly.io. It shows SIMULATED replay data only. A stub Warden stands in for the real
Warden, which is not deployed. No keys, no Testnet actions and no payments happen here.

## Repeat it on your own Fly account

1. Install the CLI and sign in: `winget install --id Fly-io.flyctl`, then `flyctl auth login` in a new terminal.
2. Check out the `deploy/fly-console` branch.
3. In `fly.toml`, change `app = "signoff-console-demo"` to a name nobody else has used. Then set `SIGNOFF_CONSOLE_ORIGINS` under `[env]` to `https://<app-name>.fly.dev`; without it the sign-in form is refused.
4. Create the operator file and the reader secret in a private folder outside the repository. Use a password file for
   each account; never type a password on the command line:
   - `npm run console:operator -- add <name>.operator operator --principal demo-operator --secret-file <private>/operator-secret.txt --password-file <private>/operator-password.txt --file <private>/operators.json`
   - `npm run console:operator -- add <name>.viewer viewer --password-file <private>/viewer-password.txt --file <private>/operators.json`
   - Make the operator and reader secrets with 32 random bytes in base64 each.
5. Create the app and import its secrets **from a private file through standard input**, not as command-line values:
   - `flyctl apps create <app-name> --org personal`
   - Outside the repository, prepare a private `fly-secrets.env` file (restrict it to the operator's account). It must have two `NAME=VALUE` lines:
     - `SIGNOFF_OPERATORS_B64`: the single-line base64 encoding of the private `operators.json` file.
     - `SIGNOFF_READER_SECRET`: the contents of the private `reader-secret.txt` file.
   - On a Unix shell: `flyctl secrets import -a <app-name> < <private>/fly-secrets.env`. In PowerShell, use `Get-Content -Raw <private>/fly-secrets.env | flyctl secrets import -a <app-name>`.
   - Do not print the secret file, paste its contents into a terminal command, save it inside the repository, or include it in CI logs. The original `flyctl secrets set NAME="$(cat secret-file)"` form is unsafe because it can expose values in process arguments. Fly's `secrets import` reads `NAME=VALUE` pairs from standard input.
6. Deploy from the repository root: `flyctl deploy --remote-only -c fly.toml -a <app-name> --yes`, then `flyctl scale count 1 -a <app-name> --yes`.
7. Check `https://<app-name>.fly.dev/api/health` (it answers `ok`, mode `simulated`), then sign in with the viewer or operator account.

## Notes

- The proxy in `proxy.mjs` is needed because the console listens on loopback only, by design. Do not change that to
  `0.0.0.0` in the console; it refuses that address.
- `deploy/console/Dockerfile` sets the host to `0.0.0.0`, which the console refuses. This demo does not use it.
- A trial account stops each machine after five minutes. Add a payment method on Fly to keep the demo running.
- Stopping and starting: the machine stops when idle and starts on the next request, so the first load can be slow.
