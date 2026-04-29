import { networks, type GameStatus, type NetworkId } from "@zkroll/shared";
import type { MinaProvider } from "./types";

const CONTRACT_ADDRESS = import.meta.env.VITE_ZKROLL_CONTRACT_ADDRESS as string | undefined;
const FEE_NANOMINA = Number(import.meta.env.VITE_FEE_NANOMINA ?? 100_000_000);
const WALLET_RESPONSE_TIMEOUT_MS = Number(import.meta.env.VITE_WALLET_RESPONSE_TIMEOUT_MS ?? 120_000);
const O1JS_BROWSER_CACHE_ENABLED = import.meta.env.VITE_O1JS_BROWSER_CACHE_ENABLED !== "false";

type WitnessJson = {
  isLefts: boolean[];
  siblings: string[];
};

let compilePromise: Promise<unknown> | null = null;
let compiled = false;

export type OnchainProgress = {
  label: string;
  progress: number;
};

type ProgressCallback = (progress: OnchainProgress) => void;

function report(callback: ProgressCallback | undefined, label: string, progress: number) {
  callback?.({ label, progress });
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

  report(onProgress, "Changement de reseau wallet", 4);
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
  const [{ Bool, Encoding, fetchLastBlock, Field, MerkleMapWitness, Mina, Poseidon, PublicKey, UInt32, UInt64 }, contracts] =
    await Promise.all([import("o1js"), import("@zkroll/contracts")]);
  return { Bool, Encoding, fetchLastBlock, Field, MerkleMapWitness, Mina, Poseidon, PublicKey, UInt32, UInt64, ...contracts };
}

async function setup(network: NetworkId, onProgress?: ProgressCallback) {
  if (!CONTRACT_ADDRESS) {
    throw new Error("VITE_ZKROLL_CONTRACT_ADDRESS manquant.");
  }

  const toolkit = await load();
  toolkit.Mina.setActiveInstance(toolkit.createMinaNetwork(network));
  if (!compiled) {
    report(onProgress, "Compilation du circuit ZK", 12);
  }
  compilePromise ??= O1JS_BROWSER_CACHE_ENABLED ? toolkit.ZkRoll.compile({ cache: browserCache() }) : toolkit.ZkRoll.compile();
  await compilePromise;
  compiled = true;
  report(onProgress, "Circuit ZK pret", 38);
  return toolkit;
}

function assertProvider(provider: MinaProvider | undefined): MinaProvider {
  if (!provider) throw new Error("Wallet Mina introuvable.");
  if (!provider.sendTransaction) throw new Error("Le wallet ne supporte pas sendTransaction.");
  return provider;
}

function normalizeWalletHash(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.hash === "string") return record.hash;
  if (typeof record.transactionHash === "string") return record.transactionHash;
  if (typeof record.txHash === "string") return record.txHash;
  return null;
}

async function sendWithWallet(provider: MinaProvider, transactionJson: string, memo: string, onProgress?: ProgressCallback) {
  report(onProgress, "Signature dans le wallet", 86);
  const sendPromise = provider.sendTransaction!({
    transaction: transactionJson,
    feePayer: {
      fee: FEE_NANOMINA,
      memo
    }
  });

  const result = await Promise.race([
    sendPromise,
    new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), WALLET_RESPONSE_TIMEOUT_MS))
  ]);

  if (result === "timeout") {
    report(onProgress, "Wallet sans retour automatique", 92);
    const manualHash = window.prompt(
      "Auro n'a pas renvoye le hash a l'application. Si la transaction est visible dans le wallet ou l'explorateur, colle son hash ici pour indexer la partie."
    );
    if (!manualHash?.trim()) {
      throw new Error("Transaction envoyee possible, mais hash non renseigne. Colle le hash pour indexer la partie.");
    }
    report(onProgress, "Transaction renseignee", 100);
    return manualHash.trim();
  }

  const hash = normalizeWalletHash(result);
  if (!hash) {
    const manualHash = window.prompt(
      "Le wallet a repondu sans hash exploitable. Colle le hash de transaction affiche dans Auro ou l'explorateur."
    );
    if (!manualHash?.trim()) {
      throw new Error("Le wallet n'a pas renvoye de hash exploitable.");
    }
    report(onProgress, "Transaction renseignee", 100);
    return manualHash.trim();
  }

  report(onProgress, "Transaction envoyee", 100);
  return hash;
}

export async function pseudoHash(pseudo: string) {
  const { Encoding, Poseidon } = await load();
  return Poseidon.hash(Encoding.stringToFields(pseudo)).toString();
}

export async function commitment(secret: string, publicKey: string, gameIdField: string) {
  const { Field, Poseidon, PublicKey } = await load();
  const player = PublicKey.fromBase58(publicKey);
  return Poseidon.hash([Field(secret), ...player.toFields(), Field(gameIdField)]).toString();
}

export async function nextRefundDeadlineSlot(network: NetworkId, timeoutSlots: number) {
  const { fetchLastBlock } = await load();
  const latest = await fetchLastBlock(networks[network].minaEndpoint);
  const currentSlot = BigInt(latest.globalSlotSinceGenesis.toString());
  return (currentSlot + BigInt(timeoutSlots)).toString();
}

function witnessFromJson(toolkit: Awaited<ReturnType<typeof load>>, witness: WitnessJson) {
  return new toolkit.MerkleMapWitness(
    witness.isLefts.map((item) => toolkit.Bool(item)),
    witness.siblings.map((item) => toolkit.Field(item))
  );
}

export async function createGameOnchain(input: {
  provider: MinaProvider | undefined;
  network: NetworkId;
  senderPublicKey: string;
  pseudo: string;
  secret: string;
  gameIdField: string;
  stakeNanoMina: string;
  refundDeadlineSlot: string;
  witness: WitnessJson;
  onProgress?: ProgressCallback;
}) {
  const provider = assertProvider(input.provider);
  await ensureWalletNetwork(provider, input.network, input.onProgress);
  const toolkit = await setup(input.network, input.onProgress);
  const sender = toolkit.PublicKey.fromBase58(input.senderPublicKey);
  const contract = new toolkit.ZkRoll(toolkit.PublicKey.fromBase58(CONTRACT_ADDRESS!));
  const witness = witnessFromJson(toolkit, input.witness);

  const tx = await toolkit.Mina.transaction({ sender, fee: FEE_NANOMINA }, async () => {
    await contract.createGame(
      toolkit.Field(input.gameIdField),
      witness,
      sender,
      toolkit.Poseidon.hash(toolkit.Encoding.stringToFields(input.pseudo)),
      toolkit.UInt64.from(input.stakeNanoMina),
      toolkit.Field(await commitment(input.secret, input.senderPublicKey, input.gameIdField)),
      toolkit.UInt32.from(input.refundDeadlineSlot)
    );
  });
  report(input.onProgress, "Generation de la preuve", 54);
  await tx.prove();
  report(input.onProgress, "Preuve generee", 82);
  return sendWithWallet(provider, tx.toJSON(), "zkroll create", input.onProgress);
}

export async function joinGameOnchain(input: {
  provider: MinaProvider | undefined;
  network: NetworkId;
  senderPublicKey: string;
  pseudo: string;
  secret: string;
  gameIdField: string;
  witness: WitnessJson;
  creatorPublicKey: string;
  creatorPseudoHash: string;
  stakeNanoMina: string;
  creatorCommitment: string;
  currentRefundDeadlineSlot: string;
  nextRefundDeadlineSlot: string;
  onProgress?: ProgressCallback;
}) {
  const provider = assertProvider(input.provider);
  await ensureWalletNetwork(provider, input.network, input.onProgress);
  const toolkit = await setup(input.network, input.onProgress);
  const sender = toolkit.PublicKey.fromBase58(input.senderPublicKey);
  const contract = new toolkit.ZkRoll(toolkit.PublicKey.fromBase58(CONTRACT_ADDRESS!));
  const witness = witnessFromJson(toolkit, input.witness);

  const tx = await toolkit.Mina.transaction({ sender, fee: FEE_NANOMINA }, async () => {
    await contract.joinGame(
      toolkit.Field(input.gameIdField),
      witness,
      toolkit.PublicKey.fromBase58(input.creatorPublicKey),
      toolkit.Field(input.creatorPseudoHash),
      toolkit.UInt64.from(input.stakeNanoMina),
      toolkit.Field(input.creatorCommitment),
      sender,
      toolkit.Poseidon.hash(toolkit.Encoding.stringToFields(input.pseudo)),
      toolkit.Field(await commitment(input.secret, input.senderPublicKey, input.gameIdField)),
      toolkit.UInt32.from(input.currentRefundDeadlineSlot),
      toolkit.UInt32.from(input.nextRefundDeadlineSlot)
    );
  });
  report(input.onProgress, "Generation de la preuve", 54);
  await tx.prove();
  report(input.onProgress, "Preuve generee", 82);
  return sendWithWallet(provider, tx.toJSON(), "zkroll join", input.onProgress);
}

export async function settleGameOnchain(input: {
  provider: MinaProvider | undefined;
  network: NetworkId;
  senderPublicKey: string;
  gameIdField: string;
  witness: WitnessJson;
  creatorPublicKey: string;
  creatorPseudoHash: string;
  joinerPublicKey: string;
  joinerPseudoHash: string;
  stakeNanoMina: string;
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
  const toolkit = await setup(input.network, input.onProgress);
  const sender = toolkit.PublicKey.fromBase58(input.senderPublicKey);
  const contract = new toolkit.ZkRoll(toolkit.PublicKey.fromBase58(CONTRACT_ADDRESS!));
  const witness = witnessFromJson(toolkit, input.witness);
  const winner = input.winnerPublicKey
    ? toolkit.PublicKey.fromBase58(input.winnerPublicKey)
    : (toolkit.PublicKey.empty() as typeof sender);

  const tx = await toolkit.Mina.transaction({ sender, fee: FEE_NANOMINA }, async () => {
    await contract.settleGame(
      toolkit.Field(input.gameIdField),
      witness,
      toolkit.PublicKey.fromBase58(input.creatorPublicKey),
      toolkit.Field(input.creatorPseudoHash),
      toolkit.PublicKey.fromBase58(input.joinerPublicKey),
      toolkit.Field(input.joinerPseudoHash),
      toolkit.UInt64.from(input.stakeNanoMina),
      toolkit.Field(input.creatorCommitment),
      toolkit.Field(input.joinerCommitment),
      toolkit.Field(input.creatorSecret),
      toolkit.Field(input.joinerSecret),
      winner,
      toolkit.UInt32.from(input.refundDeadlineSlot)
    );
  });
  report(input.onProgress, "Generation de la preuve", 54);
  await tx.prove();
  report(input.onProgress, "Preuve generee", 82);
  return sendWithWallet(provider, tx.toJSON(), "zkroll settle", input.onProgress);
}

export async function refundGameOnchain(input: {
  provider: MinaProvider | undefined;
  network: NetworkId;
  senderPublicKey: string;
  status: GameStatus;
  gameIdField: string;
  witness: WitnessJson;
  creatorPublicKey: string;
  creatorPseudoHash: string;
  joinerPublicKey: string | null;
  joinerPseudoHash: string | null;
  stakeNanoMina: string;
  creatorCommitment: string;
  joinerCommitment: string | null;
  refundDeadlineSlot: string;
  onProgress?: ProgressCallback;
}) {
  const provider = assertProvider(input.provider);
  await ensureWalletNetwork(provider, input.network, input.onProgress);
  const toolkit = await setup(input.network, input.onProgress);
  const sender = toolkit.PublicKey.fromBase58(input.senderPublicKey);
  const contract = new toolkit.ZkRoll(toolkit.PublicKey.fromBase58(CONTRACT_ADDRESS!));
  const witness = witnessFromJson(toolkit, input.witness);

  const tx = await toolkit.Mina.transaction({ sender, fee: FEE_NANOMINA }, async () => {
    if (input.status === "created") {
      await contract.refundCreatedGame(
        toolkit.Field(input.gameIdField),
        witness,
        toolkit.PublicKey.fromBase58(input.creatorPublicKey),
        toolkit.Field(input.creatorPseudoHash),
        toolkit.UInt64.from(input.stakeNanoMina),
        toolkit.Field(input.creatorCommitment),
        toolkit.UInt32.from(input.refundDeadlineSlot)
      );
      return;
    }

    if (!input.joinerPublicKey || !input.joinerPseudoHash || !input.joinerCommitment) {
      throw new Error("Partie incomplete pour refund on-chain.");
    }

    await contract.refundJoinedGame(
      toolkit.Field(input.gameIdField),
      witness,
      toolkit.PublicKey.fromBase58(input.creatorPublicKey),
      toolkit.Field(input.creatorPseudoHash),
      toolkit.PublicKey.fromBase58(input.joinerPublicKey),
      toolkit.Field(input.joinerPseudoHash),
      toolkit.UInt64.from(input.stakeNanoMina),
      toolkit.Field(input.creatorCommitment),
      toolkit.Field(input.joinerCommitment),
      toolkit.UInt32.from(input.refundDeadlineSlot)
    );
  });
  report(input.onProgress, "Generation de la preuve", 54);
  await tx.prove();
  report(input.onProgress, "Preuve generee", 82);
  return sendWithWallet(provider, tx.toJSON(), "zkroll refund", input.onProgress);
}

export async function diceOutcomeOnchain(creatorSecret: string, joinerSecret: string, gameIdField: string) {
  const toolkit = await load();
  const outcome = toolkit.diceOutcome(toolkit.Field(creatorSecret), toolkit.Field(joinerSecret), toolkit.Field(gameIdField));
  return {
    creatorDie: Number(outcome.creatorDie.toString()),
    joinerDie: Number(outcome.joinerDie.toString())
  };
}
