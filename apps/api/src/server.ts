import cors from "@fastify/cors";
import Fastify from "fastify";
import { nanoid } from "nanoid";
import { fetchAccount, fetchLastBlock } from "o1js";
import { assertNetworkId, assertPayoutMode, networks, type Game, type NetworkId, type TransactionStatus } from "@zkroll/shared";
import {
  applyReferralCode,
  clearPendingRefundTx,
  clearPendingSettlementTx,
  createGame,
  createGameMessage,
  confirmJoinGame,
  failPendingJoin,
  getGameByTransaction,
  getGame,
  getPlayerByPublicKey,
  getPlayerByPseudo,
  getStoredTransaction,
  getStoredTransactionStatus,
  joinGame,
  listGameMessages,
  listGames,
  listNewGameNotificationSubscriptionsForPublicKey,
  listNotificationSubscriptionsForPublicKey,
  listPlayersByPublicKeys,
  listPreviousOpponents,
  markGameMessagesRead,
  markCreationFailed,
  markGameUnrecoverable,
  markTransactionFailed,
  prepareRefundTx,
  prepareSettlementTx,
  reconcileCreationTx,
  reconcileJoinTx,
  refundGame,
  reserveJoinInvitation,
  revealSecret,
  settleGame,
  setPlayerMessagePreference,
  subscribeNewGameNotification,
  subscribeGameNotification,
  unsubscribeNewGameNotification,
  unsubscribeGameNotification,
  unreadMessageCounts,
  updateStoredTransactionStatus,
  upsertPlayer
} from "./db.js";
import {
  asBody,
  optionalStatus,
  optionalString,
  requiredDie,
  requiredNetwork,
  requiredPositiveIntegerNumber,
  requiredPositiveIntegerString,
  requiredString
} from "./validation.js";
import { witnessForGameId } from "./merkle.js";
import { notifyGameInvite, notifyGameMessage, notifyGameUpdated, notifyNewGameCreated } from "./notifications.js";
import {
  clearServerProverCache,
  createProverJob,
  getProverJob,
  serverCommitment,
  serverGameKey,
  serverProverInfo,
  serverPseudoHash,
  usesRemoteServerProver
} from "./serverProverGateway.js";

const app = Fastify({
  logger: true
});

const chainRequestTimeoutMs = Number(process.env.ZKROLL_CHAIN_REQUEST_TIMEOUT_MS ?? 20_000);
const currentSlotCacheMs = Number(process.env.ZKROLL_CURRENT_SLOT_CACHE_MS ?? 15_000);
const zkappStateCacheMs = Number(process.env.ZKROLL_ZKAPP_STATE_CACHE_MS ?? 15_000);
const txScanBlockCount = Number(process.env.ZKROLL_TX_STATUS_SCAN_BLOCKS ?? 50);
const zekoSlotSourceNetwork = process.env.ZKROLL_ZEKO_SLOT_SOURCE_NETWORK === "mainnet" ? "mainnet" : "devnet";
const adminPublicKey = process.env.ZKROLL_ADMIN_PUBLIC_KEY ?? "B62qigDTGHWNjEhRAbdmDSFhv3MqtkDWh6jYNvK81db5S4KXJvgzLCn";
const serverProverModeEnabled = process.env.ZKROLL_PROVER_MODE === "server" || process.env.VITE_PROVER_MODE === "server" || usesRemoteServerProver();
const maxRefundTimeoutSlots = 2400;
const pendingActionGameLimit = 5;
const currentSlotCache = new Map<NetworkId, { expiresAt: number; currentSlot: string }>();
const currentSlotRequests = new Map<NetworkId, Promise<string>>();
const accountBalanceCache = new Map<string, { expiresAt: number; balance: string | null; error: string | null }>();
const accountBalanceRequests = new Map<string, Promise<{ balance: string | null; error: string | null }>>();
const zkappStateCache = new Map<string, { expiresAt: number; result: { status: number | null; error: string | null } }>();
const zkappStateRequests = new Map<string, Promise<{ status: number | null; error: string | null }>>();
const transactionStatusCache = new Map<string, { expiresAt: number; result: { status: TransactionStatus; failureReason: string | null } }>();
const transactionStatusRequests = new Map<string, Promise<{ status: TransactionStatus; failureReason: string | null }>>();

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function currentSlotFor(network: NetworkId, options: { refresh?: boolean } = {}) {
  const sourceNetwork = network === "zeko" ? zekoSlotSourceNetwork : network;
  if (options.refresh) {
    const currentSlot = await minaCurrentSlotFor(sourceNetwork, network);
    currentSlotCache.set(network, { expiresAt: Date.now() + currentSlotCacheMs, currentSlot });
    return currentSlot;
  }

  const cached = currentSlotCache.get(network);
  if (cached && cached.expiresAt > Date.now()) return cached.currentSlot;

  const running = currentSlotRequests.get(network);
  if (running) return running;

  const request = minaCurrentSlotFor(sourceNetwork, network)
    .then((currentSlot) => {
      currentSlotCache.set(network, { expiresAt: Date.now() + currentSlotCacheMs, currentSlot });
      return currentSlot;
    })
    .finally(() => {
      currentSlotRequests.delete(network);
    });
  currentSlotRequests.set(network, request);
  return request;
}

async function minaCurrentSlotFor(sourceNetwork: NetworkId, requestedNetwork: NetworkId = sourceNetwork) {
  const startedAt = Date.now();
  const endpoint = networks[sourceNetwork].minaEndpoint;
  const context = {
    component: "current-slot",
    requestedNetwork,
    sourceNetwork,
    endpoint,
    timeoutMs: chainRequestTimeoutMs
  };
  app.log.info(context, "current-slot external fetch start");
  try {
    const latest = await withTimeout(fetchLastBlock(endpoint), chainRequestTimeoutMs, `${sourceNetwork} latest block fetch`);
    const currentSlot = latest.globalSlotSinceGenesis.toString();
    app.log.info({ ...context, elapsedMs: Date.now() - startedAt, currentSlot }, "current-slot external fetch done");
    return currentSlot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    app.log.warn(
      {
        ...context,
        elapsedMs: Date.now() - startedAt,
        timedOut: message.includes("timed out after"),
        error: message
      },
      "current-slot external fetch failed"
    );
    throw error;
  }
}

function isLocalTransactionHash(hash: string) {
  return (
    hash.startsWith("pending:") ||
    hash.startsWith("fake") ||
    hash.startsWith("create_") ||
    hash.startsWith("join_") ||
    hash.startsWith("settle_") ||
    hash.startsWith("refund_")
  );
}

function gameNeedsPlayerAction(game: Game, publicKey: string) {
  const isCreator = game.creatorPublicKey === publicKey;
  const isJoiner = game.joinerPublicKey === publicKey;
  if (!isCreator && !isJoiner) return false;
  if (
    game.status === "settled" ||
    game.status === "refunded" ||
    game.status === "failed" ||
    game.status === "cancelled" ||
    game.status === "unrecoverable"
  ) {
    return false;
  }

  if (game.status === "pending_signature") return isCreator;
  if (game.settlementTxHash?.startsWith("pending:") || game.refundTxHash?.startsWith("pending:")) return true;
  if (game.status === "created") return isCreator && game.creationTxStatus === "INCLUDED" && !game.joinerPublicKey;
  if (game.status === "join_pending") return game.joinTxStatus !== "INCLUDED" && !game.joinTxHash?.startsWith("pending:invite:");
  if (game.status === "joined" || game.status === "player_one_revealed" || game.status === "player_two_revealed") {
    return (isCreator && !game.creatorReveal) || (isJoiner && !game.joinerReveal);
  }
  if (game.status === "both_revealed") return game.settlementTxStatus !== "INCLUDED";
  return false;
}

function pendingActionGamesForPlayer(publicKey: string, network: NetworkId) {
  return listGames().filter((game) => game.network === network && gameNeedsPlayerAction(game, publicKey));
}

function cacheKey(network: NetworkId, zkappAddress: string) {
  return `${network}:${zkappAddress}`;
}

async function accountBalanceFor(network: NetworkId, publicKey: string) {
  const key = cacheKey(network, publicKey);
  const cached = accountBalanceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const running = accountBalanceRequests.get(key);
  if (running) return running;

  const request = withTimeout(
    fetchAccount({ publicKey }, networks[network].minaEndpoint, { timeout: chainRequestTimeoutMs }),
    chainRequestTimeoutMs,
    `${network} account balance fetch`
  )
    .then((result) => {
      if (result.error || !result.account) {
        return { balance: null, error: result.error?.statusText ?? "account not found" };
      }
      return { balance: result.account.balance.toString(), error: null };
    })
    .catch((error) => ({ balance: null, error: (error as Error).message }))
    .then((result) => {
      accountBalanceCache.set(key, { expiresAt: Date.now() + currentSlotCacheMs, ...result });
      return result;
    })
    .finally(() => {
      accountBalanceRequests.delete(key);
    });
  accountBalanceRequests.set(key, request);
  return request;
}

async function zkappStatusFor(network: NetworkId, zkappAddress: string) {
  const key = cacheKey(network, zkappAddress);
  const cached = zkappStateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const running = zkappStateRequests.get(key);
  if (running) return running;

  const request = withTimeout(
    fetchAccount({ publicKey: zkappAddress }, networks[network].minaEndpoint, { timeout: chainRequestTimeoutMs }),
    chainRequestTimeoutMs,
    `${network} zkapp account fetch`
  )
    .then((result) => {
      if (result.error || !result.account) {
        return { status: null, error: result.error?.statusText ?? "zkApp account not found" };
      }
      const status = result.account.zkapp?.appState?.[1]?.toString();
      return { status: status === undefined ? null : Number(status), error: null };
    })
    .catch((error) => ({ status: null, error: (error as Error).message }))
    .then((result) => {
      zkappStateCache.set(key, { expiresAt: Date.now() + zkappStateCacheMs, result });
      return result;
    })
    .finally(() => {
      zkappStateRequests.delete(key);
    });
  zkappStateRequests.set(key, request);
  return request;
}

type RecentZkappCommand = {
  hash: string;
  failureReason: { failures: string[]; index: string }[] | null;
};

async function chainTransactionStatusFor(network: NetworkId, hash: string) {
  if (network === "zeko") {
    return { status: "UNKNOWN" as TransactionStatus, failureReason: null };
  }

  const key = `${network}:${hash}`;
  const cached = transactionStatusCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const running = transactionStatusRequests.get(key);
  if (running) return running;

  const query = `
    query RecentZkappCommands($count: Int) {
      bestChain(maxLength: $count) {
        transactions {
          zkappCommands {
            hash
            failureReason {
              failures
              index
            }
          }
        }
      }
    }
  `;

  const request = withTimeout(
    fetch(networks[network].minaEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { count: txScanBlockCount } })
    }).then(async (response) => {
      if (!response.ok) throw new Error(`GraphQL ${response.status}`);
      return (await response.json()) as {
        data?: { bestChain?: { transactions?: { zkappCommands?: RecentZkappCommand[] } }[] };
      };
    }),
    chainRequestTimeoutMs,
    `${network} recent zkapp tx scan`
  )
    .then((payload) => {
      const commands = payload.data?.bestChain?.flatMap((block) => block.transactions?.zkappCommands ?? []) ?? [];
      const command = commands.find((item) => item.hash === hash);
      const failureReason = command?.failureReason
        ?.flatMap((item) => item.failures.map((failure) => `${item.index}:${failure}`))
        .join("; ");
      return {
        status: command ? (failureReason ? "FAILED" : "INCLUDED") : "UNKNOWN",
        failureReason: failureReason || null
      } satisfies { status: TransactionStatus; failureReason: string | null };
    })
    .catch(() => ({ status: "UNKNOWN" as TransactionStatus, failureReason: null }))
    .then((result) => {
      transactionStatusCache.set(key, { expiresAt: Date.now() + zkappStateCacheMs, result });
      return result;
    })
    .finally(() => {
      transactionStatusRequests.delete(key);
    });
  transactionStatusRequests.set(key, request);
  return request;
}

function targetStatusForTransaction(game: Game, hash: string): number | null {
  if (hash === game.creationTxHash) return 1;
  if (hash === game.joinTxHash) return 2;
  if (hash === game.settlementTxHash) return 3;
  if (hash === game.refundTxHash) return 4;
  return null;
}

async function syncTransactionFromZkappState(network: NetworkId, hash: string, game: Game) {
  if (!game.zkappAddress) return null;
  const targetStatus = targetStatusForTransaction(game, hash);
  if (targetStatus === null) return null;

  const chain = await zkappStatusFor(network, game.zkappAddress);
  const chainTransactionStatus = await chainTransactionStatusFor(network, hash);
  const included =
    chain.status !== null &&
    (hash === game.settlementTxHash || hash === game.refundTxHash ? chain.status === targetStatus : chain.status >= targetStatus);
  if (chainTransactionStatus.status === "FAILED") {
    const failedGame = markTransactionFailed(network, hash, chainTransactionStatus.failureReason ?? chain.error ?? undefined);
    if (failedGame) await notifyGameUpdated(failedGame);
    return {
      status: "FAILED" as TransactionStatus,
      chainStatus: chain.status,
      chainStatusError: chainTransactionStatus.failureReason ?? chain.error
    };
  }

  if (!included && chain.status === null) {
    if (chainTransactionStatus.status === "INCLUDED") {
      updateStoredTransactionStatus(network, hash, "INCLUDED");
      return {
        status: "INCLUDED" as TransactionStatus,
        chainStatus: chain.status,
        chainStatusError: chain.error
      };
    }

    return {
      status: chainTransactionStatus.status === "UNKNOWN" ? ("UNKNOWN" as TransactionStatus) : ("PENDING" as TransactionStatus),
      chainStatus: chain.status,
      chainStatusError: chain.error
    };
  }

  if (!included && chainTransactionStatus.status === "INCLUDED") {
    const failedGame = markTransactionFailed(
      network,
      hash,
      chain.error ?? "Transaction was included but zkApp state did not reach the expected status"
    );
    if (failedGame) await notifyGameUpdated(failedGame);
    return {
      status: "FAILED" as TransactionStatus,
      chainStatus: chain.status,
      chainStatusError: chain.error ?? "Transaction was included but zkApp state did not reach the expected status"
    };
  }

  if (!included) {
    return {
      status: chainTransactionStatus.status === "UNKNOWN" ? ("UNKNOWN" as TransactionStatus) : ("PENDING" as TransactionStatus),
      chainStatus: chain.status,
      chainStatusError: chain.error
    };
  }

  updateStoredTransactionStatus(network, hash, "INCLUDED");
  if (hash === game.joinTxHash && game.status === "join_pending") {
    await notifyGameUpdated(confirmJoinGame(game.id));
  }

  return {
    status: "INCLUDED" as TransactionStatus,
    chainStatus: chain.status,
    chainStatusError: chain.error
  };
}

async function sendUpdatedGame(game: Game) {
  await notifyGameUpdated(game);
  return game;
}

async function resolveTransactionStatus(network: NetworkId, hash: string) {
  const game = getGameByTransaction(network, hash);
  const storedTransaction = game ? getStoredTransaction(network, hash) : null;

  if (game && storedTransaction?.status !== "INCLUDED" && storedTransaction?.status !== "FAILED" && !isLocalTransactionHash(hash)) {
    const synced = await syncTransactionFromZkappState(network, hash, game);
    if (synced) {
      return {
        hash,
        network,
        status: synced.status,
        backendRoot: null,
        chainRoot: null,
        chainRootError: synced.chainStatusError,
        contractAddress: game.zkappAddress,
        chainStatus: synced.chainStatus,
        source: "zkapp-state"
      };
    }
  }

  if (storedTransaction?.status) {
    return {
      hash,
      network,
      status: storedTransaction.status,
      backendRoot: null,
      chainRoot: null,
      chainRootError: null,
      contractAddress: storedTransaction.zkappAddress,
      source: "db"
    };
  }

  if (isLocalTransactionHash(hash)) {
    return {
      hash,
      network,
      status: storedTransaction?.status ?? "UNKNOWN",
      backendRoot: null,
      chainRoot: null,
      chainRootError: "Local transaction placeholder; no on-chain lookup performed.",
      contractAddress: storedTransaction?.zkappAddress ?? null,
      source: "db"
    };
  }

  return {
    hash,
    network,
    status: "UNKNOWN" as TransactionStatus,
    backendRoot: null,
    chainRoot: null,
    chainRootError: "Unknown transaction hash; no local game is mapped to this hash.",
    contractAddress: null,
    source: "db"
  };
}

await app.register(cors, {
  origin: process.env.ZKROLL_WEB_ORIGIN ?? true
});

app.get("/health", async () => ({ ok: true }));

app.get("/prover/info", async () => serverProverInfo());

app.post("/admin/prover/cache/clear", async (request, reply) => {
  try {
    const body = asBody(request.body);
    if (!serverProverModeEnabled) {
      throw new Error("Server prover mode is not enabled.");
    }
    if (requiredString(body, "publicKey") !== adminPublicKey) {
      return reply.code(403).send({ error: "Admin access denied" });
    }
    request.log.warn({ adminPublicKey }, "Admin clearing server prover o1js cache");
    return clearServerProverCache();
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/prover/pseudo-hash", async (request, reply) => {
  try {
    const body = asBody(request.body);
    return { pseudoHash: await serverPseudoHash(requiredString(body, "pseudo")) };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/prover/commitment", async (request, reply) => {
  try {
    const body = asBody(request.body);
    return {
      commitment: await serverCommitment(
        requiredString(body, "secret"),
        requiredString(body, "publicKey"),
        requiredString(body, "gameIdField")
      )
    };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/prover/keygen", async () => serverGameKey());

app.post("/prover/jobs", async (request, reply) => {
  try {
    const body = asBody(request.body);
    return reply.code(202).send(await createProverJob(requiredString(body, "type"), body.input ?? {}));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/prover/jobs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const job = await getProverJob(id);
  if (!job) return reply.code(404).send({ error: "Prover job not found" });
  return job;
});

app.post("/players", async (request, reply) => {
  try {
    const body = asBody(request.body);
    return upsertPlayer(requiredString(body, "pseudo"), requiredString(body, "publicKey"));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/players/:pseudo", async (request, reply) => {
  const { pseudo } = request.params as { pseudo: string };
  const player = getPlayerByPseudo(pseudo);
  if (!player) return reply.code(404).send({ error: "Player not found" });
  return player;
});

app.get("/players/by-public-key/:publicKey", async (request, reply) => {
  const { publicKey } = request.params as { publicKey: string };
  const player = getPlayerByPublicKey(publicKey);
  if (!player) return reply.code(404).send({ error: "Player not found" });
  return player;
});

app.post("/players/by-public-keys", async (request, reply) => {
  try {
    const body = asBody(request.body);
    const publicKeys = Array.isArray(body.publicKeys) ? body.publicKeys.map(String) : [];
    return { items: listPlayersByPublicKeys(publicKeys) };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/players/:publicKey/previous-opponents", async (request, reply) => {
  try {
    const { publicKey } = request.params as { publicKey: string };
    return { items: listPreviousOpponents(publicKey) };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/players/:publicKey/message-preference", async (request, reply) => {
  try {
    const { publicKey } = request.params as { publicKey: string };
    const body = asBody(request.body);
    return setPlayerMessagePreference(publicKey, Boolean(body.acceptMessages));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/players/:publicKey/referral", async (request, reply) => {
  try {
    const { publicKey } = request.params as { publicKey: string };
    const body = asBody(request.body);
    return applyReferralCode(publicKey, requiredString(body, "referralCode"));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/notifications/:publicKey", async (request) => {
  const { publicKey } = request.params as { publicKey: string };
  return {
    items: listNotificationSubscriptionsForPublicKey(publicKey),
    newGameItems: listNewGameNotificationSubscriptionsForPublicKey(publicKey)
  };
});

app.get("/messages/unread/:publicKey", async (request, reply) => {
  try {
    const { publicKey } = request.params as { publicKey: string };
    return { counts: unreadMessageCounts(publicKey) };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/notifications/new-games", async (request, reply) => {
  try {
    const body = asBody(request.body);
    return subscribeNewGameNotification(requiredNetwork(body), requiredString(body, "publicKey"), requiredString(body, "fcmToken"));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.delete("/notifications/new-games", async (request, reply) => {
  try {
    const body = asBody(request.body);
    unsubscribeNewGameNotification(requiredNetwork(body), requiredString(body, "publicKey"), optionalString(body, "fcmToken"));
    return { ok: true };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/notifications", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return subscribeGameNotification(id, requiredString(body, "publicKey"), requiredString(body, "fcmToken"));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.delete("/games/:id/notifications", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    unsubscribeGameNotification(id, requiredString(body, "publicKey"), optionalString(body, "fcmToken"));
    return { ok: true };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/games", async (request, reply) => {
  try {
    const { status } = request.query as { status?: string };
    return listGames(optionalStatus(status));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/merkle/witness/:network/:gameIdField", async (request, reply) => {
  try {
    const { network, gameIdField } = request.params as { network: string; gameIdField: string };
    return witnessForGameId(assertNetworkId(network), gameIdField);
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/transactions/:network/:hash/status", async (request, reply) => {
  try {
    const { network, hash } = request.params as { network: string; hash: string };
    const networkId = assertNetworkId(network);
    return resolveTransactionStatus(networkId, hash);
  } catch (error) {
    const { network, hash } = request.params as { network: string; hash: string };
    return { hash, network, status: "UNKNOWN", error: (error as Error).message };
  }
});

app.post("/transactions/statuses", async (request, reply) => {
  try {
    const body = asBody(request.body);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items = rawItems.map((item) => {
      const value = item as { network?: string; hash?: string };
      return {
        network: assertNetworkId(requiredString(value, "network")),
        hash: requiredString(value, "hash")
      };
    });
    return {
      items: await Promise.all(items.map((item) => resolveTransactionStatus(item.network, item.hash)))
    };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/transactions/:network/:hash/status", async (request, reply) => {
  try {
    const { network, hash } = request.params as { network: string; hash: string };
    const networkId = assertNetworkId(network);
    const body = asBody(request.body);
    const status = requiredString(body, "status");
    if (status !== "INCLUDED") {
      throw new Error("Only manual INCLUDED confirmation is supported");
    }

    updateStoredTransactionStatus(networkId, hash, status);
    return resolveTransactionStatus(networkId, hash);
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/networks/:network/current-slot", async (request, reply) => {
  try {
    const { network } = request.params as { network: string };
    const query = request.query as { refresh?: string };
    const networkId = assertNetworkId(network);
    return {
      network: networkId,
      currentSlot: await currentSlotFor(networkId, { refresh: query.refresh === "1" || query.refresh === "true" })
    };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/networks/:network/accounts/:publicKey/balance", async (request, reply) => {
  try {
    const { network, publicKey } = request.params as { network: string; publicKey: string };
    const networkId = assertNetworkId(network);
    const result = await accountBalanceFor(networkId, publicKey);
    return {
      network: networkId,
      publicKey,
      balanceNanoMina: result.balance,
      error: result.error
    };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/games/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const game = getGame(id);
  if (!game) return reply.code(404).send({ error: "Game not found" });
  return game;
});

app.post("/games", async (request, reply) => {
  try {
    const body = asBody(request.body);
    const creatorPseudo = requiredString(body, "creatorPseudo");
    const creatorPublicKey = requiredString(body, "creatorPublicKey");
    const network = requiredNetwork(body);
    const refundTimeoutSlots = requiredPositiveIntegerNumber(body, "refundTimeoutSlots");
    if (refundTimeoutSlots > maxRefundTimeoutSlots) {
      throw new Error(`Refund timeout must be at most ${maxRefundTimeoutSlots} slots`);
    }
    const pendingActionGames = pendingActionGamesForPlayer(creatorPublicKey, network);
    if (pendingActionGames.length >= pendingActionGameLimit) {
      throw new Error(
        `Player already has ${pendingActionGames.length} games waiting for an action on this network; unlock them before creating a new game`
      );
    }
    upsertPlayer(creatorPseudo, creatorPublicKey);

    const game = createGame({
        id: optionalString(body, "id") ?? nanoid(12),
        network,
        zkappAddress: optionalString(body, "zkappAddress"),
        gameIdField: optionalString(body, "gameIdField"),
        creatorPseudo,
        creatorPublicKey,
        creatorPseudoHash: optionalString(body, "creatorPseudoHash"),
        stakeNanoMina: requiredPositiveIntegerString(body, "stakeNanoMina"),
        payoutMode: assertPayoutMode(body.payoutMode),
        creatorCommitment: requiredString(body, "creatorCommitment"),
        refundTimeoutSlots,
        refundDeadlineSlot: optionalString(body, "refundDeadlineSlot"),
        creationTxHash: optionalString(body, "creationTxHash")
      });
    const updatedGame = await sendUpdatedGame(game);
    if (updatedGame.status === "created") await notifyNewGameCreated(updatedGame);
    return reply.code(201).send(updatedGame);
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/games/:id/messages", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const query = request.query as { publicKey?: string };
    return { items: listGameMessages(id, requiredString(query, "publicKey")) };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/messages/read", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    markGameMessagesRead(id, requiredString(body, "publicKey"));
    return { ok: true };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/messages", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    const result = createGameMessage({
      id: nanoid(12),
      gameId: id,
      senderPublicKey: requiredString(body, "senderPublicKey"),
      body: requiredString(body, "body")
    });
    await notifyGameMessage(result.game, result.message);
    return reply.code(201).send(result.message);
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/invite", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    const inviterPublicKey = requiredString(body, "inviterPublicKey");
    const inviteePublicKey = requiredString(body, "inviteePublicKey");
    const game = getGame(id);
    if (!game) throw new Error("Game not found");
    if (game.creatorPublicKey !== inviterPublicKey) throw new Error("Only the creator can invite a player");
    if (game.joinerPublicKey) throw new Error("Game already has an opponent");
    const allowed = listPreviousOpponents(inviterPublicKey).some((player) => player.publicKey === inviteePublicKey);
    if (!allowed) throw new Error("Invitee is not a previous opponent");
    const invitee = getPlayerByPublicKey(inviteePublicKey);
    if (!invitee) throw new Error("Invitee not found");
    const reserved = await sendUpdatedGame(reserveJoinInvitation(id, invitee));
    await notifyGameInvite(reserved, inviteePublicKey);
    return reserved;
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/creation-tx", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    const game = await sendUpdatedGame(reconcileCreationTx(id, requiredString(body, "creationTxHash")));
    await notifyNewGameCreated(game);
    return game;
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/creation-failed", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return sendUpdatedGame(markCreationFailed(id, optionalString(body, "reason")));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/unrecoverable", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    if (requiredString(body, "publicKey") !== adminPublicKey) {
      return reply.code(403).send({ error: "Admin access denied" });
    }
    return sendUpdatedGame(markGameUnrecoverable(id, optionalString(body, "reason")));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/join", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    const joinerPseudo = requiredString(body, "joinerPseudo");
    const joinerPublicKey = requiredString(body, "joinerPublicKey");
    const joinerPseudoHash = optionalString(body, "joinerPseudoHash");
    const joinerCommitment = requiredString(body, "joinerCommitment");
    const refundDeadlineSlot = optionalString(body, "refundDeadlineSlot");
    const joinTxHash = requiredString(body, "joinTxHash");
    upsertPlayer(joinerPseudo, joinerPublicKey);

    request.log.info(
      {
        gameId: id,
        joinerPublicKey,
        joinerPseudoHash,
        joinerCommitment,
        refundDeadlineSlot,
        joinTxHash
      },
      "Join recovery material"
    );

    return sendUpdatedGame(joinGame(id, {
      joinerPseudo,
      joinerPublicKey,
      joinerPseudoHash,
      joinerCommitment,
      refundDeadlineSlot,
      joinTxHash
    }));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/join-tx", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    const game = await sendUpdatedGame(reconcileJoinTx(id, requiredString(body, "joinTxHash")));
    await notifyGameUpdated(game);
    return game;
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/join-confirmed", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const game = getGame(id);
    if (!game?.joinTxHash) throw new Error("Pending join not found");
    if (getStoredTransactionStatus(game.network, game.joinTxHash) !== "INCLUDED") {
      throw new Error("Join transaction must be marked as included before confirmation");
    }
    return sendUpdatedGame(confirmJoinGame(id));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/join-failed", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return sendUpdatedGame(failPendingJoin(id, optionalString(body, "reason")));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/reveal", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    const game = getGame(id);
    if (game?.status === "join_pending" && game.joinTxHash) {
      await resolveTransactionStatus(game.network, game.joinTxHash);
    }
    return sendUpdatedGame(revealSecret(id, requiredString(body, "publicKey"), requiredString(body, "secret")));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/settle", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    const winnerPublicKey = body.winnerPublicKey === null ? null : requiredString(body, "winnerPublicKey");

    return sendUpdatedGame(settleGame(id, {
      creatorDie: requiredDie(body, "creatorDie"),
      joinerDie: requiredDie(body, "joinerDie"),
      winnerPublicKey,
      settlementTxHash: requiredString(body, "settlementTxHash")
    }));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/settlement-pending", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return sendUpdatedGame(prepareSettlementTx(id, requiredString(body, "settlementTxHash")));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/settlement-pending/clear", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return sendUpdatedGame(clearPendingSettlementTx(id, optionalString(body, "reason")));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/refund", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return sendUpdatedGame(refundGame(id, {
      refundTxHash: requiredString(body, "refundTxHash")
    }));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/refund-pending", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return sendUpdatedGame(prepareRefundTx(id, requiredString(body, "refundTxHash")));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/refund-pending/clear", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return sendUpdatedGame(clearPendingRefundTx(id, optionalString(body, "reason")));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ port, host });
