import { Encoding, Field, Mina, Poseidon, PrivateKey, PublicKey, UInt64 } from "o1js";
import { assertNetworkId, type NetworkId } from "@zkroll/shared";
import { createMinaNetwork } from "../network.js";

export const DEFAULT_FEE = 100_000_000;

export function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function readOptionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function readNetwork(): NetworkId {
  return assertNetworkId(process.env.NETWORK ?? "devnet");
}

export function readPrivateKey(name: string): PrivateKey {
  return PrivateKey.fromBase58(readEnv(name));
}

export function readPublicKey(name: string): PublicKey {
  return PublicKey.fromBase58(readEnv(name));
}

export function readField(name: string): Field {
  return Field(readEnv(name));
}

export function readUInt64(name: string): UInt64 {
  return UInt64.from(readEnv(name));
}

export function readFee(): number {
  return Number(process.env.FEE_NANOMINA ?? DEFAULT_FEE);
}

export function useNetwork() {
  const network = readNetwork();
  Mina.setActiveInstance(createMinaNetwork(network));
  return network;
}

export function pseudoHash(pseudo: string): Field {
  return Poseidon.hash(Encoding.stringToFields(pseudo));
}

export function commitment(secret: Field, player: PublicKey, gameId: Field): Field {
  return Poseidon.hash([secret, ...player.toFields(), gameId]);
}

export function gameIdFromZkapp(zkappAddress: PublicKey): Field {
  return Poseidon.hash(zkappAddress.toFields());
}

export function logJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export async function postIndexer<T>(path: string, payload: unknown): Promise<T | null> {
  const apiUrl = readOptionalEnv("API_URL");
  if (!apiUrl) return null;

  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Indexer rejected ${path}: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}
