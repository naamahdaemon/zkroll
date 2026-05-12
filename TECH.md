# TECH

Technical notes for the current zkroll implementation.

## Architecture

zkroll now uses one Mina zkApp account per game.

The create-game transaction:

1. generates a fresh zkApp private key in the browser;
2. deploys the game zkApp account;
3. initializes the game state;
4. locks the creator stake.

The join transaction updates the same per-game zkApp and locks the joiner stake. Settlement or refund then closes that per-game contract state.

There is no global zkroll contract address in the normal UI flow.

This design is intentionally more robust than the previous global Merkle-root prototype: one corrupted or missing local game row no longer makes every future game fail against a shared on-chain root.

## Local State

SQLite is an indexer and UX cache. It stores:

- wallet public key to pseudo mappings;
- games and their local workflow status;
- transaction hashes and cached transaction statuses;
- reveal data needed by the UI flow.
- non-secret join recovery material in API logs when a join is submitted.

The chain remains the source of truth for:

- locked funds;
- commitments;
- joined/settled/refunded contract status;
- settlement payouts and refunds.

For joined-game refund and settlement, SQLite must match the exact join data used on-chain: `joinerPseudoHash`, `joinerCommitment`, and the joined `refundDeadlineSlot`. If a pending join is released after the transaction was included, later refund/settle proof generation can fail with a `Field.assertEquals()` data-hash mismatch. The API logs `Join recovery material` for future joins so operators can repair the local row without storing player secrets.

The API also enforces workflow guardrails around this local mirror:

- no on-chain transaction hash may be reused across create, join, settlement, or refund for the same game;
- join confirmation requires complete join material and an included join status;
- reveal, settlement, and joined-game refund require a trusted included join;
- create-game requests are rejected when `refundTimeoutSlots` is greater than `2400`;
- create-game requests are rejected when the creator already has 5 games waiting for their action on the requested network;
- admin-only unrecoverable marking requires `ZKROLL_ADMIN_PUBLIC_KEY`.

## On-Chain State

Each game zkApp stores a compact state hash and status fields in its own account state. The backend polls only the selected or visible game zkApp accounts, instead of rebuilding one global Merkle root.

This avoids the old failure mode where a local SQLite mismatch made a global contract unusable.

## Transaction Sync

The API resolves transaction status in this order:

1. local placeholders such as `pending:<gameId>` stay local;
2. known game transactions are inferred from the per-game zkApp state;
3. recent blocks can be scanned to detect failed zkApp commands by hash;
4. manual status controls remain a fallback/debug tool.

Relevant API environment variables:

```env
ZKROLL_CURRENT_SLOT_CACHE_MS=15000
ZKROLL_ZKAPP_STATE_CACHE_MS=15000
ZKROLL_TX_STATUS_SCAN_BLOCKS=50
ZKROLL_CHAIN_REQUEST_TIMEOUT_MS=20000
```

Manual status forcing is kept as an operational fallback, not as the normal sync path. Normal inclusion should be inferred from the per-game zkApp state.

Because manual hash recovery is operator-sensitive, the UI and API treat malformed, duplicated, or unrelated hashes as untrusted. A `settled` row is not enough to credit a win: the web leaderboard only counts games with included create, join, and settlement transactions, a non-duplicated settlement hash, and a winner. Corrupt or incomplete settled rows are shown as invalid in the detail view.

The `unrecoverable` status is a terminal local/admin status for games that cannot be finalized. It is not an on-chain status and should be used only after operator inspection.

The leaderboard groups by wallet public key and only uses pseudo as display metadata. The displayed pseudo is hydrated from the latest `players` row when available, so historical pseudo changes do not split or rename scores incorrectly. Only final trusted `settled` games and included `refunded` games are counted; period filters use `settledAt` / `refundedAt`, not `updatedAt`. Refunded games count as played but do not credit a win. Unique opponents are counted by distinct opposing wallet public keys within the selected range. Rows are ranked by a transparent score: `wins * 10 + sqrt(games) * 3 + uniqueOpponents * 5`, plus `(wins / games) * 20` only when `games >= 5`, minus `min(openGamesOnSelectedNetwork, 10) * 4`; ties fall back to wins, unique opponents, fewer open games, games played, MINA won, then pseudo. The UI can filter leaderboard rows by all time or navigable calendar month, week, and day windows.

## Zeko Testnet

Zeko Testnet uses a Mina-compatible zkApp transaction flow, but its public GraphQL API is not a perfect drop-in replacement for Mina Devnet/Mainnet.

Current compatibility rules:

- `minaEndpoint`: `https://testnet.zeko.io/graphql`
- `archiveEndpoint`: `https://archive.testnet.zeko.io/graphql`
- Auro chain id: `zeko:testnet`
- o1js transaction signing domain: `testnet`
- account creation funding: explicit `0.1 MINA`

The `testnet` signing domain is a current Auro/Zeko Testnet compatibility requirement. If Zeko later exposes a production network with a distinct signing domain, update `packages/shared/src/index.ts` and retest Auro signatures before changing it.

The backend does not use Mina-only `bestChain` transaction scans on Zeko. Zeko transaction status is inferred from the game zkApp state when possible, and otherwise returned as `UNKNOWN`. Current-slot support is also limited, so Zeko refund deadlines are treated as experimental placeholders.

## Prover Modes

By default, o1js compilation and proof generation run in the browser:

```env
VITE_PROVER_MODE=client
```

This is the safest privacy mode. Secrets needed by commit/reveal proofs stay in the browser, and the API only indexes game metadata and transaction hashes. The browser/client path is pinned to `o1js@2.15.0`.

An experimental server prover mode is available:

```env
VITE_PROVER_MODE=server
VITE_SERVER_PROVER_POLL_MS=1500
ZKROLL_PROVER_WORKERS=1
ZKROLL_PROVER_FEE_NANOMINA=100000000
ZKROLL_PROVER_DEBUG=false
```

In server mode, the browser creates an async prover job on the API, polls it, and then asks the wallet to sign the returned transaction JSON. The wallet still signs and pays the transaction fee. This mode can help browsers/devices that cannot prove locally, but it sends the circuit inputs required for proving, including game secrets, to the API. Treat it as opt-in and experimental until there is a hardened native worker pool and a deployment model you trust.

The server prover path is intentionally isolated from the web bundle. It uses `o1js-native`, an npm alias to `o1js@2.15.0`, plus a server-only copy of the game contract importing that alias. This lets the browser stay on the stable client o1js version while the server prover uses the native backend.

For production, run the native prover in a separate process/container and point the API at it:

```env
ZKROLL_PROVER_MODE=server
ZKROLL_PROVER_URL=http://prover:4001
ZKROLL_PROVER_REQUEST_TIMEOUT_MS=30000
```

With `ZKROLL_PROVER_URL` set, the public API process does not import `serverProver.ts` or `o1js-native`; it proxies `/prover/*` work to the isolated prover service over internal HTTP. Without `ZKROLL_PROVER_URL`, the API falls back to the legacy in-process prover for local development. The prover queue is still in-memory and executes one native o1js job at a time per prover process; queued jobs are lost if the prover process restarts.

Set `ZKROLL_PROVER_DEBUG=true` temporarily to emit structured diagnostics for native-prover issues. The logs include job lifecycle, selected network, native backend, compile-cache keys, verification key hash, and non-secret proving inputs. They intentionally omit game secrets and zkApp private keys.

When `ZKROLL_PROVER_MODE=server` is set on the API and `VITE_PROVER_MODE=server` is set on the web app, an admin-only maintenance action is available in Settings for the configured `ZKROLL_ADMIN_PUBLIC_KEY` / `VITE_ADMIN_PUBLIC_KEY`. It clears the native o1js filesystem cache, drops queued prover jobs, and resets in-memory compile promises. In isolated deployments this action is forwarded to the prover container. It refuses to run while a prover job is active. With `ZKROLL_PROVER_RESTART_ON_CACHE_CLEAR=true`, the isolated prover process exits after a successful clear; Docker restarts it through `restart: unless-stopped`. If o1js reports `Cannot start new transaction within another transaction`, this restart is required because that error means the in-process native transaction context is already contaminated.

The native server prover is intended for Linux/Docker production, where `@o1js/native-linux-*` is present in the lockfile. Windows local development should keep using client proving unless native package support is verified for the local environment.

## Browser Proving Requirements

Client-side proving requires production hosting to serve the web app with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`window.crossOriginIsolated` must return `true`.

The o1js browser cache can be disabled with:

```env
VITE_O1JS_BROWSER_CACHE_ENABLED=false
```

On mobile, Auro's in-app browser does not expose the isolation needed by o1js proving. Use a native mobile browser with `window.crossOriginIsolated === true`, then connect/sign through Auro Mobile WalletConnect:

```env
VITE_WALLETCONNECT_PROJECT_ID=your-reown-project-id
```

Desktop/laptop keeps using the injected `window.mina` provider when the Auro extension is available. WalletConnect is only used when `window.mina` is absent and `VITE_WALLETCONNECT_PROJECT_ID` is configured.

## Interface Locales

The frontend language selector supports English, French, Chinese, Turkish, Russian, German, Japanese, and Spanish. Locale choice is stored in browser local storage and all UI copy is resolved through the in-app translation table with English as the fallback.

## Zeko Current Slot Source

Zeko Testnet does not expose every Mina node GraphQL field used by o1js helper APIs. For refund/cancel deadlines, the backend resolves `current-slot` for Zeko from a Mina L1 slot source instead of a sequencer index. The source defaults to Devnet and can be changed with:

```env
ZKROLL_ZEKO_SLOT_SOURCE_NETWORK=devnet
```

Use `mainnet` only if a future Zeko environment explicitly uses mainnet L1 slots. If the selected source does not match Zeko's slot semantics, the expected failure mode is a rejected refund/cancel transaction.

## PWA And Notifications

The web app ships a manifest and a Firebase Messaging service worker, so it can be installed as a PWA on supported browsers.

Per-game notifications are stored in SQLite by `game_id`, wallet public key, and FCM token. The backend sends a Firebase Cloud Messaging push whenever a game mutation changes `updated_at`; when a game reaches `settled`, `refunded`, `failed`, or `cancelled`, the backend removes the subscriptions for that game.

Frontend configuration:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
```

API configuration:

```env
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

If Firebase is not configured, the bell controls fail gracefully and the rest of the app is unchanged.

## Upgrade Rule

Changing contract methods changes the verification key for newly created games.

Existing games keep the verification key they were deployed with. Finish or refund old games before deploying a UI that no longer contains compatible proving code.

## Production Roadmap

For a public deployment, add:

- wallet-signed authentication for write endpoints;
- rate limiting;
- structured logs and alerting;
- SQLite backups or Postgres;
- contract events/actions and an archive-node or hosted-indexer based rebuild process.
