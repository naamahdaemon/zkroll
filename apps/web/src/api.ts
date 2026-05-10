import type { Game, GameMessage, GameStatus, NetworkId, PayoutMode, Player, TransactionStatus } from "@zkroll/shared";

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

export function listPreviousOpponents(publicKey: string) {
  return request<{ items: Player[] }>(`/players/${encodeURIComponent(publicKey)}/previous-opponents`);
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
  return request<{ hash: string; network: NetworkId; status: TransactionStatus }>(
    `/transactions/${network}/${encodeURIComponent(hash)}/status`
  );
}

export function setMessagePreference(publicKey: string, acceptMessages: boolean) {
  return request<Player>(`/players/${encodeURIComponent(publicKey)}/message-preference`, {
    method: "PATCH",
    body: JSON.stringify({ acceptMessages })
  });
}

export function getTransactionStatuses(items: { network: NetworkId; hash: string }[]) {
  return request<{ items: { hash: string; network: NetworkId; status: TransactionStatus }[] }>(
    "/transactions/statuses",
    {
      method: "POST",
      body: JSON.stringify({ items })
    }
  );
}

export function markTransactionIncluded(network: NetworkId, hash: string) {
  return request<{ hash: string; network: NetworkId; status: TransactionStatus }>(
    `/transactions/${network}/${encodeURIComponent(hash)}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "INCLUDED" })
    }
  );
}

export function getCurrentSlot(network: NetworkId, options: { refresh?: boolean } = {}) {
  const suffix = options.refresh ? "?refresh=1" : "";
  return request<{ network: NetworkId; currentSlot: string }>(`/networks/${network}/current-slot${suffix}`);
}

export function getWalletBalance(network: NetworkId, publicKey: string) {
  return request<{ network: NetworkId; publicKey: string; balanceNanoMina: string | null; error: string | null }>(
    `/networks/${network}/accounts/${encodeURIComponent(publicKey)}/balance`
  );
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
  payoutMode: PayoutMode;
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

export function inviteGame(id: string, input: { inviterPublicKey: string; inviteePublicKey: string }) {
  return request<{ ok: true }>(`/games/${id}/invite`, {
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

export function reconcileJoinTx(id: string, joinTxHash: string) {
  return request<Game>(`/games/${id}/join-tx`, {
    method: "PATCH",
    body: JSON.stringify({ joinTxHash })
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

export function prepareSettlementTx(id: string, settlementTxHash: string) {
  return request<Game>(`/games/${id}/settlement-pending`, {
    method: "PATCH",
    body: JSON.stringify({ settlementTxHash })
  });
}

export function clearPendingSettlementTx(id: string, reason?: string) {
  return request<Game>(`/games/${id}/settlement-pending/clear`, {
    method: "PATCH",
    body: JSON.stringify({ reason })
  });
}

export function refundGame(id: string, input: { refundTxHash: string }) {
  return request<Game>(`/games/${id}/refund`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function prepareRefundTx(id: string, refundTxHash: string) {
  return request<Game>(`/games/${id}/refund-pending`, {
    method: "PATCH",
    body: JSON.stringify({ refundTxHash })
  });
}

export function clearPendingRefundTx(id: string, reason?: string) {
  return request<Game>(`/games/${id}/refund-pending/clear`, {
    method: "PATCH",
    body: JSON.stringify({ reason })
  });
}

export function listGameMessages(id: string, publicKey: string) {
  return request<{ items: GameMessage[] }>(`/games/${id}/messages?publicKey=${encodeURIComponent(publicKey)}`);
}

export function sendGameMessage(id: string, input: { senderPublicKey: string; body: string }) {
  return request<GameMessage>(`/games/${id}/messages`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function markGameMessagesRead(id: string, publicKey: string) {
  return request<{ ok: true }>(`/games/${id}/messages/read`, {
    method: "PATCH",
    body: JSON.stringify({ publicKey })
  });
}

export function getUnreadMessageCounts(publicKey: string) {
  return request<{ counts: Record<string, number> }>(`/messages/unread/${encodeURIComponent(publicKey)}`);
}

export function clearServerProverCache(publicKey: string) {
  return request<{ ok: true; cacheDirectory: string; droppedQueuedJobs: number; running: number; queued: number }>(
    "/admin/prover/cache/clear",
    {
      method: "POST",
      body: JSON.stringify({ publicKey })
    }
  );
}

export type GameNotificationSubscription = {
  gameId: string;
  publicKey: string;
  fcmToken: string;
  createdAt: string;
  updatedAt: string;
};

export type NewGameNotificationSubscription = {
  network: NetworkId;
  publicKey: string;
  fcmToken: string;
  createdAt: string;
  updatedAt: string;
};

export function listNotificationSubscriptions(publicKey: string) {
  return request<{ items: GameNotificationSubscription[]; newGameItems: NewGameNotificationSubscription[] }>(
    `/notifications/${encodeURIComponent(publicKey)}`
  );
}

export function subscribeGameNotifications(id: string, input: { publicKey: string; fcmToken: string }) {
  return request<GameNotificationSubscription>(`/games/${id}/notifications`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function unsubscribeGameNotifications(id: string, input: { publicKey: string; fcmToken?: string }) {
  return request<{ ok: true }>(`/games/${id}/notifications`, {
    method: "DELETE",
    body: JSON.stringify(input)
  });
}

export function subscribeNewGameNotifications(input: { network: NetworkId; publicKey: string; fcmToken: string }) {
  return request<NewGameNotificationSubscription>("/notifications/new-games", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function unsubscribeNewGameNotifications(input: { network: NetworkId; publicKey: string; fcmToken?: string }) {
  return request<{ ok: true }>("/notifications/new-games", {
    method: "DELETE",
    body: JSON.stringify(input)
  });
}
