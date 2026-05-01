# INSTALL

## 1. Prerequisites

- Node.js 18.15 or newer.
- npm.
- Auro Wallet or another Mina wallet available in the browser.
- A funded Mina account on the target network.
- For Devnet, fund the fee payer account with the Mina faucet before deploying.

The local services use:

- API: `http://127.0.0.1:4000`
- Web app: `http://127.0.0.1:5174`

## 2. Install Dependencies

```bash
npm install
npm run build
```

If Vite or o1js fails with a sandbox/esbuild permission error on Windows, run the same build from your normal terminal.

## 3. Choose A Network

Set `NETWORK` when running contract deployment scripts:

```bash
mainnet
devnet
zeko
```

Network endpoints live in `packages/shared/src/index.ts`.

For the current tested flow, use `devnet` first.

## 4. zkApp Addresses

This branch uses one zkApp account per game. The web app generates a fresh zkApp keypair in the browser when a player creates a challenge, and the creator wallet pays:

- the transaction fee;
- the zkApp account creation fee;
- the initial stake.

A zkApp address is still just a Mina keypair. For manual script testing you can generate one:

```bash
npm run contracts:keygen
```

The command prints:

- `privateKey`: use as `ZKAPP_PRIVATE_KEY` for manual scripts;
- `publicKey`: the per-game smart contract address;
- `randomFieldSecret`: useful only for manual tests.

Keep private keys out of Git.

## 5. Deploy Manually For Script Tests

The UI deploys a game zkApp inside the create-game transaction, so there is no global deployment step for normal app usage.

For script-based testing, `contracts:deploy-game` deploys one game account and creates the game in the same transaction.

`FEE_PAYER_PRIVATE_KEY` is the private key of a funded Mina account that pays:

- the transaction fee;
- the account creation fee for this game zkApp.

`ZKAPP_PRIVATE_KEY` is the generated key for that one game account. `CREATOR_PRIVATE_KEY` is optional; if omitted, the fee payer is also the creator.

PowerShell:

```powershell
$env:NETWORK="devnet"
$env:FEE_PAYER_PRIVATE_KEY="EK..."
$env:ZKAPP_PRIVATE_KEY="EK..."
$env:CREATOR_PSEUDO="alice"
$env:CREATOR_SECRET="123456"
$env:STAKE_NANOMINA="1000000000"
$env:REFUND_DEADLINE_SLOT="900000"
$env:FEE_NANOMINA="100000000"
npm run contracts:deploy-game
```

Bash:

```bash
export NETWORK="devnet"
export FEE_PAYER_PRIVATE_KEY="EK..."
export ZKAPP_PRIVATE_KEY="EK..."
export CREATOR_PSEUDO="alice"
export CREATOR_SECRET="123456"
export STAKE_NANOMINA="1000000000"
export REFUND_DEADLINE_SLOT="900000"
export FEE_NANOMINA="100000000"
npm run contracts:deploy-game
```

The output includes:

- `txHash`
- `zkappAddress`
- `gameIdField`

For normal UI usage, skip this step.

## 6. Configure The API

The API stores the UX/indexer mirror in SQLite. In the per-game zkApp architecture it no longer needs a global contract address for normal game status.

Template file:

```text
apps/api/.env.example
```

Exact content:

```env
ZKROLL_DB_PATH=zkroll-devnet.db
ZKROLL_WEB_ORIGIN=http://127.0.0.1:5174
ZKROLL_CURRENT_SLOT_CACHE_MS=15000
ZKROLL_ZKAPP_STATE_CACHE_MS=15000
ZKROLL_TX_STATUS_SCAN_BLOCKS=50
ZKROLL_CHAIN_REQUEST_TIMEOUT_MS=12000
```

For local development, you can either export the variables in your shell or create your own `.env` loading mechanism. The current API reads environment variables directly.

PowerShell:

```powershell
$env:ZKROLL_DB_PATH="zkroll-devnet.db"
$env:ZKROLL_WEB_ORIGIN="http://127.0.0.1:5174"
$env:ZKROLL_CURRENT_SLOT_CACHE_MS="15000"
$env:ZKROLL_ZKAPP_STATE_CACHE_MS="15000"
$env:ZKROLL_TX_STATUS_SCAN_BLOCKS="50"
$env:ZKROLL_CHAIN_REQUEST_TIMEOUT_MS="12000"
npm run dev:api
```

Bash:

```bash
export ZKROLL_DB_PATH="zkroll-devnet.db"
export ZKROLL_WEB_ORIGIN="http://127.0.0.1:5174"
export ZKROLL_CURRENT_SLOT_CACHE_MS="15000"
export ZKROLL_ZKAPP_STATE_CACHE_MS="15000"
export ZKROLL_TX_STATUS_SCAN_BLOCKS="50"
export ZKROLL_CHAIN_REQUEST_TIMEOUT_MS="12000"
npm run dev:api
```

Use a fresh SQLite file when switching to this branch. Old global-root games are legacy data and should not be mixed with per-game zkApp tests.

`ZKROLL_ZKAPP_STATE_CACHE_MS` caches each per-game zkApp state lookup. The API uses this state to automatically mark known transaction hashes as included when the game contract reaches the expected status.

`ZKROLL_TX_STATUS_SCAN_BLOCKS` controls how many recent blocks the API scans to detect included failed zkApp transactions by hash. This is used to mark failed creations or failed joins automatically when the zkApp state never advances.

`ZKROLL_CURRENT_SLOT_CACHE_MS` caches current-slot lookups used by refund eligibility.

`ZKROLL_CHAIN_REQUEST_TIMEOUT_MS` bounds external Mina GraphQL calls. Lower values make the API fail fast when public endpoints are slow; higher values can reduce `UNKNOWN` statuses but may make requests feel slower.

## 7. Configure The Web App

Create:

```text
apps/web/.env.local
```

You can copy the template:

```text
apps/web/.env.local.example
```

Exact content:

```env
VITE_API_URL=http://127.0.0.1:4000
VITE_ONCHAIN_ENABLED=true
VITE_FEE_NANOMINA=100000000
VITE_WALLET_RESPONSE_TIMEOUT_MS=120000
VITE_REFUND_TIMEOUT_SLOTS=120
VITE_O1JS_BROWSER_CACHE_ENABLED=true
VITE_TX_POLL_INTERVAL_MS=60000
VITE_SLOT_POLL_INTERVAL_MS=60000
VITE_WALLETCONNECT_PROJECT_ID=
```

Without `VITE_ONCHAIN_ENABLED=true`, the UI stays in simulation mode.

`VITE_API_URL` defaults to `http://127.0.0.1:4000` if omitted, but keeping it explicit makes local setup easier to audit.

Restart Vite after changing `.env.local`:

```bash
npm run dev:web
```

The Vite server is configured with COOP/COEP headers because o1js browser proving uses WebAssembly features that require `crossOriginIsolated`. If you see an error mentioning `WebAssembly.Memory object cannot be serialized`, restart `npm run dev:web`.

`VITE_WALLET_RESPONSE_TIMEOUT_MS` controls the fallback when the wallet sends a transaction but does not return a hash to the page. After this timeout, the UI asks you to paste the hash shown by Auro or the explorer so the backend can index the game.

`VITE_REFUND_TIMEOUT_SLOTS` is the default refund timeout, in Mina global slots, used when creating a challenge. The creator can change it in the UI before creating a game. The chosen timeout is converted into an absolute `refundDeadlineSlot` and stored in the game zkApp state hash.

`VITE_O1JS_BROWSER_CACHE_ENABLED=false` disables the best-effort o1js browser cache stored in `localStorage`. Use it if circuit compilation hangs after previous runs or after changing o1js/contract versions. With the cache disabled, the first compile can be slower but avoids stale or corrupted local proving data.

`VITE_TX_POLL_INTERVAL_MS` controls how often the UI checks transaction status for visible or active games. `VITE_SLOT_POLL_INTERVAL_MS` controls how often it refreshes the current network slot used to unlock refund buttons. For faster Devnet testing you can lower them, for example `15000` and `30000`.

`VITE_WALLETCONNECT_PROJECT_ID` enables Auro Mobile through WalletConnect from an external mobile browser. Leave it empty to keep the current desktop/laptop behavior only. Create the project id in Reown Cloud and rebuild the web app after setting it.

For game creation, the UI now creates a local `pending_signature` game before opening Auro. This stores the generated per-game zkApp address and the deterministic game data if Auro signs and broadcasts the transaction but does not return the hash to the web page.

Make sure the browser wallet is on the selected network before signing.

## 8. Run The App

Terminal 1:

```bash
npm run dev:api
```

Terminal 2:

```bash
npm run dev:web
```

Open:

```text
http://127.0.0.1:5174
```

## 9. First Devnet Test

1. Open the UI.
2. Connect a funded Devnet wallet.
3. If the wallet is unknown, enter a pseudo in the popup.
4. Create a small challenge, for example `0.1` MINA.
5. Confirm the wallet transaction. The creator pays the fee and locks the stake.
6. If Auro does not return to the page, select the `pending_signature` game and click `Renseigner le hash`, then paste the transaction hash from Auro or Minascan.
7. Wait until the create transaction is included on the explorer, then use the UI status controls if the local status has not updated.
8. Connect a second funded Devnet wallet.
9. Join the challenge. The joiner pays the fee and locks the matching stake.
10. The local game moves to `join_pending`. This blocks competing local joins while the transaction is being included.
11. Wait until the join transaction is included. The API should confirm it automatically from the per-game zkApp state; use the manual control only as a fallback after checking the explorer.
12. Reveal from both players.
13. Click `Regler`. The wallet that clicks pays the settlement fee.

The contract recomputes both dice, validates the commitments, and pays the pot or refunds both players on a draw.

If a challenge gets stuck:

- before a second player joins, `Refund` returns the creator stake after `refundDeadlineSlot`;
- after a second player joins, `Refund` returns both stakes after `refundDeadlineSlot`;
- the wallet that clicks `Refund` pays the transaction fee;
- the contract rejects refund transactions before the deadline slot.

## 10. How Sync Status Works

In the per-game zkApp branch, the backend does not rebuild one global Merkle root anymore. Each game has its own zkApp account and its own compact on-chain state hash.

For normal UI flow:

1. the browser builds and proves the transaction;
2. Auro signs and broadcasts it;
3. the backend stores the transaction hash and a local transaction status;
4. the backend polls the per-game zkApp account state, cached by `ZKROLL_ZKAPP_STATE_CACHE_MS`;
5. when the zkApp status reaches the expected step, the API marks the transaction as `INCLUDED`;
6. the UI refreshes the game list and unlocks the next local action.

This deliberately avoids global root reconstruction and limits public GraphQL calls to the selected game's zkApp account. The manual transaction status control is now only a fallback/debug tool for explorer-verified transactions that the public GraphQL endpoint does not reflect yet.

SQLite can contain games for several networks at the same time. Transaction statuses are network-scoped.

`pending_signature` games are local recovery records. If the browser loses the wallet response, use `Renseigner le hash` on the pending game instead of creating another game.

`failed` games are local/indexer cleanup records. Use this status when a creation transaction failed on-chain, for example with `Valid_while_precondition_unsatisfied`.

`join_pending` games keep the joiner data and transaction hash locally. This prevents two browser sessions from locally joining the same open game at the same time. If the join transaction fails, use `Release join` to return the game to `created`.

## 11. ZK Compilation UX

The first on-chain action in a browser session compiles the ZK circuit and can take a while. The UI shows a progress overlay for:

- circuit compilation;
- proof generation;
- wallet signature;
- transaction submission.

The frontend uses an in-session compile promise and, by default, a best-effort browser cache. Browser storage can be too small for all proving keys, so the first compile after a reload can still be slow. Set `VITE_O1JS_BROWSER_CACHE_ENABLED=false` to disable persistent browser cache while keeping the in-session compile promise.

## 12. Deterministic Dice Rule

The dice are derived by the contract using Poseidon:

```text
creatorDie = Poseidon(creatorSecret, joinerSecret, gameId, 1) % 6 + 1
joinerDie = Poseidon(joinerSecret, creatorSecret, gameId, 2) % 6 + 1
```

Both players commit before revealing:

```text
commitment = Poseidon(secret, playerPublicKey, gameId)
```

This prevents a player from choosing a better roll after seeing the opponent's data.

## 13. Useful Commands

```bash
npm run typecheck
npm run build
npm run contracts:keygen
npm run compile-game --workspace @zkroll/contracts
npm run contracts:deploy-game
```

## 14. Production Notes

The current backend is suitable for local testing, Devnet testing, and controlled Mainnet experiments. It is not yet fully production-ready for a public, adversarial deployment.

- The backend is not trusted for payouts.
- The chain is the source of truth for stake locking, commitments, dice rolls, and payout.
- The backend stores pseudos, lists games, and mirrors local workflow state.
- Browser proving with o1js is heavy. The production build warns about the large o1js chunk; this is expected for now.
- A production indexer should rebuild SQLite from chain events/actions through an archive node or hosted indexer instead of relying only on local writes.

### Main Production Gaps

Before opening the app publicly, address these points:

- API writes are not authenticated. Anyone who can reach the API can currently call endpoints such as player registration, reveal, failed creation, join release, and settlement indexing.
- The backend is a local mirror, not a chain-derived indexer. If a transaction is sent outside this UI or the API is down when a transaction confirms, SQLite can miss local status updates.
- SQLite works for a small deployment, but public traffic is better served by Postgres plus migrations and backups.
- There is no rate limiting yet.
- There is no observability beyond Fastify logs.
- There is no admin panel or repair tooling beyond the current manual UI actions.

### Authentication Recommendation

Do not require authentication just to read:

- `GET /games`
- `GET /games/:id`
- `GET /players/by-public-key/:publicKey`
- `GET /transactions/:network/:hash/status`
- `GET /networks/:network/current-slot`

For writes, prefer wallet-signed API requests before public launch. The frontend can ask the wallet to sign a short message containing:

```text
action
publicKey
gameId
network
nonce
timestamp
```

The API should verify:

- the signature matches the claimed public key;
- the public key is allowed to perform the action;
- the nonce was not used before;
- the timestamp is recent.

At minimum, protect operational/manual endpoints behind an admin secret or basic auth until wallet-signed API requests are implemented:

- `PATCH /games/:id/creation-failed`
- `PATCH /games/:id/join-failed`
- `PATCH /games/:id/join-confirmed`

### Reverse Proxy With Nginx And HTTPS

Recommended public layout:

```text
https://zkroll.example.com        -> static web build
https://api.zkroll.example.com    -> Fastify API on 127.0.0.1:4000
```

Build the web app:

```bash
npm run build --workspace @zkroll/web
```

Serve `apps/web/dist` with Nginx. Keep the API bound to localhost:

```bash
export HOST="127.0.0.1"
export PORT="4000"
```

Example Nginx config for the API:

```nginx
server {
  listen 443 ssl http2;
  server_name api.zkroll.example.com;

  ssl_certificate /etc/letsencrypt/live/api.zkroll.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.zkroll.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

Example Nginx config for the web app:

```nginx
server {
  listen 443 ssl http2;
  server_name zkroll.example.com;

  ssl_certificate /etc/letsencrypt/live/zkroll.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/zkroll.example.com/privkey.pem;

  root /var/www/zkroll;
  index index.html;

  add_header Cross-Origin-Opener-Policy same-origin always;
  add_header Cross-Origin-Embedder-Policy require-corp always;

  location / {
    try_files $uri /index.html;
  }
}
```

Copy the static build:

```bash
sudo mkdir -p /var/www/zkroll
sudo rsync -a apps/web/dist/ /var/www/zkroll/
```

Issue TLS certificates with Certbot or another ACME client:

```bash
sudo certbot --nginx -d zkroll.example.com -d api.zkroll.example.com
```

### Production Environment Variables

API:

```env
HOST=127.0.0.1
PORT=4000
ZKROLL_DB_PATH=/var/lib/zkroll/zkroll-mainnet.db
ZKROLL_WEB_ORIGIN=https://zkroll.example.com
ZKROLL_CURRENT_SLOT_CACHE_MS=60000
ZKROLL_ZKAPP_STATE_CACHE_MS=60000
ZKROLL_TX_STATUS_SCAN_BLOCKS=50
ZKROLL_CHAIN_REQUEST_TIMEOUT_MS=8000
```

Web:

```env
VITE_API_URL=https://api.zkroll.example.com
VITE_ONCHAIN_ENABLED=true
VITE_FEE_NANOMINA=100000000
VITE_WALLET_RESPONSE_TIMEOUT_MS=120000
VITE_REFUND_TIMEOUT_SLOTS=120
VITE_O1JS_BROWSER_CACHE_ENABLED=true
VITE_TX_POLL_INTERVAL_MS=60000
VITE_SLOT_POLL_INTERVAL_MS=60000
VITE_WALLETCONNECT_PROJECT_ID=
```

The web app must be rebuilt after changing any `VITE_*` value.

### Run The API With systemd

Build first:

```bash
npm run build --workspace @zkroll/api
```

Example service:

```ini
[Unit]
Description=zkroll API
After=network.target

[Service]
WorkingDirectory=/opt/zkroll
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=4000
Environment=ZKROLL_DB_PATH=/var/lib/zkroll/zkroll-mainnet.db
Environment=ZKROLL_WEB_ORIGIN=https://zkroll.example.com
Environment=ZKROLL_CURRENT_SLOT_CACHE_MS=15000
Environment=ZKROLL_ZKAPP_STATE_CACHE_MS=15000
Environment=ZKROLL_TX_STATUS_SCAN_BLOCKS=50
Environment=ZKROLL_CHAIN_REQUEST_TIMEOUT_MS=12000

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now zkroll-api
sudo journalctl -u zkroll-api -f
```

### Data And Backups

For SQLite:

- store the DB outside the Git checkout, for example `/var/lib/zkroll/zkroll-mainnet.db`;
- back up the DB and WAL files;
- test restore regularly;
- avoid multiple API processes writing to the same SQLite file.

For a public deployment, plan a migration to Postgres.

### Rate Limiting And Abuse Protection

Add rate limiting at Nginx and/or Fastify before public launch.

Nginx example:

```nginx
limit_req_zone $binary_remote_addr zone=zkroll_api:10m rate=10r/s;

server {
  location / {
    limit_req zone=zkroll_api burst=30 nodelay;
    proxy_pass http://127.0.0.1:4000;
  }
}
```

Also consider:

- request body size limits;
- stricter CORS;
- bot protection for write endpoints;
- structured logs and alerting.

### Indexer Roadmap

For real production indexing, add contract events or actions in a future contract version:

```text
GameCreated
GameJoined
GameSettled
GameRefunded
```

Then run an indexer against an archive node to rebuild the database from chain history. The current per-game contract keeps the game state compact, but it does not yet emit enough public event/action data to reconstruct every local API field from chain alone.

### Production Readiness Summary

Recommended before public Mainnet launch:

1. Put API behind HTTPS with Nginx.
2. Serve the web app as static files with COOP/COEP headers.
3. Add wallet-signed authentication for write endpoints.
4. Add rate limiting.
5. Add backups and monitoring.
6. Decide whether SQLite is acceptable for the expected traffic or migrate to Postgres.
7. Plan the archive-node indexer and contract events/actions for a later production-grade version.

## 15. Contract Upgrade Notes

Changing contract methods changes the verification key for newly created games. With one zkApp per game, there is no global contract to redeploy; new games deploy with the new verification key automatically.

Existing games keep the verification key they were deployed with. Finish or refund existing games before switching users to a UI that no longer contains the old proving code.

Use a fresh SQLite database when switching from the old global-root architecture to this per-game zkApp branch:

```powershell
$env:ZKROLL_DB_PATH="zkroll-devnet-per-game.db"
```

```bash
export ZKROLL_DB_PATH="zkroll-devnet-per-game.db"
```
