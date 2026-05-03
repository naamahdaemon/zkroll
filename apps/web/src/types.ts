export type MinaProvider = {
  requestAccounts: () => Promise<string[]>;
  requestNetwork?: () => Promise<{ chainId?: string; name?: string; networkID?: string } | string | null>;
  switchChain?: (args: { networkID: string }) => Promise<{ chainId?: string; name?: string; networkID?: string } | { code: number; message: string }>;
  sendTransaction?: (args: { transaction: string; feePayer?: { fee?: number; memo?: string } }) => Promise<{
    hash?: string;
  }>;
};

declare global {
  type BarcodeFormat = "qr_code";

  type DetectedBarcode = {
    rawValue: string;
  };

  class BarcodeDetector {
    constructor(options?: { formats?: BarcodeFormat[] });
    detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
  }

  interface Window {
    mina?: MinaProvider;
    BarcodeDetector?: typeof BarcodeDetector;
  }
}
