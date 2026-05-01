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

## Local State

SQLite is an indexer and UX cache. It stores:

- wallet public key to pseudo mappings;
- games and their local workflow status;
- transaction hashes and cached transaction statuses;
- reveal data needed by the UI flow.

The chain remains the source of truth for:

- locked funds;
- commitments;
- joined/settled/refunded contract status;
- settlement payouts and refunds.

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
ZKROLL_CHAIN_REQUEST_TIMEOUT_MS=12000
```

## Browser Proving

o1js proving runs in the browser. Production hosting must serve the web app with:

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
