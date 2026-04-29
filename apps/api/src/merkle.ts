import { fetchAccount, Field, MerkleMap, PublicKey, UInt64 } from "o1js";
import { CREATED, EMPTY, gameLeaf, JOINED, SETTLED } from "@zkroll/contracts";
import { networks, type Game, type GameStatus, type NetworkId } from "@zkroll/shared";
import { listGames } from "./db.js";

function statusField(status: GameStatus) {
  if (status === "created") return CREATED;
  if (status === "joined" || status === "player_one_revealed" || status === "player_two_revealed") return JOINED;
  if (status === "settled") return SETTLED;
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
    winner: publicKeyOrEmpty(game.winnerPublicKey)
  });
}

export function buildGamesMap() {
  const map = new MerkleMap();
  for (const game of listGames()) {
    if (!game.gameIdField || game.status === "cancelled" || game.status === "pending_signature") continue;
    try {
      map.set(Field(game.gameIdField), leafForGame(game));
    } catch {
      // Ignore older local mock games whose commitments are not Field values.
    }
  }
  return map;
}

export function backendGamesRoot() {
  return buildGamesMap().getRoot().toString();
}

export async function onchainGamesRoot(network: NetworkId) {
  const address = process.env.ZKROLL_CONTRACT_ADDRESS;
  if (!address) {
    return {
      root: null,
      error: "Missing ZKROLL_CONTRACT_ADDRESS in API environment"
    };
  }

  const { account, error } = await fetchAccount({ publicKey: address }, networks[network].minaEndpoint);
  if (error) {
    return {
      root: null,
      error: error.statusText
    };
  }

  if (!account?.zkapp?.appState?.[0]) {
    return {
      root: null,
      error: `No zkApp appState found for ${address} on ${network}`
    };
  }

  return {
    root: Field(account.zkapp.appState[0]).toString(),
    error: null
  };
}

export function witnessForGameId(gameIdField: string) {
  const map = buildGamesMap();
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
