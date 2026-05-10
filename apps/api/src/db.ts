import Database from "better-sqlite3";
import type { Game, GameMessage, GameStatus, NetworkId, PayoutMode, Player, TransactionStatus } from "@zkroll/shared";

const dbPath = process.env.ZKROLL_DB_PATH ?? "zkroll.db";

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  create table if not exists players (
    public_key text primary key,
    pseudo text not null unique,
    accept_messages integer not null default 1,
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
    payout_mode text not null default 'classic',
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
    creation_tx_status text not null default 'PENDING',
    join_tx_status text,
    settlement_tx_status text,
    refund_tx_status text,
    created_at text not null,
    updated_at text not null,
    join_at text,
    creator_reveal_at text,
    joiner_reveal_at text,
    settled_at text,
    refunded_at text,
    failed_at text,
    cancelled_at text,
    foreign key (creator_public_key) references players(public_key),
    foreign key (joiner_public_key) references players(public_key)
  );

  create table if not exists game_notification_subscriptions (
    game_id text not null,
    public_key text not null,
    fcm_token text not null,
    created_at text not null,
    updated_at text not null,
    primary key (game_id, public_key, fcm_token),
    foreign key (game_id) references games(id) on delete cascade
  );

  create table if not exists new_game_notification_subscriptions (
    network text not null,
    public_key text not null,
    fcm_token text not null,
    created_at text not null,
    updated_at text not null,
    primary key (network, public_key, fcm_token)
  );

  create table if not exists game_messages (
    id text primary key,
    game_id text not null,
    sender_public_key text not null,
    receiver_public_key text not null,
    body text not null,
    created_at text not null,
    read_at text,
    foreign key (game_id) references games(id) on delete cascade
  );
`);

for (const statement of [
  "alter table players add column accept_messages integer not null default 1",
  "alter table games add column zkapp_address text",
  "alter table games add column game_id_field text",
  "alter table games add column creator_pseudo_hash text",
  "alter table games add column joiner_pseudo_hash text",
  "alter table games add column payout_mode text not null default 'classic'",
  "alter table games add column refund_timeout_slots integer not null default 120",
  "alter table games add column refund_deadline_slot text",
  "alter table games add column pending_join_refund_deadline_slot text",
  "alter table games add column failure_reason text",
  "alter table games add column refund_tx_hash text",
  "alter table games add column creation_tx_status text not null default 'PENDING'",
  "alter table games add column join_tx_status text",
  "alter table games add column settlement_tx_status text",
  "alter table games add column refund_tx_status text",
  "alter table games add column join_at text",
  "alter table games add column creator_reveal_at text",
  "alter table games add column joiner_reveal_at text",
  "alter table games add column settled_at text",
  "alter table games add column refunded_at text",
  "alter table games add column failed_at text",
  "alter table games add column cancelled_at text"
]) {
  try {
    db.exec(statement);
  } catch (error) {
    if (!String((error as Error).message).includes("duplicate column name")) {
      throw error;
    }
  }
}

db.exec(`
  update games
  set creation_tx_status = case
      when status = 'failed' then 'FAILED'
      when status in ('joined', 'join_pending', 'player_one_revealed', 'player_two_revealed', 'both_revealed', 'settled', 'refunded') then 'INCLUDED'
      when creation_tx_hash like 'fake%' or creation_tx_hash like 'create_%' then 'INCLUDED'
      when creation_tx_hash like 'pending:%' then 'PENDING'
      else coalesce(nullif(creation_tx_status, ''), 'PENDING')
    end,
    join_tx_status = case
      when join_tx_hash is null then null
      when status in ('joined', 'player_one_revealed', 'player_two_revealed', 'both_revealed', 'settled', 'refunded') then 'INCLUDED'
      when join_tx_hash like 'fake%' or join_tx_hash like 'join_%' then 'INCLUDED'
      else coalesce(nullif(join_tx_status, ''), 'PENDING')
    end,
    settlement_tx_status = case
      when settlement_tx_hash is null then null
      when status = 'settled' then 'INCLUDED'
      when settlement_tx_hash like 'fake%' or settlement_tx_hash like 'settle_%' then 'INCLUDED'
      else coalesce(nullif(settlement_tx_status, ''), 'PENDING')
    end,
    refund_tx_status = case
      when refund_tx_hash is null then null
      when status = 'refunded' then 'INCLUDED'
      when refund_tx_hash like 'fake%' or refund_tx_hash like 'refund_%' then 'INCLUDED'
      else coalesce(nullif(refund_tx_status, ''), 'PENDING')
    end
`);

db.exec(`
  delete from game_notification_subscriptions
  where rowid not in (
    select max(rowid)
    from game_notification_subscriptions
    group by game_id, public_key
  );

  delete from new_game_notification_subscriptions
  where rowid not in (
    select max(rowid)
    from new_game_notification_subscriptions
    group by network, public_key
  );
`);

type PlayerRow = {
  pseudo: string;
  public_key: string;
  accept_messages: number;
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
  payout_mode: PayoutMode;
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
  creation_tx_status: TransactionStatus;
  join_tx_status: TransactionStatus | null;
  settlement_tx_status: TransactionStatus | null;
  refund_tx_status: TransactionStatus | null;
  created_at: string;
  updated_at: string;
  join_at: string | null;
  creator_reveal_at: string | null;
  joiner_reveal_at: string | null;
  settled_at: string | null;
  refunded_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
};

export type GameNotificationSubscription = {
  gameId: string;
  publicKey: string;
  fcmToken: string;
  createdAt: string;
  updatedAt: string;
};

export type NewGameNotificationSubscription = {
  network: NetworkId;
  publicKey: string;
  fcmToken: string;
  createdAt: string;
  updatedAt: string;
};

type GameNotificationSubscriptionRow = {
  game_id: string;
  public_key: string;
  fcm_token: string;
  created_at: string;
  updated_at: string;
};

type NewGameNotificationSubscriptionRow = {
  network: NetworkId;
  public_key: string;
  fcm_token: string;
  created_at: string;
  updated_at: string;
};

type GameMessageRow = {
  id: string;
  game_id: string;
  sender_public_key: string;
  receiver_public_key: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function playerFromRow(row: PlayerRow): Player {
  return {
    pseudo: row.pseudo,
    publicKey: row.public_key,
    acceptMessages: row.accept_messages !== 0,
    createdAt: row.created_at
  };
}

function messageFromRow(row: GameMessageRow): GameMessage {
  return {
    id: row.id,
    gameId: row.game_id,
    senderPublicKey: row.sender_public_key,
    receiverPublicKey: row.receiver_public_key,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at
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
    payoutMode: row.payout_mode ?? "classic",
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
    creationTxStatus: row.creation_tx_status,
    joinTxStatus: row.join_tx_status,
    settlementTxStatus: row.settlement_tx_status,
    refundTxStatus: row.refund_tx_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    joinAt: row.join_at,
    creatorRevealAt: row.creator_reveal_at,
    joinerRevealAt: row.joiner_reveal_at,
    settledAt: row.settled_at,
    refundedAt: row.refunded_at,
    failedAt: row.failed_at,
    cancelledAt: row.cancelled_at
  };
}

function subscriptionFromRow(row: GameNotificationSubscriptionRow): GameNotificationSubscription {
  return {
    gameId: row.game_id,
    publicKey: row.public_key,
    fcmToken: row.fcm_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function newGameSubscriptionFromRow(row: NewGameNotificationSubscriptionRow): NewGameNotificationSubscription {
  return {
    network: row.network,
    publicKey: row.public_key,
    fcmToken: row.fcm_token,
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
    insert into players (public_key, pseudo, created_at)
    values (?, ?, ?)
    on conflict(public_key) do update set pseudo = excluded.pseudo
  `
  ).run(publicKey, pseudo, now);

  return getPlayerByPublicKey(publicKey)!;
}

export function setPlayerMessagePreference(publicKey: string, acceptMessages: boolean): Player {
  const result = db
    .prepare("update players set accept_messages = ? where public_key = ?")
    .run(acceptMessages ? 1 : 0, publicKey);
  if (result.changes !== 1) throw new Error("Player not found");
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

export function listPreviousOpponents(publicKey: string): Player[] {
  const rows = db
    .prepare(
      `
      select distinct p.*
      from players p
      join (
        select joiner_public_key as opponent_public_key
        from games
        where creator_public_key = ? and joiner_public_key is not null
        union
        select creator_public_key as opponent_public_key
        from games
        where joiner_public_key = ?
      ) opponents on opponents.opponent_public_key = p.public_key
      where p.public_key != ?
      order by p.pseudo asc
    `
    )
    .all(publicKey, publicKey, publicKey) as PlayerRow[];
  return rows.map(playerFromRow);
}

function assertGameParticipant(game: Game, publicKey: string) {
  if (publicKey !== game.creatorPublicKey && publicKey !== game.joinerPublicKey) {
    throw new Error("Player is not part of this game");
  }
}

export function listGameMessages(gameId: string, publicKey: string): GameMessage[] {
  const game = getGame(gameId);
  if (!game) throw new Error("Game not found");
  assertGameParticipant(game, publicKey);
  const rows = db
    .prepare("select * from game_messages where game_id = ? order by created_at asc")
    .all(gameId) as GameMessageRow[];
  return rows.map(messageFromRow);
}

export function unreadMessageCounts(publicKey: string): Record<string, number> {
  const rows = db
    .prepare(
      `
      select game_id as gameId, count(*) as count
      from game_messages
      where receiver_public_key = ? and read_at is null
      group by game_id
    `
    )
    .all(publicKey) as { gameId: string; count: number }[];
  return Object.fromEntries(rows.map((row) => [row.gameId, row.count]));
}

export function markGameMessagesRead(gameId: string, publicKey: string): void {
  const game = getGame(gameId);
  if (!game) throw new Error("Game not found");
  assertGameParticipant(game, publicKey);
  db.prepare("update game_messages set read_at = coalesce(read_at, ?) where game_id = ? and receiver_public_key = ?").run(
    new Date().toISOString(),
    gameId,
    publicKey
  );
}

export function createGameMessage(input: {
  id: string;
  gameId: string;
  senderPublicKey: string;
  body: string;
}): { game: Game; message: GameMessage } {
  const game = getGame(input.gameId);
  if (!game) throw new Error("Game not found");
  assertGameParticipant(game, input.senderPublicKey);
  const receiverPublicKey = input.senderPublicKey === game.creatorPublicKey ? game.joinerPublicKey : game.creatorPublicKey;
  if (!receiverPublicKey) throw new Error("Opponent is not known yet");
  const receiver = getPlayerByPublicKey(receiverPublicKey);
  if (receiver && !receiver.acceptMessages) throw new Error("Player does not accept messages");
  const body = input.body.trim();
  if (!body) throw new Error("Message is empty");
  if (body.length > 500) throw new Error("Message is too long");
  const now = new Date().toISOString();
  db.prepare(
    `
    insert into game_messages (id, game_id, sender_public_key, receiver_public_key, body, created_at, read_at)
    values (?, ?, ?, ?, ?, ?, null)
  `
  ).run(input.id, input.gameId, input.senderPublicKey, receiverPublicKey, body, now);
  const message = db.prepare("select * from game_messages where id = ?").get(input.id) as GameMessageRow;
  return { game, message: messageFromRow(message) };
}

export function listGameNotificationSubscriptions(gameId: string): GameNotificationSubscription[] {
  const rows = db
    .prepare("select * from game_notification_subscriptions where game_id = ? order by updated_at desc")
    .all(gameId) as GameNotificationSubscriptionRow[];
  return rows.map(subscriptionFromRow);
}

export function listNotificationSubscriptionsForPublicKey(publicKey: string): GameNotificationSubscription[] {
  const rows = db
    .prepare("select * from game_notification_subscriptions where public_key = ? order by updated_at desc")
    .all(publicKey) as GameNotificationSubscriptionRow[];
  return rows.map(subscriptionFromRow);
}

export function listNewGameNotificationSubscriptions(network: NetworkId): NewGameNotificationSubscription[] {
  const rows = db
    .prepare("select * from new_game_notification_subscriptions where network = ? order by updated_at desc")
    .all(network) as NewGameNotificationSubscriptionRow[];
  return rows.map(newGameSubscriptionFromRow);
}

export function listNewGameNotificationSubscriptionsForPublicKey(publicKey: string): NewGameNotificationSubscription[] {
  const rows = db
    .prepare("select * from new_game_notification_subscriptions where public_key = ? order by updated_at desc")
    .all(publicKey) as NewGameNotificationSubscriptionRow[];
  return rows.map(newGameSubscriptionFromRow);
}

export function listNotificationTokensForPublicKey(publicKey: string): string[] {
  const gameRows = db
    .prepare("select distinct fcm_token as token from game_notification_subscriptions where public_key = ?")
    .all(publicKey) as { token: string }[];
  const newGameRows = db
    .prepare("select distinct fcm_token as token from new_game_notification_subscriptions where public_key = ?")
    .all(publicKey) as { token: string }[];
  return [...new Set([...gameRows, ...newGameRows].map((row) => row.token))];
}

export function subscribeGameNotification(gameId: string, publicKey: string, fcmToken: string): GameNotificationSubscription {
  const game = getGame(gameId);
  if (!game) throw new Error("Game not found");
  if (game.status === "settled" || game.status === "refunded" || game.status === "failed" || game.status === "cancelled") {
    throw new Error("Notifications are only available for active games");
  }

  const now = new Date().toISOString();
  db.prepare("delete from game_notification_subscriptions where game_id = ? and public_key = ?").run(gameId, publicKey);
  db.prepare(
    `
    insert into game_notification_subscriptions (game_id, public_key, fcm_token, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(game_id, public_key, fcm_token) do update set updated_at = excluded.updated_at
  `
  ).run(gameId, publicKey, fcmToken, now, now);

  const row = db
    .prepare("select * from game_notification_subscriptions where game_id = ? and public_key = ? and fcm_token = ?")
    .get(gameId, publicKey, fcmToken) as GameNotificationSubscriptionRow;
  return subscriptionFromRow(row);
}

export function unsubscribeGameNotification(gameId: string, publicKey: string, fcmToken?: string): void {
  if (fcmToken) {
    db.prepare("delete from game_notification_subscriptions where game_id = ? and public_key = ? and fcm_token = ?").run(
      gameId,
      publicKey,
      fcmToken
    );
    return;
  }

  db.prepare("delete from game_notification_subscriptions where game_id = ? and public_key = ?").run(gameId, publicKey);
}

export function subscribeNewGameNotification(
  network: NetworkId,
  publicKey: string,
  fcmToken: string
): NewGameNotificationSubscription {
  const now = new Date().toISOString();
  db.prepare("delete from new_game_notification_subscriptions where network = ? and public_key = ?").run(network, publicKey);
  db.prepare(
    `
    insert into new_game_notification_subscriptions (network, public_key, fcm_token, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(network, public_key, fcm_token) do update set updated_at = excluded.updated_at
  `
  ).run(network, publicKey, fcmToken, now, now);

  const row = db
    .prepare("select * from new_game_notification_subscriptions where network = ? and public_key = ? and fcm_token = ?")
    .get(network, publicKey, fcmToken) as NewGameNotificationSubscriptionRow;
  return newGameSubscriptionFromRow(row);
}

export function unsubscribeNewGameNotification(network: NetworkId, publicKey: string, fcmToken?: string): void {
  if (fcmToken) {
    db.prepare("delete from new_game_notification_subscriptions where network = ? and public_key = ? and fcm_token = ?").run(
      network,
      publicKey,
      fcmToken
    );
    return;
  }

  db.prepare("delete from new_game_notification_subscriptions where network = ? and public_key = ?").run(network, publicKey);
}

export function deleteNotificationSubscriptionToken(fcmToken: string): void {
  db.prepare("delete from game_notification_subscriptions where fcm_token = ?").run(fcmToken);
  db.prepare("delete from new_game_notification_subscriptions where fcm_token = ?").run(fcmToken);
}

export function disableGameNotifications(gameId: string): void {
  db.prepare("delete from game_notification_subscriptions where game_id = ?").run(gameId);
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
  payoutMode: PayoutMode;
  creatorCommitment: string;
  refundTimeoutSlots: number;
  refundDeadlineSlot?: string;
  creationTxHash?: string;
}): Game {
  const now = new Date().toISOString();
  const creationTxHash = input.creationTxHash ?? `pending:${input.id}`;
  const status: GameStatus = input.creationTxHash ? "created" : "pending_signature";
  const creationTxStatus: TransactionStatus =
    input.creationTxHash?.startsWith("fake") || input.creationTxHash?.startsWith("create_") ? "INCLUDED" : "PENDING";
  db.prepare(
    `
    insert into games (
      id, network, zkapp_address, game_id_field, creator_pseudo, creator_public_key, creator_pseudo_hash, stake_nano_mina, payout_mode,
      creator_commitment, refund_timeout_slots, refund_deadline_slot, status, creation_tx_hash, creation_tx_status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    input.payoutMode,
    input.creatorCommitment,
    input.refundTimeoutSlots,
    input.refundDeadlineSlot ?? null,
    status,
    creationTxHash,
    creationTxStatus,
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
          creation_tx_status = 'PENDING',
          status = 'created',
          updated_at = ?
      where id = ?
        and status in ('pending_signature', 'created')
        and (creation_tx_hash like 'pending:%' or creation_tx_status in ('PENDING', 'FAILED'))
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
          creation_tx_status = 'FAILED',
          failure_reason = ?,
          failed_at = ?,
          updated_at = ?
      where id = ?
        and status in ('pending_signature', 'created')
        and join_tx_hash is null
    `
    )
    .run(reason ?? null, now, now, id);

  if (result.changes !== 1) {
    throw new Error("Game creation cannot be marked as failed");
  }

  return getGame(id)!;
}

export function listGames(status?: GameStatus): Game[] {
  const rows = status
    ? (db.prepare("select * from games where status = ? order by updated_at desc, created_at desc").all(status) as GameRow[])
    : (db.prepare("select * from games order by updated_at desc, created_at desc").all() as GameRow[]);

  return rows.map(gameFromRow);
}

export function getGame(id: string): Game | null {
  const row = db.prepare("select * from games where id = ?").get(id) as GameRow | undefined;
  return row ? gameFromRow(row) : null;
}

export function getStoredTransactionStatus(network: NetworkId, hash: string): TransactionStatus | null {
  const row = db
    .prepare(
      `
      select
        case
          when creation_tx_hash = ? then creation_tx_status
          when join_tx_hash = ? then join_tx_status
          when settlement_tx_hash = ? then settlement_tx_status
          when refund_tx_hash = ? then refund_tx_status
        end as status
      from games
      where network = ?
        and ? in (creation_tx_hash, join_tx_hash, settlement_tx_hash, refund_tx_hash)
      limit 1
    `
    )
    .get(hash, hash, hash, hash, network, hash) as { status: TransactionStatus | null } | undefined;
  return row?.status ?? null;
}

export function getStoredTransaction(network: NetworkId, hash: string): { status: TransactionStatus | null; zkappAddress: string | null } | null {
  const row = db
    .prepare(
      `
      select
        case
          when creation_tx_hash = ? then creation_tx_status
          when join_tx_hash = ? then join_tx_status
          when settlement_tx_hash = ? then settlement_tx_status
          when refund_tx_hash = ? then refund_tx_status
        end as status,
        zkapp_address as zkappAddress
      from games
      where network = ?
        and ? in (creation_tx_hash, join_tx_hash, settlement_tx_hash, refund_tx_hash)
      limit 1
    `
    )
    .get(hash, hash, hash, hash, network, hash) as
    | { status: TransactionStatus | null; zkappAddress: string | null }
    | undefined;
  return row ?? null;
}

export function getGameByTransaction(network: NetworkId, hash: string): Game | null {
  const row = db
    .prepare(
      `
      select *
      from games
      where network = ?
        and ? in (creation_tx_hash, join_tx_hash, settlement_tx_hash, refund_tx_hash)
      limit 1
    `
    )
    .get(network, hash) as GameRow | undefined;
  return row ? gameFromRow(row) : null;
}

export function updateStoredTransactionStatus(network: NetworkId, hash: string, status: TransactionStatus) {
  const now = new Date().toISOString();
  db.prepare(
    `
    update games
    set creation_tx_status = case when creation_tx_hash = ? then ? else creation_tx_status end,
        join_tx_status = case when join_tx_hash = ? then ? else join_tx_status end,
        settlement_tx_status = case when settlement_tx_hash = ? then ? else settlement_tx_status end,
        refund_tx_status = case when refund_tx_hash = ? then ? else refund_tx_status end,
        updated_at = ?
    where network = ?
      and ? in (creation_tx_hash, join_tx_hash, settlement_tx_hash, refund_tx_hash)
  `
  ).run(hash, status, hash, status, hash, status, hash, status, now, network, hash);
}

function revealedStatus(creatorReveal: string | null, joinerReveal: string | null): GameStatus {
  if (creatorReveal && joinerReveal) return "both_revealed";
  if (creatorReveal) return "player_one_revealed";
  if (joinerReveal) return "player_two_revealed";
  return "joined";
}

export function markTransactionFailed(network: NetworkId, hash: string, reason?: string): Game | null {
  const game = getGameByTransaction(network, hash);
  if (!game) return null;

  const now = new Date().toISOString();
  if (hash === game.creationTxHash) {
    db.prepare(
      `
      update games
      set creation_tx_status = 'FAILED',
          status = case when join_tx_hash is null then 'failed' else status end,
          failure_reason = ?,
          failed_at = case when join_tx_hash is null then ? else failed_at end,
          updated_at = ?
      where id = ?
    `
    ).run(reason ?? null, now, now, game.id);
    return getGame(game.id);
  }

  if (hash === game.joinTxHash) {
    db.prepare(
      `
      update games
      set joiner_pseudo = null,
          joiner_public_key = null,
          joiner_pseudo_hash = null,
          joiner_commitment = null,
          join_at = null,
          pending_join_refund_deadline_slot = null,
          join_tx_status = 'FAILED',
          failure_reason = ?,
          status = 'created',
          updated_at = ?
      where id = ?
    `
    ).run(reason ?? null, now, game.id);
    return getGame(game.id);
  }

  if (hash === game.settlementTxHash) {
    db.prepare(
      `
      update games
      set creator_die = null,
          joiner_die = null,
          winner_public_key = null,
          settled_at = null,
          settlement_tx_status = 'FAILED',
          failure_reason = ?,
          status = ?,
          updated_at = ?
      where id = ?
    `
    ).run(reason ?? null, revealedStatus(game.creatorReveal, game.joinerReveal), now, game.id);
    return getGame(game.id);
  }

  if (hash === game.refundTxHash) {
    const nextStatus =
      game.joinerPublicKey === null ? "created" : revealedStatus(game.creatorReveal, game.joinerReveal);
    db.prepare(
      `
      update games
      set refund_tx_status = 'FAILED',
          failure_reason = ?,
          refunded_at = null,
          status = ?,
          updated_at = ?
      where id = ?
    `
    ).run(reason ?? null, nextStatus, now, game.id);
    return getGame(game.id);
  }

  return getGame(game.id);
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
          join_tx_status = 'PENDING',
          join_at = ?,
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
      now,
      id
    );

  if (result.changes !== 1) {
    throw new Error("Game is not open");
  }

  return getGame(id)!;
}

export function reconcileJoinTx(id: string, joinTxHash: string): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set join_tx_hash = ?,
          join_tx_status = 'PENDING',
          updated_at = ?
      where id = ?
        and status = 'join_pending'
        and (join_tx_hash like 'pending:%' or join_tx_status in ('PENDING', 'FAILED'))
    `
    )
    .run(joinTxHash, now, id);

  if (result.changes !== 1) {
    throw new Error("Join transaction cannot be reconciled");
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
          join_tx_status = 'INCLUDED',
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
          join_tx_status = 'FAILED',
          join_at = null,
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

export function prepareSettlementTx(id: string, settlementTxHash: string): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set settlement_tx_hash = ?,
          settlement_tx_status = 'PENDING',
          updated_at = ?
      where id = ?
        and creator_reveal is not null
        and joiner_reveal is not null
        and status in ('joined', 'player_one_revealed', 'player_two_revealed', 'both_revealed')
        and (settlement_tx_hash is null or settlement_tx_hash like 'pending:%' or settlement_tx_status = 'FAILED')
    `
    )
    .run(settlementTxHash, now, id);

  if (result.changes !== 1) {
    throw new Error("Settlement transaction cannot be prepared");
  }

  return getGame(id)!;
}

export function clearPendingSettlementTx(id: string, reason?: string): Game {
  const game = getGame(id);
  if (!game) throw new Error("Game not found");
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set creator_die = null,
          joiner_die = null,
          winner_public_key = null,
          settled_at = null,
          settlement_tx_hash = null,
          settlement_tx_status = 'FAILED',
          failure_reason = ?,
          status = ?,
          updated_at = ?
      where id = ?
        and settlement_tx_hash is not null
        and coalesce(settlement_tx_status, 'PENDING') != 'INCLUDED'
    `
    )
    .run(reason ?? null, revealedStatus(game.creatorReveal, game.joinerReveal), now, id);

  if (result.changes !== 1) {
    throw new Error("Pending settlement transaction cannot be cleared");
  }

  return getGame(id)!;
}

export function prepareRefundTx(id: string, refundTxHash: string): Game {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set refund_tx_hash = ?,
          refund_tx_status = 'PENDING',
          updated_at = ?
      where id = ?
        and status in ('created', 'joined', 'player_one_revealed', 'player_two_revealed', 'both_revealed')
        and (refund_tx_hash is null or refund_tx_hash like 'pending:%' or refund_tx_status = 'FAILED')
    `
    )
    .run(refundTxHash, now, id);

  if (result.changes !== 1) {
    throw new Error("Refund transaction cannot be prepared");
  }

  return getGame(id)!;
}

export function clearPendingRefundTx(id: string, reason?: string): Game {
  const game = getGame(id);
  if (!game) throw new Error("Game not found");
  const nextStatus =
    game.joinerPublicKey === null ? "created" : revealedStatus(game.creatorReveal, game.joinerReveal);
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      update games
      set refund_tx_hash = null,
          refund_tx_status = 'FAILED',
          failure_reason = ?,
          refunded_at = null,
          status = ?,
          updated_at = ?
      where id = ?
        and refund_tx_hash is not null
        and coalesce(refund_tx_status, 'PENDING') != 'INCLUDED'
    `
    )
    .run(reason ?? null, nextStatus, now, id);

  if (result.changes !== 1) {
    throw new Error("Pending refund transaction cannot be cleared");
  }

  return getGame(id)!;
}

export function refundGame(id: string, input: { refundTxHash: string }): Game {
  const now = new Date().toISOString();
  const refundTxStatus: TransactionStatus =
    input.refundTxHash.startsWith("fake") || input.refundTxHash.startsWith("refund_") ? "INCLUDED" : "PENDING";
  const result = db
    .prepare(
      `
      update games
      set refund_tx_hash = ?,
          refund_tx_status = ?,
          refunded_at = ?,
          status = 'refunded',
          updated_at = ?
      where id = ?
        and status in ('created', 'joined', 'player_one_revealed', 'player_two_revealed', 'both_revealed')
        and (refund_tx_hash is null or refund_tx_hash like 'pending:%' or refund_tx_status = 'FAILED')
    `
    )
    .run(input.refundTxHash, refundTxStatus, now, now, id);

  if (result.changes !== 1) {
    throw new Error("Game cannot be refunded");
  }

  return getGame(id)!;
}

export function revealSecret(id: string, publicKey: string, secret: string): Game {
  const game = getGame(id);
  if (!game) throw new Error("Game not found");
  if (
    game.status !== "joined" &&
    game.status !== "player_one_revealed" &&
    game.status !== "player_two_revealed" &&
    game.status !== "both_revealed"
  ) {
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
      ? "both_revealed"
      : isJoiner && game.creatorReveal
        ? "both_revealed"
        : isCreator
          ? "player_one_revealed"
          : "player_two_revealed";

  db.prepare(
    `
    update games
    set creator_reveal = coalesce(?, creator_reveal),
        joiner_reveal = coalesce(?, joiner_reveal),
        creator_reveal_at = case when ? is not null and creator_reveal_at is null then ? else creator_reveal_at end,
        joiner_reveal_at = case when ? is not null and joiner_reveal_at is null then ? else joiner_reveal_at end,
        status = ?,
        updated_at = ?
    where id = ?
  `
  ).run(
    isCreator ? secret : null,
    isJoiner ? secret : null,
    isCreator ? secret : null,
    now,
    isJoiner ? secret : null,
    now,
    nextStatus,
    now,
    id
  );

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
  const settlementTxStatus: TransactionStatus =
    input.settlementTxHash.startsWith("fake") || input.settlementTxHash.startsWith("settle_") ? "INCLUDED" : "PENDING";
  const result = db
    .prepare(
      `
      update games
      set creator_die = ?,
          joiner_die = ?,
          winner_public_key = ?,
          settlement_tx_hash = ?,
          settlement_tx_status = ?,
          settled_at = ?,
          status = 'settled',
          updated_at = ?
      where id = ? and creator_reveal is not null and joiner_reveal is not null
        and status in ('joined', 'player_one_revealed', 'player_two_revealed', 'both_revealed')
        and (settlement_tx_hash is null or settlement_tx_hash like 'pending:%' or settlement_tx_status = 'FAILED')
    `
    )
    .run(input.creatorDie, input.joinerDie, input.winnerPublicKey, input.settlementTxHash, settlementTxStatus, now, now, id);

  if (result.changes !== 1) {
    throw new Error("Game cannot be settled");
  }

  return getGame(id)!;
}
