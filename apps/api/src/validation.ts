import { assertNetworkId, type GameStatus } from "@zkroll/shared";

type RecordBody = Record<string, unknown>;

export function asBody(value: unknown): RecordBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected JSON object");
  }

  return value as RecordBody;
}

export function requiredString(body: RecordBody, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${key}`);
  }

  return value.trim();
}

export function optionalString(body: RecordBody, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }

  return value.trim();
}

export function requiredPositiveIntegerString(body: RecordBody, key: string): string {
  const value = requiredString(body, key);
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${key} must be a positive integer string`);
  }

  return value;
}

export function requiredPositiveIntegerNumber(body: RecordBody, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}

export function requiredDie(body: RecordBody, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error(`${key} must be an integer between 1 and 6`);
  }

  return value;
}

export function optionalStatus(value: unknown): GameStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === "created" ||
    value === "join_pending" ||
    value === "joined" ||
    value === "player_one_revealed" ||
    value === "player_two_revealed" ||
    value === "settled" ||
    value === "refunded" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error("Unsupported status");
}

export function requiredNetwork(body: RecordBody) {
  return assertNetworkId(requiredString(body, "network"));
}
