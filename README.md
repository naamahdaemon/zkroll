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

See `INSTALL.md` for deployment, `.env.local`, wallet, and refund timeout configuration. This branch uses one zkApp per game, so use a fresh SQLite database while testing it.
