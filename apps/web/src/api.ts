import type { Game, GameStatus, NetworkId, Player } from "@zkroll/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  const payload = (await response.json()) as T | { error: string };
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "API request failed";
    throw new Error(message);
  }

  return payload as T;
}

export function listGames(status?: GameStatus) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<Game[]>(`/games${suffix}`);
}

export function getPlayerByPublicKey(publicKey: string) {
  return request<Player>(`/players/by-public-key/${encodeURIComponent(publicKey)}`);
}

export function createPlayer(input: { pseudo: string; publicKey: string }) {
  return request<Player>("/players", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getMerkleWitness(network: NetworkId, gameIdField: string) {
  return request<{
    root: string;
    value: string;
    witness: { isLefts: boolean[]; siblings: string[] };
  }>(`/merkle/witness/${network}/${encodeURIComponent(gameIdField)}`);
}

export function getTransactionStatus(network: NetworkId, hash: string) {
  return request<{ hash: string; network: NetworkId; status: "INCLUDED" | "PENDING" | "UNKNOWN" }>(
    `/transactions/${network}/${encodeURIComponent(hash)}/status`
  );
}

export function getTransactionStatuses(items: { network: NetworkId; hash: string }[]) {
  return request<{ items: { hash: string; network: NetworkId; status: "INCLUDED" | "PENDING" | "UNKNOWN" }[] }>(
    "/transactions/statuses",
    {
      method: "POST",
      body: JSON.stringify({ items })
    }
  );
}

export function getCurrentSlot(network: NetworkId) {
  return request<{ network: NetworkId; currentSlot: string }>(`/networks/${network}/current-slot`);
}

export function createGame(input: {
  id?: string;
  network: NetworkId;
  zkappAddress?: string;
  gameIdField?: string;
  creatorPseudo: string;
  creatorPublicKey: string;
  creatorPseudoHash?: string;
  stakeNanoMina: string;
  creatorCommitment: string;
  refundTimeoutSlots: number;
  refundDeadlineSlot?: string;
  creationTxHash?: string;
}) {
  return request<Game>("/games", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function reconcileCreationTx(id: string, creationTxHash: string) {
  return request<Game>(`/games/${id}/creation-tx`, {
    method: "PATCH",
    body: JSON.stringify({ creationTxHash })
  });
}

export function markCreationFailed(id: string, reason?: string) {
  return request<Game>(`/games/${id}/creation-failed`, {
    method: "PATCH",
    body: JSON.stringify({ reason })
  });
}

export function joinGame(
  id: string,
  input: {
    joinerPseudo: string;
    joinerPublicKey: string;
    joinerPseudoHash?: string;
    joinerCommitment: string;
    refundDeadlineSlot?: string;
    joinTxHash: string;
  }
) {
  return request<Game>(`/games/${id}/join`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function confirmJoinGame(id: string) {
  return request<Game>(`/games/${id}/join-confirmed`, {
    method: "PATCH",
    body: JSON.stringify({})
  });
}

export function failPendingJoin(id: string, reason?: string) {
  return request<Game>(`/games/${id}/join-failed`, {
    method: "PATCH",
    body: JSON.stringify({ reason })
  });
}

export function revealGame(id: string, input: { publicKey: string; secret: string }) {
  return request<Game>(`/games/${id}/reveal`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function settleGame(
  id: string,
  input: {
    creatorDie: number;
    joinerDie: number;
    winnerPublicKey: string | null;
    settlementTxHash: string;
  }
) {
  return request<Game>(`/games/${id}/settle`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function refundGame(id: string, input: { refundTxHash: string }) {
  return request<Game>(`/games/${id}/refund`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
