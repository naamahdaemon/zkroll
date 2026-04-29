import { fetchAccount, Field, MerkleMap, PublicKey, UInt32, UInt64 } from "o1js";
import { CREATED, EMPTY, gameLeaf, JOINED, REFUNDED, SETTLED } from "@zkroll/contracts";
import { networks, type Game, type GameStatus, type NetworkId } from "@zkroll/shared";
import { listGames } from "./db.js";

const onchainRootCacheMs = Number(process.env.ZKROLL_ONCHAIN_ROOT_CACHE_MS ?? 15_000);
const onchainRootCache = new Map<NetworkId, { expiresAt: number; result: { root: string | null; error: string | null } }>();

function statusField(status: GameStatus) {
  if (status === "created") return CREATED;
  if (status === "joined" || status === "player_one_revealed" || status === "player_two_revealed") return JOINED;
  if (status === "settled") return SETTLED;
  if (status === "refunded") return REFUNDED;
  return EMPTY;
}

function fieldOrEmpty(value: string | null) {
  return value ? Field(value) : EMPTY;
}

function publicKeyOrEmpty(value: string | null) {
  return value ? PublicKey.fromBase58(value) : (PublicKey.empty() as PublicKey);
}

export function leafForGame(game: Game): Field {
  return gameLeaf({
    status: statusField(game.status),
    creator: PublicKey.fromBase58(game.creatorPublicKey),
    creatorPseudoHash: fieldOrEmpty(game.creatorPseudoHash),
    joiner: publicKeyOrEmpty(game.joinerPublicKey),
    joinerPseudoHash: fieldOrEmpty(game.joinerPseudoHash),
    stake: UInt64.from(game.stakeNanoMina),
    creatorCommitment: Field(game.creatorCommitment),
    joinerCommitment: fieldOrEmpty(game.joinerCommitment),
    creatorDie: game.creatorDie ? Field(game.creatorDie) : EMPTY,
    joinerDie: game.joinerDie ? Field(game.joinerDie) : EMPTY,
    winner: publicKeyOrEmpty(game.winnerPublicKey),
    refundDeadlineSlot: game.refundDeadlineSlot ? UInt32.from(game.refundDeadlineSlot) : UInt32.zero
  });
}

export function buildGamesMap(network: NetworkId) {
  const map = new MerkleMap();
  for (const game of listGames()) {
    if (game.network !== network) continue;
    if (!game.gameIdField || game.status === "cancelled" || game.status === "failed" || game.status === "pending_signature") continue;
    try {
      map.set(Field(game.gameIdField), leafForGame(game));
    } catch {
      // Ignore older local mock games whose commitments are not Field values.
    }
  }
  return map;
}

export function backendGamesRoot(network: NetworkId) {
  return buildGamesMap(network).getRoot().toString();
}

export async function onchainGamesRoot(network: NetworkId) {
  const cached = onchainRootCache.get(network);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const address = process.env.ZKROLL_CONTRACT_ADDRESS;
  if (!address) {
    const result = {
      root: null,
      error: "Missing ZKROLL_CONTRACT_ADDRESS in API environment"
    };
    onchainRootCache.set(network, { expiresAt: Date.now() + onchainRootCacheMs, result });
    return result;
  }

  const { account, error } = await fetchAccount({ publicKey: address }, networks[network].minaEndpoint);
  if (error) {
    const result = {
      root: null,
      error: error.statusText
    };
    onchainRootCache.set(network, { expiresAt: Date.now() + onchainRootCacheMs, result });
    return result;
  }

  if (!account?.zkapp?.appState?.[0]) {
    const result = {
      root: null,
      error: `No zkApp appState found for ${address} on ${network}`
    };
    onchainRootCache.set(network, { expiresAt: Date.now() + onchainRootCacheMs, result });
    return result;
  }

  const result = {
    root: Field(account.zkapp.appState[0]).toString(),
    error: null
  };
  onchainRootCache.set(network, { expiresAt: Date.now() + onchainRootCacheMs, result });
  return result;
}

export function witnessForGameId(network: NetworkId, gameIdField: string) {
  const map = buildGamesMap(network);
  const key = Field(gameIdField);
  const witness = map.getWitness(key);

  return {
    root: map.getRoot().toString(),
    value: map.get(key).toString(),
    witness: {
      isLefts: witness.isLefts.map((item) => item.toBoolean()),
      siblings: witness.siblings.map((item) => item.toString())
    }
  };
}
