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
  getBackendPreference,
  type VerificationKey
} from "o1js-native";
import { networks, type GameStatus, type NetworkId } from "@zkroll/shared";
import { createNativeMinaNetwork, diceOutcome, NativeZkDiceGame } from "./nativeZkDiceGame.js";

const feeNanoMina = Number(process.env.ZKROLL_PROVER_FEE_NANOMINA ?? process.env.VITE_FEE_NANOMINA ?? 100_000_000);
const maxWorkers = Math.max(1, Number(process.env.ZKROLL_PROVER_WORKERS ?? 2));

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
  refundDeadlineSlot: string;
};

const jobs = new Map<string, ProverJob>();
const queue: ProverJob[] = [];
let running = 0;
let compilePromise: Promise<{ verificationKey: VerificationKey }> | null = null;
let verificationKey: VerificationKey | null = null;

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

function setProgress(job: ProverJob, label: string, progress: number) {
  job.progress = { label, progress };
  job.updatedAt = now();
}

async function setup(job: ProverJob, network: NetworkId) {
  Mina.setActiveInstance(createNativeMinaNetwork(network));
  if (!compilePromise) setProgress(job, "progressCompileCircuit", 12);
  compilePromise ??= NativeZkDiceGame.compile() as Promise<{ verificationKey: VerificationKey }>;
  const compiled = await compilePromise;
  verificationKey = compiled.verificationKey;
  setProgress(job, "progressCircuitReady", 38);
}

function txResult(transactionJson: unknown, memo: string, extra: Record<string, unknown> = {}) {
  return {
    transactionJson: typeof transactionJson === "string" ? transactionJson : JSON.stringify(transactionJson),
    memo,
    ...extra
  };
}

async function proveCreate(job: ProverJob, input: CreateInput) {
  await setup(job, input.network);
  const sender = PublicKey.fromBase58(input.senderPublicKey);
  const zkappKey = PrivateKey.fromBase58(input.zkappPrivateKey);
  const zkappAddress = zkappKey.toPublicKey();
  const contract = new NativeZkDiceGame(zkappAddress);
  if (!verificationKey) throw new Error("Contract verification key is not compiled.");
  const compiledVerificationKey = verificationKey;
  const gameId = Field(input.gameIdField);
  const creatorPseudoHash = pseudoHashValue(input.pseudo);
  const creatorCommitment = Field(serverCommitment(input.secret, input.senderPublicKey, input.gameIdField));

  const memo = compactGameMemo("create", input.gameId);
  const tx = await Mina.transaction({ sender, fee: feeNanoMina, memo }, async () => {
    const accountCreationFee = networks[input.network].accountCreationFeeNanoMina;
    if (accountCreationFee) {
      const funding = AccountUpdate.createSigned(sender);
      funding.balance.subInPlace(UInt64.from(accountCreationFee));
    } else {
      AccountUpdate.fundNewAccount(sender);
    }
    await contract.deploy({ verificationKey: compiledVerificationKey });
    await contract.createGame(
      gameId,
      sender,
      creatorPseudoHash,
      UInt64.from(input.stakeNanoMina),
      creatorCommitment,
      UInt32.from(input.refundDeadlineSlot)
    );
  });

  setProgress(job, "progressGenerateProof", 54);
  await tx.prove();
  tx.sign([zkappKey]);
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

  const memo = compactGameMemo("join", input.gameIdField);
  const tx = await Mina.transaction({ sender, fee: feeNanoMina, memo }, async () => {
    await contract.joinGame(
      sender,
      Field(input.creatorPseudoHash),
      Field(input.creatorCommitment),
      UInt32.from(input.currentRefundDeadlineSlot),
      joinerPseudoHash,
      joinerCommitment,
      UInt32.from(input.nextRefundDeadlineSlot)
    );
  });

  setProgress(job, "progressGenerateProof", 54);
  await tx.prove();
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

  const memo = compactGameMemo("settle", input.gameIdField);
  const tx = await Mina.transaction({ sender, fee: feeNanoMina, memo }, async () => {
    await contract.settle(
      Field(input.creatorPseudoHash),
      Field(input.joinerPseudoHash),
      Field(input.creatorCommitment),
      Field(input.joinerCommitment),
      Field(input.creatorSecret),
      Field(input.joinerSecret),
      winner,
      UInt32.from(input.refundDeadlineSlot)
    );
  });

  const outcome = diceOutcome(Field(input.creatorSecret), Field(input.joinerSecret), Field(input.gameIdField));
  setProgress(job, "progressGenerateProof", 54);
  await tx.prove();
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

  const memo = compactGameMemo("refund", input.gameIdField);
  const tx = await Mina.transaction({ sender, fee: feeNanoMina, memo }, async () => {
    if (input.status === "created") {
      await contract.refundCreatedGame(Field(input.creatorPseudoHash), Field(input.creatorCommitment), UInt32.from(input.refundDeadlineSlot));
      return;
    }
    if (!input.joinerPseudoHash || !input.joinerCommitment) throw new Error("Incomplete joined game refund input.");
    await contract.refundJoinedGame(
      Field(input.creatorPseudoHash),
      Field(input.joinerPseudoHash),
      Field(input.creatorCommitment),
      Field(input.joinerCommitment),
      UInt32.from(input.refundDeadlineSlot)
    );
  });

  setProgress(job, "progressGenerateProof", 54);
  await tx.prove();
  setProgress(job, "progressProofGenerated", 82);
  return txResult(tx.toJSON(), memo);
}

async function proveCancel(job: ProverJob, input: CancelInput) {
  await setup(job, input.network);
  const sender = PublicKey.fromBase58(input.senderPublicKey);
  const contract = new NativeZkDiceGame(PublicKey.fromBase58(input.zkappAddress));

  const memo = compactGameMemo("cancel", input.gameIdField);
  const tx = await Mina.transaction({ sender, fee: feeNanoMina, memo }, async () => {
    await contract.cancelCreatedGame(Field(input.creatorPseudoHash), Field(input.creatorCommitment), UInt32.from(input.refundDeadlineSlot));
  });

  setProgress(job, "progressGenerateProof", 54);
  await tx.prove();
  setProgress(job, "progressProofGenerated", 82);
  return txResult(tx.toJSON(), memo);
}

async function runJob(job: ProverJob) {
  job.status = "running";
  setProgress(job, "progressCompileCircuit", 8);
  try {
    if (job.type === "create") job.result = await proveCreate(job, job.input as CreateInput);
    else if (job.type === "join") job.result = await proveJoin(job, job.input as JoinInput);
    else if (job.type === "settle") job.result = await proveSettle(job, job.input as SettleInput);
    else if (job.type === "refund") job.result = await proveRefund(job, job.input as RefundInput);
    else if (job.type === "cancel") job.result = await proveCancel(job, job.input as CancelInput);
    else throw new Error(`Unsupported prover job type: ${job.type}`);
    job.status = "done";
    setProgress(job, "progressProofGenerated", 100);
  } catch (error) {
    job.status = "failed";
    job.error = (error as Error).message;
    job.updatedAt = now();
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
    o1jsVersion: "2.15.0-rc.0",
    backend: getBackendPreference()
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
