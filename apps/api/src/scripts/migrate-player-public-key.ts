import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const dbPath = process.argv[2] ?? process.env.ZKROLL_DB_PATH ?? "zkroll.db";

if (!existsSync(dbPath)) {
  throw new Error(`Database not found: ${dbPath}`);
}

const db = new Database(dbPath);

type PlayerRow = {
  public_key: string;
  pseudo: string;
  accept_messages: number;
  created_at: string;
};

type GamePlayerRow = {
  public_key: string | null;
  pseudo: string | null;
  created_at: string | null;
};

function tableExists(tableName: string) {
  return Boolean(
    db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(tableName)
  );
}

function tableColumns(tableName: string) {
  const rows = db.prepare(`pragma table_info(${tableName})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function selectExpression(columns: Set<string>, columnName: string, fallback: string) {
  return columns.has(columnName) ? columnName : `${fallback} as ${columnName}`;
}

function assertMigrationScratchTablesAreFree() {
  for (const tableName of [
    "players_old_public_key_migration",
    "games_old_public_key_migration",
    "game_messages_old_public_key_migration",
    "game_notification_subscriptions_old_public_key_migration"
  ]) {
    if (tableExists(tableName)) {
      throw new Error(`Migration scratch table already exists: ${tableName}`);
    }
  }
}

function isAlreadyMigrated() {
  const playersSql = db
    .prepare("select sql from sqlite_master where type = 'table' and name = 'players'")
    .get() as { sql: string } | undefined;
  const gamesSql = db
    .prepare("select sql from sqlite_master where type = 'table' and name = 'games'")
    .get() as { sql: string } | undefined;

  return Boolean(
    playersSql?.sql.includes("public_key text primary key") &&
      gamesSql?.sql.includes("foreign key (creator_public_key) references players(public_key)") &&
      gamesSql?.sql.includes("foreign key (joiner_public_key) references players(public_key)")
  );
}

function createPlayersTable(tableName: string) {
  db.exec(`
    create table ${tableName} (
      public_key text primary key,
      pseudo text not null unique,
      accept_messages integer not null default 1,
      created_at text not null
    );
  `);
}

function createGamesTable(tableName: string) {
  db.exec(`
    create table ${tableName} (
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

    create index ${tableName}_creator_public_key_idx on ${tableName}(creator_public_key);
    create index ${tableName}_joiner_public_key_idx on ${tableName}(joiner_public_key);
  `);
}

function createGameNotificationSubscriptionsTable(tableName: string) {
  db.exec(`
    create table ${tableName} (
      game_id text not null,
      public_key text not null,
      fcm_token text not null,
      created_at text not null,
      updated_at text not null,
      primary key (game_id, public_key, fcm_token),
      foreign key (game_id) references games(id) on delete cascade
    );
  `);
}

function createGameMessagesTable(tableName: string) {
  db.exec(`
    create table ${tableName} (
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
}

function recreateGameDependentTable(tableName: string, createTable: (tableName: string) => void, copySql: string) {
  if (!tableExists(tableName)) return;
  const oldTableName = `${tableName}_old_public_key_migration`;
  if (tableExists(oldTableName)) {
    throw new Error(`Migration scratch table already exists: ${oldTableName}`);
  }

  db.exec(`alter table ${tableName} rename to ${oldTableName};`);
  createTable(tableName);
  db.exec(copySql.replaceAll("__OLD_TABLE__", oldTableName));
  db.exec(`drop table ${oldTableName};`);
}

function repairGameDependentForeignKeys() {
  recreateGameDependentTable(
    "game_notification_subscriptions",
    createGameNotificationSubscriptionsTable,
    `
      insert into game_notification_subscriptions (game_id, public_key, fcm_token, created_at, updated_at)
      select game_id, public_key, fcm_token, created_at, updated_at
      from __OLD_TABLE__
      where exists (select 1 from games where games.id = __OLD_TABLE__.game_id);
    `
  );

  recreateGameDependentTable(
    "game_messages",
    createGameMessagesTable,
    `
      insert into game_messages (id, game_id, sender_public_key, receiver_public_key, body, created_at, read_at)
      select id, game_id, sender_public_key, receiver_public_key, body, created_at, read_at
      from __OLD_TABLE__
      where exists (select 1 from games where games.id = __OLD_TABLE__.game_id);
    `
  );
}

function assertForeignKeysAreValid() {
  const foreignKeyErrors = db.prepare("pragma foreign_key_check").all();
  if (foreignKeyErrors.length > 0) {
    throw new Error(`Foreign key check failed: ${JSON.stringify(foreignKeyErrors)}`);
  }
}

function shortKey(publicKey: string) {
  return publicKey.slice(-8) || "wallet";
}

function uniquePseudo(basePseudo: string | null, publicKey: string, usedPseudos: Set<string>) {
  const trimmed = basePseudo?.trim();
  const base = trimmed || `Player ${shortKey(publicKey)}`;
  let candidate = base;
  let index = 2;
  while (usedPseudos.has(candidate)) {
    candidate = `${base}-${shortKey(publicKey)}`;
    if (usedPseudos.has(candidate)) {
      candidate = `${base}-${shortKey(publicKey)}-${index}`;
      index += 1;
    }
  }
  usedPseudos.add(candidate);
  return candidate;
}

async function main() {
  if (isAlreadyMigrated()) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      repairGameDependentForeignKeys();
    })();
    db.pragma("foreign_keys = ON");
    assertForeignKeysAreValid();
    console.log("Players schema already uses public_key as primary key. Dependent foreign keys are valid.");
    return;
  }

  assertMigrationScratchTablesAreFree();

  const backupPath = `${dbPath}.before-public-key-migration-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.bak`;
  await db.backup(backupPath);
  console.log(`Backup written to ${backupPath}`);

  db.pragma("foreign_keys = OFF");

  db.transaction(() => {
    db.exec(`
      alter table players rename to players_old_public_key_migration;
      alter table games rename to games_old_public_key_migration;
    `);

    createPlayersTable("players");
    createGamesTable("games");

    const usedPseudos = new Set<string>();
    const playersByPublicKey = new Set<string>();

    const oldPlayerColumns = tableColumns("players_old_public_key_migration");
    const oldPlayers = db
      .prepare(
        `
        select
          public_key,
          pseudo,
          ${selectExpression(oldPlayerColumns, "accept_messages", "1")},
          ${selectExpression(oldPlayerColumns, "created_at", "datetime('now')")}
        from players_old_public_key_migration
      `
      )
      .all() as PlayerRow[];

    const insertPlayer = db.prepare(
      "insert into players (public_key, pseudo, accept_messages, created_at) values (?, ?, ?, ?)"
    );

    for (const player of oldPlayers) {
      if (!player.public_key || playersByPublicKey.has(player.public_key)) continue;
      const pseudo = uniquePseudo(player.pseudo, player.public_key, usedPseudos);
      insertPlayer.run(player.public_key, pseudo, player.accept_messages ?? 1, player.created_at);
      playersByPublicKey.add(player.public_key);
    }

    const oldGameColumns = tableColumns("games_old_public_key_migration");
    const gamePlayers = db
      .prepare(
        `
        select
          creator_public_key as public_key,
          creator_pseudo as pseudo,
          ${selectExpression(oldGameColumns, "created_at", "datetime('now')")}
        from games_old_public_key_migration
        union all
        select
          joiner_public_key as public_key,
          joiner_pseudo as pseudo,
          ${selectExpression(oldGameColumns, "join_at", "datetime('now')")}
        from games_old_public_key_migration
        where joiner_public_key is not null
      `
      )
      .all() as GamePlayerRow[];

    for (const player of gamePlayers) {
      if (!player.public_key || playersByPublicKey.has(player.public_key)) continue;
      const pseudo = uniquePseudo(player.pseudo, player.public_key, usedPseudos);
      insertPlayer.run(player.public_key, pseudo, 1, player.created_at ?? new Date().toISOString());
      playersByPublicKey.add(player.public_key);
    }

    const gameColumns = [
      ["id", "null"],
      ["network", "'devnet'"],
      ["zkapp_address", "null"],
      ["game_id_field", "null"],
      ["creator_pseudo", "'Unknown'"],
      ["creator_public_key", "null"],
      ["creator_pseudo_hash", "null"],
      ["joiner_pseudo", "null"],
      ["joiner_public_key", "null"],
      ["joiner_pseudo_hash", "null"],
      ["stake_nano_mina", "'0'"],
      ["payout_mode", "'classic'"],
      ["creator_commitment", "'0'"],
      ["joiner_commitment", "null"],
      ["creator_reveal", "null"],
      ["joiner_reveal", "null"],
      ["creator_die", "null"],
      ["joiner_die", "null"],
      ["winner_public_key", "null"],
      ["status", "'created'"],
      ["refund_timeout_slots", "120"],
      ["refund_deadline_slot", "null"],
      ["pending_join_refund_deadline_slot", "null"],
      ["failure_reason", "null"],
      ["creation_tx_hash", "'pending:migrated' || id"],
      ["join_tx_hash", "null"],
      ["settlement_tx_hash", "null"],
      ["refund_tx_hash", "null"],
      ["creation_tx_status", "'PENDING'"],
      ["join_tx_status", "null"],
      ["settlement_tx_status", "null"],
      ["refund_tx_status", "null"],
      ["created_at", "datetime('now')"],
      ["updated_at", "datetime('now')"],
      ["join_at", "null"],
      ["creator_reveal_at", "null"],
      ["joiner_reveal_at", "null"],
      ["settled_at", "null"],
      ["refunded_at", "null"],
      ["failed_at", "null"],
      ["cancelled_at", "null"]
    ] as const;

    db.exec(`
      insert into games (
        id, network, zkapp_address, game_id_field, creator_pseudo, creator_public_key, creator_pseudo_hash,
        joiner_pseudo, joiner_public_key, joiner_pseudo_hash, stake_nano_mina, payout_mode,
        creator_commitment, joiner_commitment, creator_reveal, joiner_reveal, creator_die, joiner_die,
        winner_public_key, status, refund_timeout_slots, refund_deadline_slot, pending_join_refund_deadline_slot,
        failure_reason, creation_tx_hash, join_tx_hash, settlement_tx_hash, refund_tx_hash, creation_tx_status,
        join_tx_status, settlement_tx_status, refund_tx_status, created_at, updated_at, join_at, creator_reveal_at,
        joiner_reveal_at, settled_at, refunded_at, failed_at, cancelled_at
      )
      select
        ${gameColumns.map(([columnName, fallback]) => selectExpression(oldGameColumns, columnName, fallback)).join(",\n        ")}
      from games_old_public_key_migration;

      drop table players_old_public_key_migration;
      drop table games_old_public_key_migration;
    `);

    repairGameDependentForeignKeys();
  })();

  db.pragma("foreign_keys = ON");
  assertForeignKeysAreValid();

  console.log("Migration complete. players.public_key is now the primary key.");
}

main()
  .catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
