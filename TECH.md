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

Manual status forcing is kept as an operational fallback, not as the normal sync path. Normal inclusion should be inferred from the per-game zkApp state.

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
