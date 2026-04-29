import Database from "better-sqlite3";
import type { Game, GameStatus, NetworkId, Player } from "@zkroll/shared";

const dbPath = process.env.ZKROLL_DB_PATH ?? "zkroll.db";

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  create table if not exists players (
    pseudo text primary key,
    public_key text not null unique,
    created_at text not null
  );

  create table if not exists games (
    id text primary key,
    network text not null,
    zkapp_address text,
    game_id_field text,
    creator_pseudo text not null,
    creator_public_key text not null,
    creator_pseudo_hash text,
    joiner_pseudo text,
    joiner_public_key text,
    joiner_pseudo_hash text,
    stake_nano_mina text not null,
    creator_commitment text not null,
    joiner_commitment text,
    creator_reveal text,
    joiner_reveal text,
    creator_die integer,
    joiner_die integer,
    winner_public_key text,
    status text not null,
    refund_timeout_slots integer not null default 120,
    refund_deadline_slot text,
    pending_join_refund_deadline_slot text,
    failure_reason text,
    creation_tx_hash text not null unique,
    join_tx_hash text,
    settlement_tx_hash text,
    refund_tx_hash text,
    created_at text not null,
    updated_at text not null,
    foreign key (creator_pseudo) references players(pseudo),
    foreign key (joiner_pseudo) references players(pseudo)
  );
`);

for (const statement of [
  "alter table games add column zkapp_address text",
  "alter table games add column game_id_field text",
  "alter table games add column creator_pseudo_hash text",
  "alter table games add column joiner_pseudo_hash text",
  "alter table games add column refund_timeout_slots integer not null default 120",
  "alter table games add column refund_deadline_slot text",
  "alter table games add column pending_join_refund_deadline_slot text",
  "alter table games add column failure_reason text",
  "alter table games add column refund_tx_hash text"
]) {
  try {
    db.exec(statement);
  } catch (error) {
    if (!String((error as Error).message).includes("duplicate column name")) {
      throw error;
    }
  }
}

type PlayerRow = {
  pseudo: string;
  public_key: string;
  created_at: string;
};

type GameRow = {
  id: string;
  network: NetworkId;
  zkapp_address: string | null;
  game_id_field: string | null;
  creator_pseudo: string;
  creator_public_key: string;
  creator_pseudo_hash: string | null;
  joiner_pseudo: string | null;
  joiner_public_key: string | null;
  joiner_pseudo_hash: string | null;
  stake_nano_mina: string;
  creator_commitment: string;
  joiner_commitment: string | null;
  creator_reveal: string | null;
  joiner_reveal: string | null;
  creator_die: number | null;
  joiner_die: number | null;
  winner_public_key: string | null;
  status: GameStatus;
  refund_timeout_slots: number;
  refund_deadline_slot: string | null;
  pending_join_refund_deadline_slot: string | null;
  failure_reason: string | null;
  creation_tx_hash: string;
  join_tx_hash: string | null;
  settlement_tx_hash: string | null;
  refund_tx_hash: string | null;
  created_at: string;
  updated_at: string;
};

function playerFromRow(row: PlayerRow): Player {
  return {
    pseudo: row.pseudo,
    publicKey: row.public_key,
    createdAt: row.created_at
  };
}

function gameFromRow(row: GameRow): Game {
  return {
    id: row.id,
    network: row.network,
    zkappAddress: row.zkapp_address,
    gameIdField: row.game_id_field,
    creatorPseudo: row.creator_pseudo,
    creatorPublicKey: row.creator_public_key,
    creatorPseudoHash: row.creator_pseudo_hash,
    joinerPseudo: row.joiner_pseudo,
    joinerPublicKey: row.joiner_public_key,
    joinerPseudoHash: row.joiner_pseudo_hash,
    stakeNanoMina: row.stake_nano_mina,
    creatorCommitment: row.creator_commitment,
    joinerCommitment: row.joiner_commitment,
    creatorReveal: row.creator_reveal,
    joinerReveal: row.joiner_reveal,
    creatorDie: row.creator_die,
    joinerDie: row.joiner_die,
    winnerPublicKey: row.winner_public_key,
    status: row.status,
    refundTimeoutSlots: row.refund_timeout_slots,
    refundDeadlineSlot: row.refund_deadline_slot,
    pendingJoinRefundDeadlineSlot: row.pending_join_refund_deadline_slot,
    failureReason: row.failure_reason,
    creationTxHash: row.creation_tx_hash,
    joinTxHash: row.join_tx_hash,
    settlementTxHash: row.settlement_tx_hash,
    refundTxHash: row.refund_tx_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function upsertPlayer(pseudo: string, publicKey: string): Player {
  const now = new Date().toISOString();
  const existingPseudoOwner = getPlayerByPseudo(pseudo);
  if (existingPseudoOwner && existingPseudoOwner.publicKey !== publicKey) {
    throw new Error("Pseudo already used by another wallet");
  }

  db.prepare(
    `
    insert into players (pseudo, public_key, created_at)
    values (?, ?, ?)
    on conflict(public_key) do update set pseudo = excluded.pseudo
  `
  ).run(pseudo, publicKey, now);

  return getPlayerByPublicKey(publicKey)!;
}

export function getPlayerByPseudo(pseudo: string): Player | null {
  const row = db.prepare("select * from players where pseudo = ?").get(pseudo) as PlayerRow | undefined;
  return row ? playerFromRow(row) : null;
}

export function getPlayerByPublicKey(publicKey: string): Player | null {
  const row = db.prepare("select * from players where public_key = ?").get(publicKey) as PlayerRow | undefined;
  return row ? playerFromRow(row) : null;
}

export function createGame(input: {
  id: string;
  network: NetworkId;
  zkappAddress?: string;
  gameIdField?: string;
  creatorPseudo: string;
  creatorPublicKey: string;
  creatorPseudoHash?: string;
  stakeNanoMina: string;
  creatorCommitment: string;
  refundTimeoutSlots: number;
  refundDeadlineSlot?: string;
  creationTxHash?: string;
}): Game {
  const now = new Date().toISOString();
  const creationTxHash = input.creationTxHash ?? `pending:${input.id}`;
  const status: GameStatus = input.creationTxHash ? "created" : "pending_signature";
  db.prepare(
    `
    insert into games (
      id, network, zkapp_address, game_id_field, creator_pseudo, creator_public_key, creator_pseudo_hash, stake_nano_mina,
      creator_commitment, refund_timeout_slots, refund_deadline_slot, status, creation_tx_hash, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    input.id,
    input.network,
    input.zkappAddress ?? null,
    input.gameIdField ?? null,
    input.creatorPseudo,
    input.creatorPublicKey,
    input.creatorPseudoHash ?? null,
    input.stakeNanoMina,
    input.creatorCommitment,
    input.refundTimeoutSlots,
    input.refundDeadlineSlot ?? null,
    status,
    creationTxHash,
    now,
    now
  );

  return getGame(input.id)!;
}

export function reconcileCreationTx(id: string, creationTxHash: string): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set creation_tx_hash = ?,
          status = 'created',
          updated_at = ?
      where id = ? and status = 'pending_signature'
    `
    )
    .run(creationTxHash, now, id);

  if (result.changes !== 1) {
    throw new Error("Game cannot be reconciled");
  }

  return getGame(id)!;
}

export function markCreationFailed(id: string, reason?: string): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set status = 'failed',
          failure_reason = ?,
          updated_at = ?
      where id = ?
        and status in ('pending_signature', 'created')
        and join_tx_hash is null
    `
    )
    .run(reason ?? null, now, id);

  if (result.changes !== 1) {
    throw new Error("Game creation cannot be marked as failed");
  }

  return getGame(id)!;
}

export function listGames(status?: GameStatus): Game[] {
  const rows = status
    ? (db.prepare("select * from games where status = ? order by created_at desc").all(status) as GameRow[])
    : (db.prepare("select * from games order by created_at desc").all() as GameRow[]);

  return rows.map(gameFromRow);
}

export function getGame(id: string): Game | null {
  const row = db.prepare("select * from games where id = ?").get(id) as GameRow | undefined;
  return row ? gameFromRow(row) : null;
}

export function joinGame(
  id: string,
  input: {
    joinerPseudo: string;
    joinerPublicKey: string;
    joinerPseudoHash?: string;
    joinerCommitment: string;
    refundDeadlineSlot?: string;
    joinTxHash: string;
  }
): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set joiner_pseudo = ?,
          joiner_public_key = ?,
          joiner_pseudo_hash = ?,
          joiner_commitment = ?,
          pending_join_refund_deadline_slot = ?,
          join_tx_hash = ?,
          status = 'join_pending',
          updated_at = ?
      where id = ? and status = 'created'
    `
    )
    .run(
      input.joinerPseudo,
      input.joinerPublicKey,
      input.joinerPseudoHash ?? null,
      input.joinerCommitment,
      input.refundDeadlineSlot ?? null,
      input.joinTxHash,
      now,
      id
    );

  if (result.changes !== 1) {
    throw new Error("Game is not open");
  }

  return getGame(id)!;
}

export function confirmJoinGame(id: string): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set refund_deadline_slot = coalesce(pending_join_refund_deadline_slot, refund_deadline_slot),
          pending_join_refund_deadline_slot = null,
          status = 'joined',
          updated_at = ?
      where id = ? and status = 'join_pending' and join_tx_hash is not null
    `
    )
    .run(now, id);

  if (result.changes !== 1) {
    throw new Error("Join cannot be confirmed");
  }

  return getGame(id)!;
}

export function failPendingJoin(id: string, reason?: string): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set joiner_pseudo = null,
          joiner_public_key = null,
          joiner_pseudo_hash = null,
          joiner_commitment = null,
          join_tx_hash = null,
          pending_join_refund_deadline_slot = null,
          failure_reason = ?,
          status = 'created',
          updated_at = ?
      where id = ? and status = 'join_pending'
    `
    )
    .run(reason ?? null, now, id);

  if (result.changes !== 1) {
    throw new Error("Pending join cannot be released");
  }

  return getGame(id)!;
}

export function refundGame(id: string, input: { refundTxHash: string }): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set refund_tx_hash = ?,
          status = 'refunded',
          updated_at = ?
      where id = ?
        and status in ('created', 'joined', 'player_one_revealed', 'player_two_revealed')
    `
    )
    .run(input.refundTxHash, now, id);

  if (result.changes !== 1) {
    throw new Error("Game cannot be refunded");
  }

  return getGame(id)!;
}

export function revealSecret(id: string, publicKey: string, secret: string): Game {
  const game = getGame(id);
  if (!game) throw new Error("Game not found");
  if (game.status !== "joined" && game.status !== "player_one_revealed" && game.status !== "player_two_revealed") {
    throw new Error("Game cannot accept reveals");
  }

  const now = new Date().toISOString();
  const isCreator = publicKey === game.creatorPublicKey;
  const isJoiner = publicKey === game.joinerPublicKey;
  if (!isCreator && !isJoiner) {
    throw new Error("Player is not part of this game");
  }

  const nextStatus =
    isCreator && game.joinerReveal
      ? "player_two_revealed"
      : isJoiner && game.creatorReveal
        ? "player_one_revealed"
        : isCreator
          ? "player_one_revealed"
          : "player_two_revealed";

  db.prepare(
    `
    update games
    set creator_reveal = coalesce(?, creator_reveal),
        joiner_reveal = coalesce(?, joiner_reveal),
        status = ?,
        updated_at = ?
    where id = ?
  `
  ).run(isCreator ? secret : null, isJoiner ? secret : null, nextStatus, now, id);

  return getGame(id)!;
}

export function settleGame(
  id: string,
  input: {
    creatorDie: number;
    joinerDie: number;
    winnerPublicKey: string | null;
    settlementTxHash: string;
  }
): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set creator_die = ?,
          joiner_die = ?,
          winner_public_key = ?,
          settlement_tx_hash = ?,
          status = 'settled',
          updated_at = ?
      where id = ? and creator_reveal is not null and joiner_reveal is not null
    `
    )
    .run(input.creatorDie, input.joinerDie, input.winnerPublicKey, input.settlementTxHash, now, id);

  if (result.changes !== 1) {
    throw new Error("Game cannot be settled");
  }

  return getGame(id)!;
}
