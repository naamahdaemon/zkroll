export type MinaProvider = {
  requestAccounts: () => Promise<string[]>;
  requestNetwork?: () => Promise<{ chainId?: string; name?: string } | string>;
  sendTransaction?: (args: { transaction: string; feePayer?: { fee?: number; memo?: string } }) => Promise<{
    hash?: string;
  }>;
};

declare global {
  interface Window {
    mina?: MinaProvider;
  }
}
