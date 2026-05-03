declare module "qrcode/lib/browser.js" {
  export function toDataURL(text: string, options?: { margin?: number; width?: number }): Promise<string>;
}
