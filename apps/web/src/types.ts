export type MinaProvider = {
  requestAccounts: () => Promise<string[]>;
  requestNetwork?: () => Promise<{ chainId?: string; name?: string; networkID?: string } | string | null>;
  switchChain?: (args: { networkID: string }) => Promise<{ chainId?: string; name?: string; networkID?: string } | { code: number; message: string }>;
  sendTransaction?: (args: { transaction: string; feePayer?: { fee?: number; memo?: string } }) => Promise<{
    hash?: string;
  }>;
};

declare global {
  interface Window {
    mina?: MinaProvider;
  }
}
