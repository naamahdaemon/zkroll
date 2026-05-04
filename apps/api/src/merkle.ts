import { Field, MerkleMap, PublicKey, UInt32, UInt64 } from "o1js";
import { CREATED, EMPTY, gameLeaf, JOINED, REFUNDED, SETTLED } from "@zkroll/contracts";
import { type Game, type GameStatus, type NetworkId } from "@zkroll/shared";
import { listGames } from "./db.js";

function statusField(status: GameStatus) {
  if (status === "created") return CREATED;
  if (status === "joined" || status === "player_one_revealed" || status === "player_two_revealed" || status === "both_revealed") return JOINED;
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

export function leafForGame(game: Game, options?: { pendingJoinAsJoined?: boolean }): Field {
  const isPendingJoinCurrent = game.status === "join_pending" && !options?.pendingJoinAsJoined;
  const status = game.status === "join_pending" ? (options?.pendingJoinAsJoined ? "joined" : "created") : game.status;
  const joinerPublicKey = isPendingJoinCurrent ? null : game.joinerPublicKey;
  const joinerPseudoHash = isPendingJoinCurrent ? null : game.joinerPseudoHash;
  const joinerCommitment = isPendingJoinCurrent ? null : game.joinerCommitment;
  const refundDeadlineSlot =
    game.status === "join_pending" && options?.pendingJoinAsJoined
      ? game.pendingJoinRefundDeadlineSlot
      : game.refundDeadlineSlot;

  return gameLeaf({
    status: statusField(status),
    creator: PublicKey.fromBase58(game.creatorPublicKey),
    creatorPseudoHash: fieldOrEmpty(game.creatorPseudoHash),
    joiner: publicKeyOrEmpty(joinerPublicKey),
    joinerPseudoHash: fieldOrEmpty(joinerPseudoHash),
    stake: UInt64.from(game.stakeNanoMina),
    creatorCommitment: Field(game.creatorCommitment),
    joinerCommitment: fieldOrEmpty(joinerCommitment),
    creatorDie: game.creatorDie ? Field(game.creatorDie) : EMPTY,
    joinerDie: game.joinerDie ? Field(game.joinerDie) : EMPTY,
    winner: publicKeyOrEmpty(game.winnerPublicKey),
    refundDeadlineSlot: refundDeadlineSlot ? UInt32.from(refundDeadlineSlot) : UInt32.zero
  });
}

export function buildGamesMap(network: NetworkId, options?: { pendingJoinHash?: string }) {
  const map = new MerkleMap();
  for (const game of listGames()) {
    if (game.network !== network) continue;
    if (!game.gameIdField || game.status === "cancelled" || game.status === "failed" || game.status === "pending_signature") continue;
    try {
      map.set(Field(game.gameIdField), leafForGame(game, { pendingJoinAsJoined: game.joinTxHash === options?.pendingJoinHash }));
    } catch {
      // Ignore older local mock games whose commitments are not Field values.
    }
  }
  return map;
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
