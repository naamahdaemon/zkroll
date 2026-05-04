# zkroll

MVP for a Mina/Zeko zero-knowledge dice challenge game.

The first implementation uses a commit-reveal flow:

1. A player connects a wallet, picks a pseudo, and creates a challenge.
2. The challenge locks a stake and publishes a commitment, not the dice result.
3. A second player joins with the same stake and their own commitment.
4. Both players reveal their secrets.
5. The zk circuit derives deterministic dice from both secrets and the game id.
6. The contract settles the pot.
7. If a game is abandoned, either player can trigger an on-chain refund after the configured deadline slot.
8. Each challenge is its own zkApp account, created and funded by the creator transaction.
9. A join transaction is indexed as `join_pending` until it is marked included, which prevents competing local joins.
10. The web app is installable as a PWA and can subscribe to Firebase push notifications for active games.
11. The UI supports English, French, Chinese, Turkish, Russian, German, Japanese, and Spanish.

## Packages

- `apps/web`: Vite React frontend.
- `apps/api`: Fastify API with SQLite persistence.
- `packages/contracts`: o1js contract and provable dice logic.
- `packages/shared`: shared TypeScript models and network config.

## Next commands

```bash
npm install
npm run dev:api
npm run dev:web
```

The API listens on `http://127.0.0.1:4000` and the web app uses `http://127.0.0.1:5174`.

See `INSTALL.md` for deployment, `.env.local`, wallet, network, and refund timeout configuration.

See `TECH.md` for the current technical architecture. This version uses one zkApp account per game, so it does not require a global contract address. Use a fresh SQLite database when switching from the old global-root prototype.

The current implementation has been tested on Mina Devnet and Zeko Testnet. Zeko uses the public `https://testnet.zeko.io/graphql` endpoint, but it does not expose every Mina GraphQL field used by Devnet/Mainnet, so the API has dedicated Zeko transaction-status handling. Zeko refund deadlines use a Mina L1 slot source, defaulting to Devnet, configurable with `ZKROLL_ZEKO_SLOT_SOURCE_NETWORK`.

Firebase Cloud Messaging is optional. When configured, each active game displays a bell icon in the list and in the detail panel. Subscribed users receive a push notification whenever the game `updated_at` changes, and notifications are removed automatically once the game reaches a terminal state.
