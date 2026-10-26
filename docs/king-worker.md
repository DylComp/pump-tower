# King of the Hill worker

Production: `pump-tower` / `pumptowers.fun`. The worker runs in the same Vercel project as the site. Signing keys are server-only environment secrets. Redis holds the durable journal, never private keys. Existing profile-buyback, profile-claim and dev-fee jobs stay disabled.

## Schedule and activation

- `/api/cron/king`: every five minutes; reads chain data and produces hourly allocations.
- `/api/cron/king-worker`: every ten minutes; authenticated with `CRON_SECRET`.
- Signing requires `KING_WORKER_ENABLED=true` and a configured alert webhook. Before a finalized single-launch acceptance test, every scheduled run is restricted to that one test. Once it passes, subsequent runs perform normal work.
- An authenticated POST to `/api/cron/king-worker` using `KING_LAUNCH_SECRET` attempts at most one launch. A persisted successful test prevents additional launches from repeated test requests.
- The test refuses to start below 0.1 SOL in the launcher. Normal cycles attempt up to five launches; each checks the balance again.
- The worker can be enabled while awaiting funding. It spends nothing below the launch threshold, retries the single-launch acceptance after funding, and enters normal operation only after its finalized signature and locked fee split are confirmed.

## Environment

`KING_LAUNCHER_SECRET_KEY` and `KING_TREASURY_SECRET_KEY` are JSON arrays of 64 bytes. `KING_LAUNCHERS` contains the launcher public key. `KING_LAUNCH_SECRET`, `KING_PAYER_SECRET` and `KING_ALERT_SECRET` are independent random secrets. `ALERT_WEBHOOK_URL` targets the authenticated inbox at `/api/king/worker-alerts`. Existing `HELIUS_API_KEY`, Redis credentials and `CRON_SECRET` are reused. Secrets are present only in Vercel and ignored mode-0600 `.env.*.local` files. Do not paste them into commands, logs, issues or commits.

New KING wallets replace the site's dev/launcher and treasury for future launches. Existing coins have immutable fee splits pointing to their original wallets; changing site configuration cannot reroute them. The official PTWR mint remains `5ChT61vPfByx2NApxSNT4iPMTRCV39m5z88bXYcppump`.

## Payment guarantees

- Validate integer lamports, unique payees, cup hours and holder/pot allocation sums before signing.
- Pin each hour's allocation digest. Changed allocations fail closed.
- Reserve 0.05 SOL plus rollover and estimated transaction overhead before spending.
- Batch eight SOL transfers. Persist signed bytes, signature, expiry and wallet list before broadcast. Mark `hour + wallet` paid only after a successful finalized receipt matching the signed message.
- A Redis compare-and-swap journal and 300-second lease fence concurrent invocations. Never reset or delete it to retry a payment.
- Retry the exact same signed transaction while valid. An expired transaction with an unknown result stays blocked for investigation; it never creates a fresh payment. A finalized failed transaction may be replaced, since it executed no transfers.
- Reuse the existing atomic PTWR exact-output purchase and burn, with a budget capped by the hour's burn allocation. Large budgets split into chunks of at most 10 SOL; unused quote/slippage headroom remains in treasury. Tiny allocations may still fail simulation if they cannot purchase a token unit.
- Provision the treasury's PTWR token account once, recording that transaction durably too.
- Acknowledge the hour only after all holder transfers and burns finalize, including their public signatures.
- Stop new launches at November 9, 2026, 14:00 UTC. Stop worker signing after the final eligible hour (13:00–14:00 UTC) is published as paid and no pending reigns remain. Later cron requests return without signing.

## Alerts and recovery

The webhook writes deduplicated events into a bounded Redis inbox. An authenticated GET returns sanitized alerts and worker status; no signed transaction bytes or private key material. `node scripts/check-king-alerts.mjs` reads the local alert secret and prints only this sanitized response. The Codex heartbeat reports meaningful new failures or recoveries and stays quiet otherwise. Notifications depend on the Codex automation host being available; the Vercel worker and persisted inbox run independently.

For `expired_unresolved`, inspect finalized chain history for the recorded signature before any repair. For insufficient treasury funds, replenish the treasury; do not reduce the reserved rollover or fabricate a paid result. Failed alerts remain visible through worker outcomes and the read-only status endpoint. Preserve all journal records through redeployments.

Validation: `npm run typecheck`, `npm test`, and Vercel production build. Live acceptance additionally requires a finalized launch transaction and on-chain verification of the locked treasury/member fee split.

## Public wallet addresses

- Launcher/dev: `KiNgDiSzoX9Z69LoRZh73QkBhJNLqxDbJKgQ2bHmon7`
- Treasury: `kiNGXkmkJSMPQoFEdUZs68nANK16C1AjyQD2jVPY46C`
