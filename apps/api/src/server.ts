import cors from "@fastify/cors";
import Fastify from "fastify";
import { nanoid } from "nanoid";
import { fetchLastBlock } from "o1js";
import { assertNetworkId, networks, type NetworkId } from "@zkroll/shared";
import {
  createGame,
  confirmJoinGame,
  failPendingJoin,
  getGame,
  getPlayerByPublicKey,
  getPlayerByPseudo,
  joinGame,
  listGames,
  markCreationFailed,
  reconcileCreationTx,
  refundGame,
  revealSecret,
  settleGame,
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
import { backendGamesRootForTransaction, onchainGamesRoot, witnessForGameId } from "./merkle.js";

const app = Fastify({
  logger: true
});

const chainRequestTimeoutMs = Number(process.env.ZKROLL_CHAIN_REQUEST_TIMEOUT_MS ?? 12_000);
const currentSlotCacheMs = Number(process.env.ZKROLL_CURRENT_SLOT_CACHE_MS ?? 15_000);
const currentSlotCache = new Map<NetworkId, { expiresAt: number; currentSlot: string }>();
const currentSlotRequests = new Map<NetworkId, Promise<string>>();

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

async function currentSlotFor(network: NetworkId) {
  const cached = currentSlotCache.get(network);
  if (cached && cached.expiresAt > Date.now()) return cached.currentSlot;

  const running = currentSlotRequests.get(network);
  if (running) return running;

  const request = withTimeout(fetchLastBlock(networks[network].minaEndpoint), chainRequestTimeoutMs, `${network} latest block fetch`)
    .then((latest) => {
      const currentSlot = latest.globalSlotSinceGenesis.toString();
      currentSlotCache.set(network, { expiresAt: Date.now() + currentSlotCacheMs, currentSlot });
      return currentSlot;
    })
    .finally(() => {
      currentSlotRequests.delete(network);
    });
  currentSlotRequests.set(network, request);
  return request;
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

await app.register(cors, {
  origin: process.env.ZKROLL_WEB_ORIGIN ?? true
});

app.get("/health", async () => ({ ok: true }));

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
    if (isLocalTransactionHash(hash)) {
      return {
        hash,
        network: networkId,
        status: "UNKNOWN",
        backendRoot: null,
        chainRoot: null,
        chainRootError: "Local transaction placeholder; no on-chain lookup performed.",
        contractAddress: process.env.ZKROLL_CONTRACT_ADDRESS ?? null
      };
    }

    const backendRoot = backendGamesRootForTransaction(networkId, hash);
    const chain = await onchainGamesRoot(networkId);
    const status = chain.root ? (chain.root === backendRoot ? "INCLUDED" : "PENDING") : "UNKNOWN";
    return {
      hash,
      network: networkId,
      status,
      backendRoot,
      chainRoot: chain.root,
      chainRootError: chain.error,
      contractAddress: process.env.ZKROLL_CONTRACT_ADDRESS ?? null
    };
  } catch (error) {
    const { network, hash } = request.params as { network: string; hash: string };
    return { hash, network, status: "UNKNOWN", error: (error as Error).message };
  }
});

app.get("/networks/:network/current-slot", async (request, reply) => {
  try {
    const { network } = request.params as { network: string };
    const networkId = assertNetworkId(network);
    return {
      network: networkId,
      currentSlot: await currentSlotFor(networkId)
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
    upsertPlayer(creatorPseudo, creatorPublicKey);

    return reply.code(201).send(
      createGame({
        id: optionalString(body, "id") ?? nanoid(12),
        network: requiredNetwork(body),
        zkappAddress: optionalString(body, "zkappAddress"),
        gameIdField: optionalString(body, "gameIdField"),
        creatorPseudo,
        creatorPublicKey,
        creatorPseudoHash: optionalString(body, "creatorPseudoHash"),
        stakeNanoMina: requiredPositiveIntegerString(body, "stakeNanoMina"),
        creatorCommitment: requiredString(body, "creatorCommitment"),
        refundTimeoutSlots: requiredPositiveIntegerNumber(body, "refundTimeoutSlots"),
        refundDeadlineSlot: optionalString(body, "refundDeadlineSlot"),
        creationTxHash: optionalString(body, "creationTxHash")
      })
    );
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/creation-tx", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return reconcileCreationTx(id, requiredString(body, "creationTxHash"));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/creation-failed", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return markCreationFailed(id, optionalString(body, "reason"));
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
    upsertPlayer(joinerPseudo, joinerPublicKey);

    return joinGame(id, {
      joinerPseudo,
      joinerPublicKey,
      joinerPseudoHash: optionalString(body, "joinerPseudoHash"),
      joinerCommitment: requiredString(body, "joinerCommitment"),
      refundDeadlineSlot: optionalString(body, "refundDeadlineSlot"),
      joinTxHash: requiredString(body, "joinTxHash")
    });
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/join-confirmed", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const game = getGame(id);
    if (!game?.joinTxHash) throw new Error("Pending join not found");
    const backendRoot = backendGamesRootForTransaction(game.network, game.joinTxHash);
    const chain = await onchainGamesRoot(game.network);
    if (!chain.root || chain.root !== backendRoot) {
      throw new Error("Join transaction is not included in the contract root yet");
    }
    return confirmJoinGame(id);
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.patch("/games/:id/join-failed", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return failPendingJoin(id, optionalString(body, "reason"));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/reveal", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return revealSecret(id, requiredString(body, "publicKey"), requiredString(body, "secret"));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/settle", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    const winnerPublicKey = body.winnerPublicKey === null ? null : requiredString(body, "winnerPublicKey");

    return settleGame(id, {
      creatorDie: requiredDie(body, "creatorDie"),
      joinerDie: requiredDie(body, "joinerDie"),
      winnerPublicKey,
      settlementTxHash: requiredString(body, "settlementTxHash")
    });
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/games/:id/refund", async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const body = asBody(request.body);
    return refundGame(id, {
      refundTxHash: requiredString(body, "refundTxHash")
    });
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ port, host });
