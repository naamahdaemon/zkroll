import SignClient from "@walletconnect/sign-client";
import type { NetworkId } from "@zkroll/shared";
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
};

type PromptHandler = (prompt: WalletConnectPrompt | null) => void;

let promptHandler: PromptHandler | null = null;
let clientPromise: Promise<any> | null = null;
let session: any = null;
let currentChainId: string | null = null;

export function setWalletConnectPromptHandler(handler: PromptHandler | null) {
  promptHandler = handler;
}

export function walletConnectConfigured() {
  return Boolean(projectId?.trim());
}

export function mobileBrowserCanUseWalletConnect() {
  return walletConnectConfigured() && typeof window !== "undefined" && !window.mina;
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function connectOpenUrl(uri: string) {
  return `https://link.walletconnect.com/?uri=${encodeURIComponent(uri)}`;
}

function requestOpenUrl() {
  return isIOS() ? "https://applinks.aurowallet.com/applinks?action=openurl&url=" : "aurowallet://";
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
  nextClient.on?.("session_request_sent", (event: any) => {
    if (methods.includes(event?.request?.method)) {
      openAuroForRequest();
    }
  });
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

async function connectSession() {
  const nextClient = await client();
  const restored = await restoreSession();
  if (restored) return restored;

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
    promptHandler?.({ kind: "connect", uri, openUrl: connectOpenUrl(uri) });
  }

  session = await approval();
  promptHandler?.(null);
  const account = firstAccount();
  if (account) currentChainId = account.chainId;
  return session;
}

function feeToMina(fee?: number) {
  if (typeof fee !== "number") return undefined;
  return (fee / 1_000_000_000).toString();
}

function normalizeResult(result: unknown) {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (typeof record.hash === "string") return { hash: record.hash };
  if (typeof record.transactionHash === "string") return { hash: record.transactionHash };
  if (typeof record.txHash === "string") return { hash: record.txHash };
  return result;
}

export function walletConnectProvider(): MinaProvider {
  return {
    async requestAccounts() {
      await connectSession();
      const account = firstAccount();
      if (!account) throw new Error("No Mina account returned by WalletConnect.");
      currentChainId = account.chainId;
      return [account.publicKey];
    },

    async requestNetwork() {
      await restoreSession();
      return currentChainId ?? firstAccount()?.chainId ?? null;
    },

    async switchChain(args: { networkID: string }) {
      await connectSession();
      const publicKey = accountForChain(args.networkID);
      if (!publicKey) {
        throw new Error(`No WalletConnect account available for ${args.networkID}. Reconnect Auro on this network.`);
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
