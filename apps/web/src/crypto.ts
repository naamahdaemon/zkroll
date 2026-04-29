export function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomFieldString(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  return BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`).toString();
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function temporaryCommitment(secret: string, publicKey: string, gameIdSeed: string): Promise<string> {
  return sha256Hex(`${secret}:${publicKey}:${gameIdSeed}`);
}

export async function temporaryDie(firstSecret: string, secondSecret: string, gameId: string, salt: string): Promise<number> {
  const hash = await sha256Hex(`${firstSecret}:${secondSecret}:${gameId}:${salt}`);
  const value = Number.parseInt(hash.slice(0, 12), 16);
  return (value % 6) + 1;
}

export function fakeTxHash(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomSecret().slice(0, 10)}`;
}
