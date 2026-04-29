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

## 4. Create The Global zkApp Address

A zkApp address is a Mina keypair:

- private key: signs deployment of the smart contract account;
- public key: the on-chain smart contract address.

Generate it:

```bash
npm run contracts:keygen
```

The command prints:

- `privateKey`: use as `ZKAPP_PRIVATE_KEY`;
- `publicKey`: use as `VITE_ZKROLL_CONTRACT_ADDRESS` and `ZKROLL_CONTRACT_ADDRESS`;
- `randomFieldSecret`: useful only for manual tests.

Keep private keys out of Git.

## 5. Deploy The Global Contract

The app uses one global `ZkRoll` contract per network.

`FEE_PAYER_PRIVATE_KEY` is the private key of a funded Mina account that pays:

- the deployment transaction fee;
- the account creation fee for the zkApp account.

`ZKAPP_PRIVATE_KEY` is the new key generated for the contract address. Prefer using a different funded account as fee payer.

PowerShell:

```powershell
$env:NETWORK="devnet"
$env:FEE_PAYER_PRIVATE_KEY="EK..."
$env:ZKAPP_PRIVATE_KEY="EK..."
$env:FEE_NANOMINA="100000000"
npm run contracts:deploy-roll
```

Bash:

```bash
export NETWORK="devnet"
export FEE_PAYER_PRIVATE_KEY="EK..."
export ZKAPP_PRIVATE_KEY="EK..."
export FEE_NANOMINA="100000000"
npm run contracts:deploy-roll
```

The output includes:

- `txHash`
- `zkappAddress`

Wait until the deployment transaction is included in a Devnet block before using the UI.

## 6. Configure The API

The API stores the UX/indexer mirror in SQLite and must know the deployed global contract address.

Template file:

```text
apps/api/.env.example
```

Exact content:

```env
ZKROLL_DB_PATH=zkroll-devnet.db
ZKROLL_CONTRACT_ADDRESS=B62_REPLACE_WITH_DEPLOYED_ZKROLL_ADDRESS
ZKROLL_WEB_ORIGIN=http://127.0.0.1:5174
```

For local development, you can either export the variables in your shell or create your own `.env` loading mechanism. The current API reads environment variables directly.

PowerShell:

```powershell
$env:ZKROLL_DB_PATH="zkroll-devnet.db"
$env:ZKROLL_CONTRACT_ADDRESS="B62_REPLACE_WITH_DEPLOYED_ZKROLL_ADDRESS"
$env:ZKROLL_WEB_ORIGIN="http://127.0.0.1:5174"
npm run dev:api
```

Bash:

```bash
export ZKROLL_DB_PATH="zkroll-devnet.db"
export ZKROLL_CONTRACT_ADDRESS="B62_REPLACE_WITH_DEPLOYED_ZKROLL_ADDRESS"
export ZKROLL_WEB_ORIGIN="http://127.0.0.1:5174"
npm run dev:api
```

Use a fresh SQLite file for each fresh contract deployment. The contract starts with an empty Merkle root, so an old DB containing games from another contract will not match the on-chain root.

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
VITE_ZKROLL_CONTRACT_ADDRESS=B62_REPLACE_WITH_DEPLOYED_ZKROLL_ADDRESS
VITE_FEE_NANOMINA=100000000
VITE_WALLET_RESPONSE_TIMEOUT_MS=120000
VITE_REFUND_TIMEOUT_SLOTS=120
VITE_O1JS_BROWSER_CACHE_ENABLED=true
```

Without `VITE_ONCHAIN_ENABLED=true`, the UI stays in simulation mode.

`VITE_API_URL` defaults to `http://127.0.0.1:4000` if omitted, but keeping it explicit makes local setup easier to audit.

Restart Vite after changing `.env.local`:

```bash
npm run dev:web
```

The Vite server is configured with COOP/COEP headers because o1js browser proving uses WebAssembly features that require `crossOriginIsolated`. If you see an error mentioning `WebAssembly.Memory object cannot be serialized`, restart `npm run dev:web`.

`VITE_WALLET_RESPONSE_TIMEOUT_MS` controls the fallback when the wallet sends a transaction but does not return a hash to the page. After this timeout, the UI asks you to paste the hash shown by Auro or the explorer so the backend can index the game.

`VITE_REFUND_TIMEOUT_SLOTS` is the default refund timeout, in Mina global slots, used when creating a challenge. The creator can change it in the UI before creating a game. The chosen timeout is converted into an absolute `refundDeadlineSlot` and stored in the on-chain Merkle leaf.

`VITE_O1JS_BROWSER_CACHE_ENABLED=false` disables the best-effort o1js browser cache stored in `localStorage`. Use it if circuit compilation hangs after previous runs or after changing o1js/contract versions. With the cache disabled, the first compile can be slower but avoids stale or corrupted local proving data.

For game creation, the UI now creates a local `pending_signature` game before opening Auro. This protects the deterministic data needed to rebuild the Merkle leaf if Auro signs and broadcasts the transaction but does not return the hash to the web page.

Make sure the browser wallet is on the same network as the deployed contract.

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
7. Wait until the UI shows the creation as included/synced. If the explorer shows the create transaction as failed, click `Marquer echouee`; no funds were locked and the local game is excluded from the Merkle root.
8. Connect a second funded Devnet wallet.
9. Join the challenge. The joiner pays the fee and locks the matching stake.
10. Wait until the UI shows the join as included/synced.
11. Reveal from both players.
12. Click `Regler`. The wallet that clicks pays the settlement fee.

The contract recomputes both dice, validates the commitments, and pays the pot or refunds both players on a draw.

If a challenge gets stuck:

- before a second player joins, `Refund` returns the creator stake after `refundDeadlineSlot`;
- after a second player joins, `Refund` returns both stakes after `refundDeadlineSlot`;
- the wallet that clicks `Refund` pays the transaction fee;
- the contract rejects refund transactions before the deadline slot.

## 10. How Sync Status Works

The backend does not trust transaction hashes directly. It:

1. reconstructs the game Merkle root from SQLite for the selected network only;
2. fetches `gamesRoot` from the global zkApp account on that same network;
3. treats the indexed state as included/synced when both roots match.

This is why `ZKROLL_CONTRACT_ADDRESS` is required for the API.

Because this status is root-based, an older transaction can appear as `PENDING` while SQLite has already advanced beyond the corresponding on-chain root. When the newest local transition is included and the contract root catches up, those older transactions usually become `INCLUDED` at the same time. The hash itself may already be valid on the explorer; the UI status means "the whole indexed state is synced with the contract".

SQLite can contain games for several networks at the same time. Witnesses and sync checks are network-scoped, so Devnet games do not affect Mainnet roots, even if the zkApp address is the same on both networks.

`pending_signature` games are deliberately excluded from the backend Merkle root. They become part of the root only after the creation hash is reconciled and the game moves to `created`. If the browser loses the wallet response, use `Renseigner le hash` on the pending game instead of creating another game with the same transaction.

`failed` games are also excluded from the backend Merkle root. Use this status when a creation transaction exists on the explorer but failed on-chain, for example with `Valid_while_precondition_unsatisfied`. This is a local/indexer cleanup only and does not require a contract redeploy.

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
npm run contracts:deploy-roll
```

## 14. Production Notes

- The backend is not trusted for payouts.
- The chain is the source of truth for stake locking, commitments, dice rolls, and payout.
- The backend stores pseudos, lists games, provides Merkle witnesses, and mirrors the current Merkle state.
- Browser proving with o1js is heavy. The production build warns about the large o1js chunk; this is expected for now.
- A production indexer should rebuild SQLite from chain events/actions instead of relying only on local writes.

## 15. Contract Upgrade Notes

Adding or changing the refund logic changes the contract method set and verification key. Deploy a fresh global contract address and use a fresh SQLite database after this update:

```powershell
$env:ZKROLL_DB_PATH="zkroll-devnet-refund.db"
```

```bash
export ZKROLL_DB_PATH="zkroll-devnet-refund.db"
```

Old games created with a previous contract cannot be refunded by the new refund methods because their Merkle leaves do not contain `refundDeadlineSlot`.
