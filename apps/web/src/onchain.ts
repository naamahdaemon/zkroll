import { networks, type GameStatus, type NetworkId, type PayoutMode } from "@zkroll/shared";
import type { MinaProvider } from "./types";

const FEE_NANOMINA = Number(import.meta.env.VITE_FEE_NANOMINA ?? 100_000_000);
const WALLET_RESPONSE_TIMEOUT_MS = Number(import.meta.env.VITE_WALLET_RESPONSE_TIMEOUT_MS ?? 120_000);
const O1JS_BROWSER_CACHE_ENABLED = import.meta.env.VITE_O1JS_BROWSER_CACHE_ENABLED !== "false";
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";
const PROVER_MODE = import.meta.env.VITE_PROVER_MODE === "server" ? "server" : "client";
const SERVER_PROVER_POLL_MS = Number(import.meta.env.VITE_SERVER_PROVER_POLL_MS ?? 1500);
const SERVER_PROVER_WALLET_DELAY_MS = Number(import.meta.env.VITE_SERVER_PROVER_WALLET_DELAY_MS ?? 2500);
const CLIENT_O1JS_VERSION = "2.15.0";
const SERVER_O1JS_VERSION = "2.15.0";

let compilePromise: Promise<unknown> | null = null;
let compiled = false;
let verificationKey: any = null;

export type OnchainProgress = {
  label: string;
  progress: number;
};

export type ProvingCompatibilityIssueCode =
  | "noWebAssembly"
  | "noWorker"
  | "notCrossOriginIsolated"
  | "noSharedArrayBuffer"
  | "walletWebView"
  | "mobileLimitedMemory";

export type ProvingCompatibilityIssue = {
  code: ProvingCompatibilityIssueCode;
  severity: "error" | "warning";
};

export type ProvingCompatibility = {
  ok: boolean;
  isMobile: boolean;
  isWalletWebView: boolean;
  issues: ProvingCompatibilityIssue[];
};

type ProgressCallback = (progress: OnchainProgress) => void;
type ManualWalletResolution = { kind: "hash"; hash: string } | { kind: "failed"; reason: string };
type ServerProverJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: OnchainProgress;
  result: Record<string, unknown> | null;
  error: string | null;
};

let manualWalletResolution: ((resolution: ManualWalletResolution) => void) | null = null;

export function hasPendingWalletSignature() {
  return Boolean(manualWalletResolution);
}

export function resolvePendingWalletSignatureWithHash(hash: string) {
  manualWalletResolution?.({ kind: "hash", hash });
}

export function rejectPendingWalletSignature(reason: string) {
  manualWalletResolution?.({ kind: "failed", reason });
}

function report(callback: ProgressCallback | undefined, label: string, progress: number) {
  callback?.({ label, progress });
}

export function proverMode() {
  return PROVER_MODE;
}

export function o1jsVersion() {
  return PROVER_MODE === "server" ? SERVER_O1JS_VERSION : CLIENT_O1JS_VERSION;
}

export function usesServerProver() {
  return PROVER_MODE === "server";
}

function userAgent() {
  return navigator.userAgent || "";
}

export function getProvingCompatibility(): ProvingCompatibility {
  const ua = userAgent();
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isWalletWebView = /Auro|Wallet|wv\)|; wv|WebView/i.test(ua);
  const issues: ProvingCompatibilityIssue[] = [];

  if (usesServerProver()) {
    return {
      ok: true,
      isMobile,
      isWalletWebView,
      issues
    };
  }

  if (typeof WebAssembly === "undefined") {
    issues.push({ code: "noWebAssembly", severity: "error" });
  }

  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    issues.push({ code: "noWorker", severity: "error" });
  }

  if (!window.crossOriginIsolated) {
    issues.push({ code: "notCrossOriginIsolated", severity: "error" });
  }

  if (typeof SharedArrayBuffer === "undefined") {
    issues.push({ code: "noSharedArrayBuffer", severity: "error" });
  }

  if (isWalletWebView) {
    issues.push({ code: "walletWebView", severity: window.crossOriginIsolated ? "warning" : "error" });
  }

  if (isMobile && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
    issues.push({ code: "mobileLimitedMemory", severity: "warning" });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    isMobile,
    isWalletWebView,
    issues
  };
}

export function externalBrowserUrl() {
  return window.location.href;
}

function provingCompatibilityError(compatibility: ProvingCompatibility) {
  const codes = compatibility.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code);
  return `Compilation ZK impossible dans ce navigateur (${codes.join(", ")}). Ouvre zkroll dans un navigateur complet compatible COOP/COEP, par exemple Chrome/Safari, ou utilise desktop.`;
}

function assertProvingCompatibility() {
  const compatibility = getProvingCompatibility();
  if (!compatibility.ok) {
    throw new Error(provingCompatibilityError(compatibility));
  }
}

const auroNetworkIds: Record<NetworkId, string> = {
  mainnet: "mina:mainnet",
  devnet: "mina:devnet",
  zeko: "zeko:testnet"
};

function walletNetworkId(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.networkID === "string") return record.networkID;
  if (typeof record.chainId === "string") return record.chainId;
  if (typeof record.name === "string") return record.name;
  return null;
}

function providerErrorMessage(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.code === "number" && typeof record.message === "string") {
    return `${record.message} (${record.code})`;
  }
  return null;
}

export async function ensureWalletNetwork(
  provider: MinaProvider | undefined,
  network: NetworkId,
  onProgress?: ProgressCallback
) {
  if (!provider) throw new Error("Wallet Mina introuvable.");
  const expectedNetworkId = auroNetworkIds[network];

  if (!provider.requestNetwork) {
    throw new Error(`Impossible de verifier le reseau Auro. Selectionne ${expectedNetworkId} dans le wallet.`);
  }

  const current = await provider.requestNetwork();
  if (walletNetworkId(current) === expectedNetworkId) return;

  if (!provider.switchChain) {
    throw new Error(`Auro n'est pas sur ${expectedNetworkId}. Change le reseau dans le wallet puis reessaie.`);
  }

  report(onProgress, "progressSwitchNetwork", 4);
  const switched = await provider.switchChain({ networkID: expectedNetworkId });
  const switchError = providerErrorMessage(switched);
  if (switchError) {
    throw new Error(`Auro n'a pas pu passer sur ${expectedNetworkId}: ${switchError}`);
  }
  if (walletNetworkId(switched) !== expectedNetworkId) {
    const afterSwitch = provider.requestNetwork ? await provider.requestNetwork() : switched;
    if (walletNetworkId(afterSwitch) !== expectedNetworkId) {
      throw new Error(`Auro doit etre sur ${expectedNetworkId} avant de signer.`);
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function browserCache() {
  const prefix = "zkroll:o1js-cache:";

  return {
    canWrite: true,
    read(header: { persistentId: string; uniqueId: string }) {
      try {
        const value = localStorage.getItem(`${prefix}${header.persistentId}:${header.uniqueId}`);
        return value ? base64ToBytes(value) : undefined;
      } catch {
        return undefined;
      }
    },
    write(header: { persistentId: string; uniqueId: string }, value: Uint8Array) {
      try {
        localStorage.setItem(`${prefix}${header.persistentId}:${header.uniqueId}`, bytesToBase64(value));
      } catch {
        // Browser storage can be too small for proving keys. In that case the in-session compilePromise still helps.
      }
    }
  };
}

async function load() {
  const [{ AccountUpdate, Encoding, Field, Mina, Poseidon, PrivateKey, PublicKey, UInt32, UInt64, fetchAccount }, contracts] =
    await Promise.all([import("o1js"), import("@zkroll/contracts")]);
  return { AccountUpdate, Encoding, Field, Mina, Poseidon, PrivateKey, PublicKey, UInt32, UInt64, fetchAccount, ...contracts };
}

async function setup(network: NetworkId, onProgress?: ProgressCallback) {
  assertProvingCompatibility();
  const toolkit = await load();
  toolkit.Mina.setActiveInstance(toolkit.createMinaNetwork(network));
  if (!compiled) {
    report(onProgress, "progressCompileCircuit", 12);
  }
  compilePromise ??= O1JS_BROWSER_CACHE_ENABLED ? toolkit.ZkDiceGame.compile({ cache: browserCache() }) : toolkit.ZkDiceGame.compile();
  const result = (await compilePromise) as { verificationKey: unknown };
  verificationKey = result.verificationKey;
  compiled = true;
  report(onProgress, "progressCircuitReady", 38);
  return toolkit;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function ensureFeePayerAccountReady(toolkit: Awaited<ReturnType<typeof load>>, sender: unknown, network: NetworkId) {
  const result = await toolkit.fetchAccount({ publicKey: sender as never });
  if (result.error) {
    throw new Error(`Impossible de recuperer le compte fee payer sur ${network}: ${result.error.statusText}`);
  }
}

async function buildMinaTransaction(
  toolkit: Awaited<ReturnType<typeof load>>,
  network: NetworkId,
  sender: unknown,
  memo: string,
  callback: () => Promise<void>
) {
  try {
    await ensureFeePayerAccountReady(toolkit, sender, network);
    return await toolkit.Mina.transaction({ sender: sender as never, fee: FEE_NANOMINA, memo }, callback);
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes("Cannot start new transaction within another transaction")) {
      throw new Error(
        "o1js a conserve un contexte de transaction ouvert apres une erreur reseau. Libere la transaction pending si besoin, recharge la page, puis reessaie quand le reseau repond."
      );
    }
    throw error;
  }
}

function assertProvider(provider: MinaProvider | undefined): MinaProvider {
  if (!provider) throw new Error("Wallet Mina introuvable.");
  if (!provider.sendTransaction) throw new Error("Le wallet ne supporte pas sendTransaction.");
  return provider;
}

function normalizeWalletHash(result: unknown): string | null {
  if (typeof result === "string") return extractTransactionHash(result);
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.hash === "string") return extractTransactionHash(record.hash);
  if (typeof record.transactionHash === "string") return extractTransactionHash(record.transactionHash);
  if (typeof record.txHash === "string") return extractTransactionHash(record.txHash);
  return extractTransactionHash(JSON.stringify(result));
}

export function extractTransactionHash(value: string): string | null {
  return value.match(/5J[1-9A-HJ-NP-Za-km-z]{40,}/)?.[0] ?? null;
}

export function requiredTransactionHash(value: string): string {
  const hash = extractTransactionHash(value);
  if (!hash) {
    throw new Error("Aucun hash de transaction Mina 5J... trouve dans le texte fourni.");
  }
  return hash;
}

function compactGameMemo(action: string, gameId?: string) {
  const suffix = gameId ? ` ${gameId.slice(0, 12)}` : "";
  return `zkroll ${action}${suffix}`.slice(0, 32);
}

async function sendWithWallet(
  provider: MinaProvider,
  transactionJson: string,
  onProgress?: ProgressCallback,
  walletOpenDelayMs?: number,
  memo?: string
) {
  report(onProgress, "progressWalletSignature", 86);
  let localManualResolver: ((resolution: ManualWalletResolution) => void) | null = null;
  const manualResolutionPromise = new Promise<ManualWalletResolution>((resolve) => {
    localManualResolver = resolve;
    manualWalletResolution = resolve;
  });
  const sendPromise = provider.sendTransaction!({
    transaction: transactionJson,
    feePayer: memo ? { fee: FEE_NANOMINA, memo } : undefined,
    walletOpenDelayMs
  });

  const result = await Promise.race([
    sendPromise,
    manualResolutionPromise,
    new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), WALLET_RESPONSE_TIMEOUT_MS))
  ]).finally(() => {
    if (manualWalletResolution === localManualResolver) {
      manualWalletResolution = null;
    }
  });

  if (typeof result === "object" && result && "kind" in result) {
    if (result.kind === "failed") {
      throw new Error(result.reason);
    }
    report(onProgress, "progressTransactionProvided", 100);
    return requiredTransactionHash(result.hash);
  }

  if (result === "timeout") {
    report(onProgress, "progressWalletNoAutoReturn", 92);
    const manualHash = window.prompt(
      "Auro n'a pas renvoye le hash a l'application. Si la transaction est visible dans le wallet ou l'explorateur, colle son hash ici pour indexer la partie."
    );
    if (!manualHash?.trim()) {
      throw new Error("Transaction envoyee possible, mais hash non renseigne. Colle le hash pour indexer la partie.");
    }
    report(onProgress, "progressTransactionProvided", 100);
    return requiredTransactionHash(manualHash);
  }

  const hash = normalizeWalletHash(result);
  if (!hash) {
    const manualHash = window.prompt(
      "Le wallet a repondu sans hash exploitable. Colle le hash de transaction affiche dans Auro ou l'explorateur."
    );
    if (!manualHash?.trim()) {
      throw new Error("Le wallet n'a pas renvoye de hash exploitable.");
    }
    report(onProgress, "progressTransactionProvided", 100);
    return requiredTransactionHash(manualHash);
  }

  report(onProgress, "progressTransactionSent", 100);
  return hash;
}

function payoutModeValue(mode: PayoutMode | undefined) {
  return mode === "opponent_takes_all" ? 1 : 0;
}

async function sendServerProverTransaction(provider: MinaProvider, transactionJson: string, onProgress?: ProgressCallback, memo?: string) {
  report(onProgress, "progressProofGenerated", 84);
  return sendWithWallet(provider, transactionJson, onProgress, SERVER_PROVER_WALLET_DELAY_MS, memo);
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  const payload = (await response.json()) as T | { error: string };
  if (!response.ok) {
    throw new Error(payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "API request failed");
  }
  return payload as T;
}

async function serverProverJob<T extends Record<string, unknown>>(
  type: string,
  input: Record<string, unknown>,
  onProgress?: ProgressCallback
): Promise<T> {
  const created = await apiRequest<ServerProverJob>("/prover/jobs", {
    method: "POST",
    body: JSON.stringify({ type, input })
  });
  let job = created;
  report(onProgress, job.progress.label, job.progress.progress);

  while (job.status === "queued" || job.status === "running") {
    await new Promise((resolve) => window.setTimeout(resolve, SERVER_PROVER_POLL_MS));
    if (job.progress.label === "progressCircuitReady") {
      report(onProgress, "progressGenerateProof", 54);
    }
    job = await apiRequest<ServerProverJob>(`/prover/jobs/${encodeURIComponent(job.id)}`);
    report(onProgress, job.progress.label, job.progress.progress);
  }

  if (job.status === "failed") {
    throw new Error(job.error ?? "Server prover job failed.");
  }
  if (!job.result) {
    throw new Error("Server prover returned no result.");
  }
  return job.result as T;
}

function transactionJsonFromServer(result: Record<string, unknown>) {
  if (typeof result.transactionJson !== "string") {
    throw new Error("Server prover returned no transaction JSON.");
  }
  return result.transactionJson;
}

function memoFromServer(result: Record<string, unknown>) {
  return typeof result.memo === "string" ? result.memo : undefined;
}

export async function pseudoHash(pseudo: string) {
  if (usesServerProver()) {
    const result = await apiRequest<{ pseudoHash: string }>("/prover/pseudo-hash", {
      method: "POST",
      body: JSON.stringify({ pseudo })
    });
    return result.pseudoHash;
  }
  const { Encoding, Poseidon } = await load();
  return Poseidon.hash(Encoding.stringToFields(pseudo)).toString();
}

export async function commitment(secret: string, publicKey: string, gameIdField: string) {
  if (usesServerProver()) {
    const result = await apiRequest<{ commitment: string }>("/prover/commitment", {
      method: "POST",
      body: JSON.stringify({ secret, publicKey, gameIdField })
    });
    return result.commitment;
  }
  const { Field, Poseidon, PublicKey } = await load();
  const player = PublicKey.fromBase58(publicKey);
  return Poseidon.hash([Field(secret), ...player.toFields(), Field(gameIdField)]).toString();
}

export function nextRefundDeadlineSlot(currentSlot: string, timeoutSlots: number) {
  return (BigInt(currentSlot) + BigInt(timeoutSlots)).toString();
}

export function nextStrictRefundDeadlineSlot(currentSlot: string, timeoutSlots: number, previousDeadlineSlot: string) {
  const candidate = BigInt(currentSlot) + BigInt(timeoutSlots);
  const minimum = BigInt(previousDeadlineSlot) + 1n;
  return (candidate > minimum ? candidate : minimum).toString();
}

export async function generateGameZkappKey() {
  if (usesServerProver()) {
    return apiRequest<{ privateKey: string; address: string }>("/prover/keygen", { method: "POST", body: "{}" });
  }
  const { PrivateKey } = await load();
  const privateKey = PrivateKey.random();
  return {
    privateKey: privateKey.toBase58(),
    address: privateKey.toPublicKey().toBase58()
  };
}

export async function createGameOnchain(input: {
  provider: MinaProvider | undefined;
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
  onProgress?: ProgressCallback;
}) {
  const provider = assertProvider(input.provider);
  await ensureWalletNetwork(provider, input.network, input.onProgress);
  if (usesServerProver()) {
    const result = await serverProverJob<Record<string, unknown>>(
      "create",
      { ...input, provider: undefined, onProgress: undefined },
      input.onProgress
    );
    const txHash = await sendServerProverTransaction(provider, transactionJsonFromServer(result), input.onProgress, memoFromServer(result));
    return {
      txHash,
      zkappAddress: typeof result.zkappAddress === "string" ? result.zkappAddress : ""
    };
  }
  const toolkit = await setup(input.network, input.onProgress);
  const sender = toolkit.PublicKey.fromBase58(input.senderPublicKey);
  const zkappKey = toolkit.PrivateKey.fromBase58(input.zkappPrivateKey);
  const zkappAddress = zkappKey.toPublicKey();
  const contract = new toolkit.ZkDiceGame(zkappAddress);

  const memo = compactGameMemo("create", input.gameId);
  const tx = await buildMinaTransaction(toolkit, input.network, sender, memo, async () => {
    const accountCreationFee = networks[input.network].accountCreationFeeNanoMina;
    if (accountCreationFee) {
      const funding = toolkit.AccountUpdate.createSigned(sender);
      funding.balance.subInPlace(toolkit.UInt64.from(accountCreationFee));
    } else {
      toolkit.AccountUpdate.fundNewAccount(sender);
    }
    await contract.deploy({ verificationKey });
    await contract.createGame(
      toolkit.Field(input.gameIdField),
      sender,
      toolkit.Poseidon.hash(toolkit.Encoding.stringToFields(input.pseudo)),
      toolkit.UInt64.from(input.stakeNanoMina),
      toolkit.Field(await commitment(input.secret, input.senderPublicKey, input.gameIdField)),
      toolkit.Field(payoutModeValue(input.payoutMode)),
      toolkit.UInt32.from(input.refundDeadlineSlot)
    );
  });
  report(input.onProgress, "progressGenerateProof", 54);
  await tx.prove();
  tx.sign([zkappKey]);
  report(input.onProgress, "progressProofGenerated", 82);
  const txHash = await sendWithWallet(provider, tx.toJSON(), input.onProgress, undefined, memo);
  return { txHash, zkappAddress: zkappAddress.toBase58() };
}

export async function joinGameOnchain(input: {
  provider: MinaProvider | undefined;
  network: NetworkId;
  senderPublicKey: string;
  pseudo: string;
  secret: string;
  gameIdField: string;
  zkappAddress: string;
  creatorPublicKey: string;
  creatorPseudoHash: string;
  stakeNanoMina: string;
  payoutMode: PayoutMode;
  creatorCommitment: string;
  currentRefundDeadlineSlot: string;
  nextRefundDeadlineSlot: string;
  onProgress?: ProgressCallback;
}) {
  const provider = assertProvider(input.provider);
  await ensureWalletNetwork(provider, input.network, input.onProgress);
  if (usesServerProver()) {
    const result = await serverProverJob<Record<string, unknown>>("join", { ...input, provider: undefined, onProgress: undefined }, input.onProgress);
    return sendServerProverTransaction(provider, transactionJsonFromServer(result), input.onProgress, memoFromServer(result));
  }
  const toolkit = await setup(input.network, input.onProgress);
  const sender = toolkit.PublicKey.fromBase58(input.senderPublicKey);
  const contract = new toolkit.ZkDiceGame(toolkit.PublicKey.fromBase58(input.zkappAddress));

  const memo = compactGameMemo("join", input.gameIdField);
  const tx = await buildMinaTransaction(toolkit, input.network, sender, memo, async () => {
    await contract.joinGame(
      sender,
      toolkit.Field(input.creatorPseudoHash),
      toolkit.Field(input.creatorCommitment),
      toolkit.Field(payoutModeValue(input.payoutMode)),
      toolkit.UInt32.from(input.currentRefundDeadlineSlot),
      toolkit.Poseidon.hash(toolkit.Encoding.stringToFields(input.pseudo)),
      toolkit.Field(await commitment(input.secret, input.senderPublicKey, input.gameIdField)),
      toolkit.UInt32.from(input.nextRefundDeadlineSlot)
    );
  });
  report(input.onProgress, "progressGenerateProof", 54);
  await tx.prove();
  report(input.onProgress, "progressProofGenerated", 82);
  return sendWithWallet(provider, tx.toJSON(), input.onProgress, undefined, memo);
}

export async function settleGameOnchain(input: {
  provider: MinaProvider | undefined;
  network: NetworkId;
  senderPublicKey: string;
  gameIdField: string;
  zkappAddress: string;
  creatorPublicKey: string;
  creatorPseudoHash: string;
  joinerPublicKey: string;
  joinerPseudoHash: string;
  stakeNanoMina: string;
  payoutMode: PayoutMode;
  creatorCommitment: string;
  joinerCommitment: string;
  creatorSecret: string;
  joinerSecret: string;
  winnerPublicKey: string | null;
  refundDeadlineSlot: string;
  onProgress?: ProgressCallback;
}) {
  const provider = assertProvider(input.provider);
  await ensureWalletNetwork(provider, input.network, input.onProgress);
  if (usesServerProver()) {
    const result = await serverProverJob<Record<string, unknown>>("settle", { ...input, provider: undefined, onProgress: undefined }, input.onProgress);
    return sendServerProverTransaction(provider, transactionJsonFromServer(result), input.onProgress, memoFromServer(result));
  }
  const toolkit = await setup(input.network, input.onProgress);
  const sender = toolkit.PublicKey.fromBase58(input.senderPublicKey);
  const contract = new toolkit.ZkDiceGame(toolkit.PublicKey.fromBase58(input.zkappAddress));
  const winner = input.winnerPublicKey
    ? toolkit.PublicKey.fromBase58(input.winnerPublicKey)
    : (toolkit.PublicKey.empty() as typeof sender);

  const memo = compactGameMemo("settle", input.gameIdField);
  const tx = await buildMinaTransaction(toolkit, input.network, sender, memo, async () => {
    const commonArgs = [
      toolkit.Field(input.creatorPseudoHash),
      toolkit.Field(input.joinerPseudoHash),
      toolkit.Field(input.creatorCommitment),
      toolkit.Field(input.joinerCommitment),
      toolkit.Field(input.creatorSecret),
      toolkit.Field(input.joinerSecret),
      winner
    ] as const;
    if (input.payoutMode === "opponent_takes_all") {
      if (input.winnerPublicKey === input.joinerPublicKey) {
        await contract.settleOpponentJoinerWins(...commonArgs, toolkit.UInt32.from(input.refundDeadlineSlot));
        return;
      }
      await contract.settleOpponentCreatorKeeps(...commonArgs, toolkit.UInt32.from(input.refundDeadlineSlot));
      return;
    }
    await contract.settle(...commonArgs, toolkit.Field(payoutModeValue(input.payoutMode)), toolkit.UInt32.from(input.refundDeadlineSlot));
  });
  report(input.onProgress, "progressGenerateProof", 54);
  await tx.prove();
  report(input.onProgress, "progressProofGenerated", 82);
  return sendWithWallet(provider, tx.toJSON(), input.onProgress, undefined, memo);
}

export async function refundGameOnchain(input: {
  provider: MinaProvider | undefined;
  network: NetworkId;
  senderPublicKey: string;
  status: GameStatus;
  gameIdField: string;
  zkappAddress: string;
  creatorPublicKey: string;
  creatorPseudoHash: string;
  joinerPublicKey: string | null;
  joinerPseudoHash: string | null;
  stakeNanoMina: string;
  payoutMode: PayoutMode;
  creatorCommitment: string;
  joinerCommitment: string | null;
  refundDeadlineSlot: string;
  onProgress?: ProgressCallback;
}) {
  const provider = assertProvider(input.provider);
  await ensureWalletNetwork(provider, input.network, input.onProgress);
  if (usesServerProver()) {
    const result = await serverProverJob<Record<string, unknown>>("refund", { ...input, provider: undefined, onProgress: undefined }, input.onProgress);
    return sendServerProverTransaction(provider, transactionJsonFromServer(result), input.onProgress, memoFromServer(result));
  }
  const toolkit = await setup(input.network, input.onProgress);
  const sender = toolkit.PublicKey.fromBase58(input.senderPublicKey);
  const contract = new toolkit.ZkDiceGame(toolkit.PublicKey.fromBase58(input.zkappAddress));

  const memo = compactGameMemo("refund", input.gameIdField);
  const tx = await buildMinaTransaction(toolkit, input.network, sender, memo, async () => {
    if (input.status === "created") {
      await contract.refundCreatedGame(
        toolkit.Field(input.creatorPseudoHash),
        toolkit.Field(input.creatorCommitment),
        toolkit.Field(payoutModeValue(input.payoutMode)),
        toolkit.UInt32.from(input.refundDeadlineSlot)
      );
      return;
    }

    if (!input.joinerPublicKey || !input.joinerPseudoHash || !input.joinerCommitment) {
      throw new Error("Partie incomplete pour refund on-chain.");
    }

    await contract.refundJoinedGame(
      toolkit.Field(input.creatorPseudoHash),
      toolkit.Field(input.joinerPseudoHash),
      toolkit.Field(input.creatorCommitment),
      toolkit.Field(input.joinerCommitment),
      toolkit.Field(payoutModeValue(input.payoutMode)),
      toolkit.UInt32.from(input.refundDeadlineSlot)
    );
  });
  report(input.onProgress, "progressGenerateProof", 54);
  await tx.prove();
  report(input.onProgress, "progressProofGenerated", 82);
  return sendWithWallet(provider, tx.toJSON(), input.onProgress, undefined, memo);
}

export async function cancelCreatedGameOnchain(input: {
  provider: MinaProvider | undefined;
  network: NetworkId;
  senderPublicKey: string;
  gameIdField: string;
  zkappAddress: string;
  creatorPseudoHash: string;
  creatorCommitment: string;
  payoutMode: PayoutMode;
  refundDeadlineSlot: string;
  onProgress?: ProgressCallback;
}) {
  const provider = assertProvider(input.provider);
  await ensureWalletNetwork(provider, input.network, input.onProgress);
  if (usesServerProver()) {
    const result = await serverProverJob<Record<string, unknown>>(
      "cancel",
      { ...input, provider: undefined, onProgress: undefined },
      input.onProgress
    );
    return sendServerProverTransaction(provider, transactionJsonFromServer(result), input.onProgress, memoFromServer(result));
  }
  const toolkit = await setup(input.network, input.onProgress);
  const sender = toolkit.PublicKey.fromBase58(input.senderPublicKey);
  const contract = new toolkit.ZkDiceGame(toolkit.PublicKey.fromBase58(input.zkappAddress));

  const memo = compactGameMemo("cancel", input.gameIdField);
  const tx = await buildMinaTransaction(toolkit, input.network, sender, memo, async () => {
    await (contract as any).cancelCreatedGame(
      toolkit.Field(input.creatorPseudoHash),
      toolkit.Field(input.creatorCommitment),
      toolkit.Field(payoutModeValue(input.payoutMode)),
      toolkit.UInt32.from(input.refundDeadlineSlot)
    );
  });
  report(input.onProgress, "progressGenerateProof", 54);
  await tx.prove();
  report(input.onProgress, "progressProofGenerated", 82);
  return sendWithWallet(provider, tx.toJSON(), input.onProgress, undefined, memo);
}

export async function diceOutcomeOnchain(creatorSecret: string, joinerSecret: string, gameIdField: string) {
  const toolkit = await load();
  const outcome = toolkit.diceOutcome(toolkit.Field(creatorSecret), toolkit.Field(joinerSecret), toolkit.Field(gameIdField));
  return {
    creatorDie: Number(outcome.creatorDie.toString()),
    joinerDie: Number(outcome.joinerDie.toString())
  };
}
