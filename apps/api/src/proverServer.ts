import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  autoRefundPublicKey,
  clearServerProverCache,
  createAutoRefundJob,
  createProverJob,
  getProverJob,
  serverCommitment,
  serverGameKey,
  serverProverInfo,
  serverPseudoHash
} from "./serverProver.js";
import { asBody, requiredString } from "./validation.js";

const app = Fastify({
  logger: true
});
const restartOnCacheClear = process.env.ZKROLL_PROVER_RESTART_ON_CACHE_CLEAR !== "false";
const autoRefundFeePayerPrivateKey = process.env.ZKROLL_AUTO_REFUND_FEE_PAYER_PRIVATE_KEY ?? "";

await app.register(cors, {
  origin: false
});

app.get("/health", async () => ({ ok: true, service: "prover" }));

app.get("/internal/prover/info", async () => ({ ...serverProverInfo(), isolated: true }));

app.post("/internal/prover/cache/clear", async (request, reply) => {
  try {
    request.log.warn("Clearing isolated server prover o1js cache");
    const result = await clearServerProverCache();
    if (restartOnCacheClear) {
      request.log.warn("Restarting isolated server prover process after cache clear");
      setTimeout(() => process.exit(0), 250);
    }
    return {
      ...result,
      processRestartScheduled: restartOnCacheClear
    };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/internal/prover/pseudo-hash", async (request, reply) => {
  try {
    const body = asBody(request.body);
    return { pseudoHash: serverPseudoHash(requiredString(body, "pseudo")) };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/internal/prover/commitment", async (request, reply) => {
  try {
    const body = asBody(request.body);
    return {
      commitment: serverCommitment(
        requiredString(body, "secret"),
        requiredString(body, "publicKey"),
        requiredString(body, "gameIdField")
      )
    };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/internal/prover/keygen", async () => serverGameKey());

app.get("/internal/prover/auto-refund/public-key", async (request, reply) => {
  try {
    if (!autoRefundFeePayerPrivateKey) throw new Error("Automatic refund fee payer key is not configured in the prover process.");
    return { publicKey: autoRefundPublicKey(autoRefundFeePayerPrivateKey) };
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/internal/prover/auto-refund", async (request, reply) => {
  try {
    if (!autoRefundFeePayerPrivateKey) throw new Error("Automatic refund fee payer key is not configured in the prover process.");
    const body = asBody(request.body);
    return await createAutoRefundJob((body.input ?? {}) as never, autoRefundFeePayerPrivateKey);
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.post("/internal/prover/jobs", async (request, reply) => {
  try {
    const body = asBody(request.body);
    return reply.code(202).send(createProverJob(requiredString(body, "type"), body.input ?? {}));
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }
});

app.get("/internal/prover/jobs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const job = getProverJob(id);
  if (!job) return reply.code(404).send({ error: "Prover job not found" });
  return job;
});

const port = Number(process.env.PORT ?? process.env.ZKROLL_PROVER_PORT ?? 4001);
const host = process.env.HOST ?? "0.0.0.0";

await app.listen({ port, host });
