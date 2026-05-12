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
10. The app rejects reused transaction hashes, treats corrupt settlements as invalid, and only counts trusted settled games in the leaderboard.
11. A player with 5 games waiting for their action on the selected network cannot create another challenge on that network until they unblock earlier games.
12. Admins can mark a locally corrupted game as `unrecoverable` when it cannot be finalized.
13. The leaderboard can be viewed all time or by calendar month, week, or day, with previous/next navigation for dated ranges.
14. The web app is installable as a PWA and can subscribe to Firebase push notifications for active games.
15. The UI supports English, French, Chinese, Turkish, Russian, German, Japanese, and Spanish.

## Screenshots

### Mobile View

<div style="display: flex; flex-wrap: wrap; gap: 10px;">
  <img src="./assets/mobile_view.png" style="flex: 1 1 300px;" />
</div>

### Desktop / Cards view

<div style="display: flex; flex-wrap: wrap; gap: 10px;">
  <img src="./assets/desktop_view.png" style="flex: 1 1 300px;" />
</div>

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

See `INSTALL.md` for deployment, `.env.local`, wallet, network, refund timeout, and operational guardrail configuration.

See `TECH.md` for the current technical architecture. This version uses one zkApp account per game, so it does not require a global contract address. Use a fresh SQLite database when switching from the old global-root prototype.

Proof generation defaults to the existing browser/client flow. An experimental isolated server prover mode can be enabled with `VITE_PROVER_MODE=server`; see `INSTALL.md`, `INSTALL_DOCKER.md`, and `TECH.md` before using it because it changes the privacy model by sending proving inputs to the API/prover service. Docker examples are provided in `.env.production.example` and `docker-compose.prod.example.yml`.

The current implementation has been tested on Mina Devnet and Zeko Testnet. Zeko uses the public `https://testnet.zeko.io/graphql` endpoint, but it does not expose every Mina GraphQL field used by Devnet/Mainnet, so the API has dedicated Zeko transaction-status handling. Zeko refund deadlines use a Mina L1 slot source, defaulting to Devnet, configurable with `ZKROLL_ZEKO_SLOT_SOURCE_NETWORK`.

Firebase Cloud Messaging is optional. When configured, each active game displays a bell icon in the list and in the detail panel. Subscribed users receive a push notification whenever the game `updated_at` changes, and notifications are removed automatically once the game reaches a terminal state.
