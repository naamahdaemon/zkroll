import SignClient from "@walletconnect/sign-client";
import type { NetworkId } from "@zkroll/shared";
import { extractTransactionHash } from "./onchain";
import type { MinaProvider } from "./types";

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

const chainIds: Record<NetworkId, string> = {
  mainnet: "mina:mainnet",
  devnet: "mina:devnet",
  zeko: "zeko:testnet"
};

const methods = ["mina_sendTransaction", "wallet_info"];
const chains = Object.values(chainIds);

export type WalletConnectPrompt = {
  kind: "connect" | "request";
  uri?: string;
  openUrl: string;
  fallbackOpenUrl?: string;
};

type PromptHandler = (prompt: WalletConnectPrompt | null) => void;

let promptHandler: PromptHandler | null = null;
let clientPromise: Promise<any> | null = null;
let session: any = null;
let currentChainId: string | null = null;
let preferredChainId: string | null = null;
let pendingCancel: (() => void) | null = null;
let listenersRegistered = false;

export function setWalletConnectPromptHandler(handler: PromptHandler | null) {
  promptHandler = handler;
}

export function walletConnectConfigured() {
  return Boolean(projectId?.trim());
}

export function setWalletConnectNetwork(network: NetworkId) {
  preferredChainId = chainIds[network];
}

export function mobileBrowserCanUseWalletConnect() {
  return walletConnectConfigured() && typeof window !== "undefined" && !window.mina;
}

export function cancelWalletConnectPrompt() {
  const cancel = pendingCancel;
  pendingCancel = null;
  promptHandler?.(null);
  cancel?.();
}

export async function disconnectWalletConnect() {
  const activeSession = session;
  session = null;
  currentChainId = null;
  pendingCancel?.();
  pendingCancel = null;
  promptHandler?.(null);
  if (!activeSession) return;

  const nextClient = await client();
  await nextClient.disconnect({
    topic: activeSession.topic,
    reason: {
      code: 6000,
      message: "User disconnected"
    }
  });
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function connectOpenUrl(uri: string) {
  return `aurowallet://wc?uri=${encodeURIComponent(uri)}`;
}

function requestOpenUrl() {
  return "aurowallet://";
}

function openAuroForRequest() {
  if (!isMobile()) return;
  promptHandler?.({ kind: "request", openUrl: requestOpenUrl() });
  if (!isIOS()) {
    window.location.href = "aurowallet://";
  }
}

async function client() {
  if (!projectId?.trim()) {
    throw new Error("WalletConnect mobile is not configured. Set VITE_WALLETCONNECT_PROJECT_ID.");
  }

  clientPromise ??= SignClient.init({
    projectId,
    metadata: {
      name: "zkroll",
      description: "Mina / Zeko zk dice challenge",
      url: window.location.origin,
      icons: [`${window.location.origin}/zkroll-logo.svg`]
    },
    logger: "warn"
  });

  const nextClient = await clientPromise;
  if (!listenersRegistered) {
    listenersRegistered = true;
    nextClient.on?.("session_request_sent", (event: any) => {
      if (methods.includes(event?.request?.method)) {
        openAuroForRequest();
      }
    });
    nextClient.on?.("session_delete", () => {
      session = null;
      currentChainId = null;
      promptHandler?.(null);
    });
  }
  return nextClient;
}

function minaAccounts(nextSession: any): string[] {
  return nextSession?.namespaces?.mina?.accounts ?? [];
}

function parseAccount(value: string) {
  const parts = value.split(":");
  if (parts.length < 3) return null;
  return {
    chainId: `${parts[0]}:${parts[1]}`,
    publicKey: parts.slice(2).join(":")
  };
}

function accountForChain(chainId: string) {
  const account = minaAccounts(session)
    .map(parseAccount)
    .find((item): item is { chainId: string; publicKey: string } => item !== null && item.chainId === chainId);
  return account?.publicKey ?? null;
}

function firstAccount() {
  return minaAccounts(session).map(parseAccount).find((item): item is { chainId: string; publicKey: string } => item !== null);
}

async function restoreSession() {
  if (session) return session;
  const nextClient = await client();
  session = nextClient.session?.getAll?.().find((item: any) => Boolean(item?.namespaces?.mina?.accounts?.length)) ?? null;
  const account = firstAccount();
  if (account) currentChainId = account.chainId;
  return session;
}

async function disconnectCurrentSession() {
  const activeSession = session;
  session = null;
  currentChainId = null;
  if (!activeSession) return;
  const nextClient = await client();
  await nextClient.disconnect({
    topic: activeSession.topic,
    reason: {
      code: 6000,
      message: "Network switch"
    }
  });
}

function cancellableApproval<T>(approval: () => Promise<T>) {
  pendingCancel?.();
  return Promise.race([
    approval(),
    new Promise<T>((_resolve, reject) => {
      pendingCancel = () => {
        pendingCancel = null;
        reject(new Error("WalletConnect cancelled."));
      };
    })
  ]).finally(() => {
    pendingCancel = null;
  });
}

async function connectSession(targetChainId = preferredChainId) {
  const nextClient = await client();
  const restored = await restoreSession();
  if (restored) {
    if (!targetChainId || accountForChain(targetChainId)) return restored;
    await disconnectCurrentSession();
  }

  const { uri, approval } = await nextClient.connect({
    requiredNamespaces: {
      mina: {
        chains,
        methods,
        events: ["accountsChanged", "chainChanged"]
      }
    }
  });

  if (uri) {
    promptHandler?.({ kind: "connect", uri, openUrl: connectOpenUrl(uri), fallbackOpenUrl: requestOpenUrl() });
  }

  session = await cancellableApproval(approval);
  promptHandler?.(null);
  const account = targetChainId ? { chainId: targetChainId, publicKey: accountForChain(targetChainId) ?? "" } : firstAccount();
  if (account) currentChainId = account.chainId;
  return session;
}

function feeToMina(fee?: number) {
  if (typeof fee !== "number") return undefined;
  return (fee / 1_000_000_000).toString();
}

function normalizeResult(result: unknown) {
  if (typeof result === "string") return { hash: extractTransactionHash(result) ?? undefined };
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (typeof record.hash === "string") return { hash: extractTransactionHash(record.hash) ?? undefined };
  if (typeof record.transactionHash === "string") return { hash: extractTransactionHash(record.transactionHash) ?? undefined };
  if (typeof record.txHash === "string") return { hash: extractTransactionHash(record.txHash) ?? undefined };
  const hash = extractTransactionHash(JSON.stringify(result));
  if (hash) return { hash };
  return result;
}

export function walletConnectProvider(): MinaProvider {
  return {
    async requestAccounts() {
      const targetChainId = preferredChainId;
      await connectSession(targetChainId);
      const account = targetChainId ? { chainId: targetChainId, publicKey: accountForChain(targetChainId) } : firstAccount();
      if (!account?.publicKey) throw new Error("No Mina account returned by WalletConnect.");
      currentChainId = account.chainId;
      return [account.publicKey];
    },

    async requestNetwork() {
      await restoreSession();
      return currentChainId ?? firstAccount()?.chainId ?? null;
    },

    async switchChain(args: { networkID: string }) {
      preferredChainId = args.networkID;
      await connectSession(args.networkID);
      let publicKey = accountForChain(args.networkID);
      if (!publicKey) {
        await disconnectCurrentSession();
        await connectSession(args.networkID);
        publicKey = accountForChain(args.networkID);
      }
      if (!publicKey) {
        throw new Error(`No WalletConnect account available for ${args.networkID}. Select this network in Auro, then reconnect.`);
      }
      currentChainId = args.networkID;
      return { networkID: args.networkID };
    },

    async sendTransaction(args: { transaction: string; feePayer?: { fee?: number; memo?: string } }) {
      await connectSession();
      const nextClient = await client();
      const chainId = currentChainId ?? firstAccount()?.chainId;
      if (!chainId) throw new Error("WalletConnect network is not selected.");
      const from = accountForChain(chainId);
      if (!from) throw new Error(`No WalletConnect account available for ${chainId}.`);

      openAuroForRequest();
      const result = await nextClient.request({
        topic: session.topic,
        chainId,
        request: {
          method: "mina_sendTransaction",
          params: {
            from,
            transaction: args.transaction,
            feePayer: {
              fee: feeToMina(args.feePayer?.fee),
              memo: args.feePayer?.memo
            }
          }
        }
      });
      promptHandler?.(null);
      return normalizeResult(result) as { hash?: string };
    }
  };
}
