import {
  AccountUpdate,
  Encoding,
  Field,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
  fetchAccount,
  getBackendPreference,
  type VerificationKey
} from "o1js-native";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { networks, type GameStatus, type NetworkId, type PayoutMode } from "@zkroll/shared";
import { createNativeMinaNetwork, diceOutcome, NativeZkDiceGame } from "./nativeZkDiceGame.js";

const require = createRequire(import.meta.url);
const cacheDir = require("cachedir") as (name: string) => string;
const feeNanoMina = Number(process.env.ZKROLL_PROVER_FEE_NANOMINA ?? process.env.VITE_FEE_NANOMINA ?? 100_000_000);
const requestedWorkers = Math.max(1, Number(process.env.ZKROLL_PROVER_WORKERS ?? 1));
const maxWorkers = 1;
const proverDebug = process.env.ZKROLL_PROVER_DEBUG === "true" || process.env.ZKROLL_PROVER_DEBUG === "1";
const minaAccountCreationFeeNanoMina = "1000000000";

type Progress = {
  label: string;
  progress: number;
};

type ProverJobStatus = "queued" | "running" | "done" | "failed";

type ProverJob = {
  id: string;
  type: string;
  status: ProverJobStatus;
  progress: Progress;
  input: unknown;
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateInput = {
  network: NetworkId;
  senderPublicKey: string;
  zkappPrivateKey: string;
  gameId: string;
  pseudo: string;
  secret: string;
  gameIdField: string;
  stakeNanoMina: string;
  payoutMode: PayoutMode;
  refundDeadlineSlot: string;
};

type JoinInput = {
  network: NetworkId;
  senderPublicKey: string;
  pseudo: string;
  secret: string;
  gameIdField: string;
  zkappAddress: string;
  creatorPseudoHash: string;
  creatorCommitment: string;
  payoutMode: PayoutMode;
  currentRefundDeadlineSlot: string;
  nextRefundDeadlineSlot: string;
};

type SettleInput = {
  network: NetworkId;
  senderPublicKey: string;
  gameIdField: string;
  zkappAddress: string;
  creatorPublicKey: string;
  creatorPseudoHash: string;
  joinerPublicKey: string;
  joinerPseudoHash: string;
  payoutMode: PayoutMode;
  creatorCommitment: string;
  joinerCommitment: string;
  creatorSecret: string;
  joinerSecret: string;
  winnerPublicKey: string | null;
  refundDeadlineSlot: string;
};

type RefundInput = {
  network: NetworkId;
  senderPublicKey: string;
  status: GameStatus;
  gameIdField: string;
  zkappAddress: string;
  creatorPseudoHash: string;
  joinerPseudoHash: string | null;
  payoutMode: PayoutMode;
  creatorCommitment: string;
  joinerCommitment: string | null;
  refundDeadlineSlot: string;
};

type CancelInput = {
  network: NetworkId;
  senderPublicKey: string;
  gameIdField: string;
  zkappAddress: string;
  creatorPseudoHash: string;
  creatorCommitment: string;
  payoutMode: PayoutMode;
  refundDeadlineSlot: string;
};

const jobs = new Map<string, ProverJob>();
const queue: ProverJob[] = [];
let running = 0;
const compilePromises = new Map<NetworkId, Promise<{ verificationKey: VerificationKey }>>();
const verificationKeys = new Map<NetworkId, VerificationKey>();

function now() {
  return new Date().toISOString();
}

function pseudoHashValue(pseudo: string) {
  return Poseidon.hash(Encoding.stringToFields(pseudo));
}

export function serverPseudoHash(pseudo: string) {
  return pseudoHashValue(pseudo).toString();
}

export function serverCommitment(secret: string, publicKey: string, gameIdField: string) {
  const player = PublicKey.fromBase58(publicKey);
  return Poseidon.hash([Field(secret), ...player.toFields(), Field(gameIdField)]).toString();
}

export function serverGameKey() {
  const privateKey = PrivateKey.random();
  return {
    privateKey: privateKey.toBase58(),
    address: privateKey.toPublicKey().toBase58()
  };
}

function compactGameMemo(action: string, gameId?: string) {
  const suffix = gameId ? ` ${gameId.slice(0, 12)}` : "";
  return `zkroll ${action}${suffix}`.slice(0, 32);
}

function payoutModeField(mode: PayoutMode | undefined) {
  return Field(mode === "opponent_takes_all" ? 1 : 0);
}

function accountCreationFeeFor(network: NetworkId) {
  return networks[network].accountCreationFeeNanoMina ?? minaAccountCreationFeeNanoMina;
}

function setProgress(job: ProverJob, label: string, progress: number) {
  job.progress = { label, progress };
  job.updatedAt = now();
}

function redactInput(type: string, input: unknown) {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const keysByType: Record<string, string[]> = {
    create: ["network", "senderPublicKey", "gameId", "gameIdField", "stakeNanoMina", "payoutMode", "refundDeadlineSlot"],
    join: [
      "network",
      "senderPublicKey",
      "gameIdField",
      "zkappAddress",
      "creatorPseudoHash",
      "creatorCommitment",
      "payoutMode",
      "currentRefundDeadlineSlot",
      "nextRefundDeadlineSlot"
    ],
    settle: [
      "network",
      "senderPublicKey",
      "gameIdField",
      "zkappAddress",
      "creatorPublicKey",
      "creatorPseudoHash",
      "joinerPublicKey",
      "joinerPseudoHash",
      "payoutMode",
      "creatorCommitment",
      "joinerCommitment",
      "winnerPublicKey",
      "refundDeadlineSlot"
    ],
    refund: [
      "network",
      "senderPublicKey",
      "status",
      "gameIdField",
      "zkappAddress",
      "creatorPseudoHash",
      "joinerPseudoHash",
      "payoutMode",
      "creatorCommitment",
      "joinerCommitment",
      "refundDeadlineSlot"
    ],
    cancel: ["network", "senderPublicKey", "gameIdField", "zkappAddress", "creatorPseudoHash", "creatorCommitment", "payoutMode", "refundDeadlineSlot"]
  };
  return Object.fromEntries((keysByType[type] ?? ["network", "senderPublicKey", "gameIdField", "zkappAddress"]).map((key) => [key, value[key] ?? null]));
}

function debugLog(message: string, data: Record<string, unknown> = {}) {
  if (!proverDebug) return;
  console.log(JSON.stringify({ level: "debug", component: "server-prover", message, at: now(), ...data }));
}

function shouldRetryCompile(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /internal error/i.test(message);
}

async function compileContract(job: ProverJob, network: NetworkId) {
  setProgress(job, "progressCompileCircuit", 12);
  debugLog("compile:start", { jobId: job.id, jobType: job.type, network });
  try {
    return (await NativeZkDiceGame.compile()) as { verificationKey: VerificationKey };
  } catch (error) {
    debugLog("compile:failed", { jobId: job.id, jobType: job.type, network, error: (error as Error).message });
    if (!shouldRetryCompile(error)) throw error;
    debugLog("compile:retry", { jobId: job.id, jobType: job.type, network });
    return (await NativeZkDiceGame.compile()) as { verificationKey: VerificationKey };
  }
}

async function setup(job: ProverJob, network: NetworkId) {
  debugLog("setup:start", {
    jobId: job.id,
    jobType: job.type,
    network,
    backendBefore: getBackendPreference(),
    cachedNetworks: Array.from(compilePromises.keys()),
    hasCompilePromise: compilePromises.has(network),
    hasVerificationKey: verificationKeys.has(network),
    cacheDirectory: cacheDir("o1js")
  });
  Mina.setActiveInstance(createNativeMinaNetwork(network));
  if (!compilePromises.has(network)) {
    compilePromises.set(
      network,
      compileContract(job, network).catch((error) => {
        compilePromises.delete(network);
        verificationKeys.delete(network);
        throw error;
      })
    );
  }
  const compiled = await compilePromises.get(network)!;
  verificationKeys.set(network, compiled.verificationKey);
  debugLog("setup:ready", {
    jobId: job.id,
    jobType: job.type,
    network,
    backendAfter: getBackendPreference(),
    verificationKeyHash: compiled.verificationKey.hash.toString()
  });
  setProgress(job, "progressCircuitReady", 38);
}

function txResult(transactionJson: unknown, memo: string, extra: Record<string, unknown> = {}) {
  return {
    transactionJson: typeof transactionJson === "string" ? transactionJson : JSON.stringify(transactionJson),
    memo,
    ...extra
  };
}

async function buildTransaction(job: ProverJob, network: NetworkId, memo: string, sender: PublicKey, callback: () => Promise<void>) {
  debugLog("transaction:start", { jobId: job.id, jobType: job.type, network, memo, senderPublicKey: sender.toBase58() });
  setProgress(job, "progressGenerateProof", 54);
  const feePayerAccount = await fetchAccount({ publicKey: sender }, networks[network].minaEndpoint);
  if (feePayerAccount.error || !feePayerAccount.account) {
    if (feePayerAccount.error?.statusCode !== 404) {
      throw new Error(
        `Cannot fetch fee payer account ${sender.toBase58()} on ${network}: ${feePayerAccount.error?.statusText ?? "network endpoint unavailable"}.`
      );
    }
    throw new Error(
      `Fee payer account ${sender.toBase58()} was not found on ${network}. Fund this wallet on the selected network before using server proving.`
    );
  }
  const tx = await Mina.transaction({ sender, fee: feeNanoMina, memo }, callback);
  debugLog("transaction:built", { jobId: job.id, jobType: job.type, network, memo });
  return tx;
}

async function proveTransaction(job: ProverJob, network: NetworkId, tx: { prove: () => Promise<unknown> }) {
  debugLog("prove:start", { jobId: job.id, jobType: job.type, network });
  setProgress(job, "progressGenerateProof", 54);
  await tx.prove();
  debugLog("prove:done", { jobId: job.id, jobType: job.type, network });
}

async function proveCreate(job: ProverJob, input: CreateInput) {
  await setup(job, input.network);
  const sender = PublicKey.fromBase58(input.senderPublicKey);
  const zkappKey = PrivateKey.fromBase58(input.zkappPrivateKey);
  const zkappAddress = zkappKey.toPublicKey();
  const contract = new NativeZkDiceGame(zkappAddress);
  const compiledVerificationKey = verificationKeys.get(input.network);
  if (!compiledVerificationKey) throw new Error("Contract verification key is not compiled.");
  const gameId = Field(input.gameIdField);
  const creatorPseudoHash = pseudoHashValue(input.pseudo);
  const creatorCommitment = Field(serverCommitment(input.secret, input.senderPublicKey, input.gameIdField));
  const payoutMode = payoutModeField(input.payoutMode);

  const memo = compactGameMemo("create", input.gameId);
  const tx = await buildTransaction(job, input.network, memo, sender, async () => {
    const funding = AccountUpdate.createSigned(sender);
    funding.balance.subInPlace(UInt64.from(accountCreationFeeFor(input.network)));
    await contract.deploy({ verificationKey: compiledVerificationKey });
    await contract.createGame(
      gameId,
      sender,
      creatorPseudoHash,
      UInt64.from(input.stakeNanoMina),
      creatorCommitment,
      payoutMode,
      UInt32.from(input.refundDeadlineSlot)
    );
  });

  await proveTransaction(job, input.network, tx);
  debugLog("sign:start", { jobId: job.id, jobType: job.type, network: input.network, signer: "zkappKey" });
  tx.sign([zkappKey]);
  debugLog("sign:done", { jobId: job.id, jobType: job.type, network: input.network });
  setProgress(job, "progressProofGenerated", 82);
  return txResult(tx.toJSON(), memo, {
    zkappAddress: zkappAddress.toBase58(),
    creatorPseudoHash: creatorPseudoHash.toString(),
    creatorCommitment: creatorCommitment.toString()
  });
}

async function proveJoin(job: ProverJob, input: JoinInput) {
  await setup(job, input.network);
  const sender = PublicKey.fromBase58(input.senderPublicKey);
  const contract = new NativeZkDiceGame(PublicKey.fromBase58(input.zkappAddress));
  const joinerPseudoHash = pseudoHashValue(input.pseudo);
  const joinerCommitment = Field(serverCommitment(input.secret, input.senderPublicKey, input.gameIdField));
  const payoutMode = payoutModeField(input.payoutMode);

  const memo = compactGameMemo("join", input.gameIdField);
  const tx = await buildTransaction(job, input.network, memo, sender, async () => {
    await contract.joinGame(
      sender,
      Field(input.creatorPseudoHash),
      Field(input.creatorCommitment),
      payoutMode,
      UInt32.from(input.currentRefundDeadlineSlot),
      joinerPseudoHash,
      joinerCommitment,
      UInt32.from(input.nextRefundDeadlineSlot)
    );
  });

  await proveTransaction(job, input.network, tx);
  setProgress(job, "progressProofGenerated", 82);
  return txResult(tx.toJSON(), memo, {
    joinerPseudoHash: joinerPseudoHash.toString(),
    joinerCommitment: joinerCommitment.toString()
  });
}

async function proveSettle(job: ProverJob, input: SettleInput) {
  await setup(job, input.network);
  const sender = PublicKey.fromBase58(input.senderPublicKey);
  const creator = PublicKey.fromBase58(input.creatorPublicKey);
  const joiner = PublicKey.fromBase58(input.joinerPublicKey);
  const contract = new NativeZkDiceGame(PublicKey.fromBase58(input.zkappAddress));
  const winner = input.winnerPublicKey ? PublicKey.fromBase58(input.winnerPublicKey) : (PublicKey.empty() as PublicKey);
  const payoutMode = payoutModeField(input.payoutMode);

  const memo = compactGameMemo("settle", input.gameIdField);
  const tx = await buildTransaction(job, input.network, memo, sender, async () => {
    const commonArgs = [
      Field(input.creatorPseudoHash),
      Field(input.joinerPseudoHash),
      Field(input.creatorCommitment),
      Field(input.joinerCommitment),
      Field(input.creatorSecret),
      Field(input.joinerSecret),
      winner
    ] as const;
    if (input.payoutMode === "opponent_takes_all") {
      if (input.winnerPublicKey === input.joinerPublicKey) {
        await contract.settleOpponentJoinerWins(...commonArgs, UInt32.from(input.refundDeadlineSlot));
        return;
      }
      await contract.settleOpponentCreatorKeeps(...commonArgs, UInt32.from(input.refundDeadlineSlot));
      return;
    }
    await contract.settle(...commonArgs, payoutMode, UInt32.from(input.refundDeadlineSlot));
  });

  const outcome = diceOutcome(Field(input.creatorSecret), Field(input.joinerSecret), Field(input.gameIdField));
  await proveTransaction(job, input.network, tx);
  setProgress(job, "progressProofGenerated", 82);
  return txResult(tx.toJSON(), memo, {
    creatorPublicKey: creator.toBase58(),
    joinerPublicKey: joiner.toBase58(),
    creatorDie: Number(outcome.creatorDie.toString()),
    joinerDie: Number(outcome.joinerDie.toString())
  });
}

async function proveRefund(job: ProverJob, input: RefundInput) {
  await setup(job, input.network);
  const sender = PublicKey.fromBase58(input.senderPublicKey);
  const contract = new NativeZkDiceGame(PublicKey.fromBase58(input.zkappAddress));
  const payoutMode = payoutModeField(input.payoutMode);

  const memo = compactGameMemo("refund", input.gameIdField);
  const tx = await buildTransaction(job, input.network, memo, sender, async () => {
    if (input.status === "created") {
      await contract.refundCreatedGame(
        Field(input.creatorPseudoHash),
        Field(input.creatorCommitment),
        payoutMode,
        UInt32.from(input.refundDeadlineSlot)
      );
      return;
    }
    if (!input.joinerPseudoHash || !input.joinerCommitment) throw new Error("Incomplete joined game refund input.");
    await contract.refundJoinedGame(
      Field(input.creatorPseudoHash),
      Field(input.joinerPseudoHash),
      Field(input.creatorCommitment),
      Field(input.joinerCommitment),
      payoutMode,
      UInt32.from(input.refundDeadlineSlot)
    );
  });

  await proveTransaction(job, input.network, tx);
  setProgress(job, "progressProofGenerated", 82);
  return txResult(tx.toJSON(), memo);
}

async function proveCancel(job: ProverJob, input: CancelInput) {
  await setup(job, input.network);
  const sender = PublicKey.fromBase58(input.senderPublicKey);
  const contract = new NativeZkDiceGame(PublicKey.fromBase58(input.zkappAddress));
  const payoutMode = payoutModeField(input.payoutMode);

  const memo = compactGameMemo("cancel", input.gameIdField);
  const tx = await buildTransaction(job, input.network, memo, sender, async () => {
    await contract.cancelCreatedGame(
      Field(input.creatorPseudoHash),
      Field(input.creatorCommitment),
      payoutMode,
      UInt32.from(input.refundDeadlineSlot)
    );
  });

  await proveTransaction(job, input.network, tx);
  setProgress(job, "progressProofGenerated", 82);
  return txResult(tx.toJSON(), memo);
}

async function runJob(job: ProverJob) {
  job.status = "running";
  setProgress(job, "progressCompileCircuit", 8);
  debugLog("job:start", { jobId: job.id, jobType: job.type, input: redactInput(job.type, job.input) });
  try {
    if (job.type === "create") job.result = await proveCreate(job, job.input as CreateInput);
    else if (job.type === "join") job.result = await proveJoin(job, job.input as JoinInput);
    else if (job.type === "settle") job.result = await proveSettle(job, job.input as SettleInput);
    else if (job.type === "refund") job.result = await proveRefund(job, job.input as RefundInput);
    else if (job.type === "cancel") job.result = await proveCancel(job, job.input as CancelInput);
    else throw new Error(`Unsupported prover job type: ${job.type}`);
    job.status = "done";
    setProgress(job, "progressProofGenerated", 100);
    debugLog("job:done", { jobId: job.id, jobType: job.type, progress: job.progress });
  } catch (error) {
    job.status = "failed";
    const errorMessage = (error as Error).message;
    job.error = errorMessage.includes("Cannot start new transaction within another transaction")
      ? `${errorMessage}. The native o1js transaction context is already open; restart the isolated prover process before retrying.`
      : errorMessage;
    job.updatedAt = now();
    debugLog("job:failed", {
      jobId: job.id,
      jobType: job.type,
      error: job.error,
      stack: (error as Error).stack
    });
  } finally {
    running -= 1;
    runNext();
  }
}

function runNext() {
  while (running < maxWorkers && queue.length > 0) {
    const job = queue.shift()!;
    running += 1;
    void runJob(job);
  }
}

export function createProverJob(type: string, input: unknown) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = now();
  const job: ProverJob = {
    id,
    type,
    status: "queued",
    progress: { label: "progressCompileCircuit", progress: 0 },
    input,
    result: null,
    error: null,
    createdAt,
    updatedAt: createdAt
  };
  jobs.set(id, job);
  queue.push(job);
  debugLog("job:queued", {
    jobId: job.id,
    jobType: job.type,
    queued: queue.length,
    running,
    input: redactInput(job.type, job.input)
  });
  runNext();
  return serializeJob(job);
}

export function getProverJob(id: string) {
  const job = jobs.get(id);
  return job ? serializeJob(job) : null;
}

export function serverProverInfo() {
  return {
    proverMode: "server",
    o1jsVersion: "2.15.0",
    backend: getBackendPreference(),
    cacheDirectory: cacheDir("o1js"),
    requestedWorkers,
    effectiveWorkers: maxWorkers,
    concurrencyModel: "single native o1js job per prover process",
    running,
    queued: queue.length
  };
}

export async function clearServerProverCache() {
  if (running > 0) {
    throw new Error("Cannot clear o1js cache while server prover jobs are running.");
  }

  const droppedQueuedJobs = queue.length;
  for (const job of queue.splice(0)) {
    job.status = "failed";
    job.error = "Server prover cache was cleared by admin before this job started.";
    job.updatedAt = now();
  }

  compilePromises.clear();
  verificationKeys.clear();
  const cacheDirectory = cacheDir("o1js");
  await rm(cacheDirectory, { recursive: true, force: true });

  return {
    ok: true,
    service: "prover",
    cacheDirectory,
    droppedQueuedJobs,
    running,
    queued: queue.length,
    processRestarted: false,
    restartHint: "If native o1js keeps reporting an open transaction context, restart the isolated prover container."
  };
}

function serializeJob(job: ProverJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}
