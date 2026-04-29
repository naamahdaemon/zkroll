export type NetworkId = "mainnet" | "devnet" | "zeko";

export type GameStatus =
  | "pending_signature"
  | "created"
  | "join_pending"
  | "joined"
  | "player_one_revealed"
  | "player_two_revealed"
  | "settled"
  | "refunded"
  | "failed"
  | "cancelled";

export type Player = {
  pseudo: string;
  publicKey: string;
  createdAt: string;
};

export type Game = {
  id: string;
  network: NetworkId;
  zkappAddress: string | null;
  gameIdField: string | null;
  creatorPseudo: string;
  creatorPublicKey: string;
  creatorPseudoHash: string | null;
  joinerPseudo: string | null;
  joinerPublicKey: string | null;
  joinerPseudoHash: string | null;
  stakeNanoMina: string;
  creatorCommitment: string;
  joinerCommitment: string | null;
  creatorReveal: string | null;
  joinerReveal: string | null;
  creatorDie: number | null;
  joinerDie: number | null;
  winnerPublicKey: string | null;
  status: GameStatus;
  refundTimeoutSlots: number;
  refundDeadlineSlot: string | null;
  pendingJoinRefundDeadlineSlot: string | null;
  failureReason: string | null;
  creationTxHash: string;
  joinTxHash: string | null;
  settlementTxHash: string | null;
  refundTxHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlayerRequest = {
  pseudo: string;
  publicKey: string;
};

export type CreateGameRequest = {
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
};

export type ReconcileCreationRequest = {
  creationTxHash: string;
};

export type MarkCreationFailedRequest = {
  reason?: string;
};

export type JoinGameRequest = {
  joinerPseudo: string;
  joinerPublicKey: string;
  joinerPseudoHash?: string;
  joinerCommitment: string;
  refundDeadlineSlot?: string;
  joinTxHash: string;
};

export type RevealRequest = {
  publicKey: string;
  secret: string;
};

export type SettleGameRequest = {
  creatorDie: number;
  joinerDie: number;
  winnerPublicKey: string | null;
  settlementTxHash: string;
};

export type RefundGameRequest = {
  refundTxHash: string;
};

export type NetworkConfig = {
  id: NetworkId;
  label: string;
  networkId: "mainnet" | "testnet" | "zeko" | "zeko_testnet";
  minaEndpoint: string;
  archiveEndpoint: string;
  explorerBaseUrl: string;
};

export const networks: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: "mainnet",
    label: "Mina Mainnet",
    networkId: "mainnet",
    minaEndpoint: "https://api.minascan.io/node/mainnet/v1/graphql",
    archiveEndpoint: "https://api.minascan.io/archive/mainnet/v1/graphql",
    explorerBaseUrl: "https://minascan.io/mainnet/tx"
  },
  devnet: {
    id: "devnet",
    label: "Mina Devnet",
    networkId: "testnet",
    minaEndpoint: "https://api.minascan.io/node/devnet/v1/graphql",
    archiveEndpoint: "https://api.minascan.io/archive/devnet/v1/graphql",
    explorerBaseUrl: "https://minascan.io/devnet/tx"
  },
  zeko: {
    id: "zeko",
    label: "Zeko",
    networkId: "zeko_testnet",
    minaEndpoint: "https://testnet.zeko.io/graphql",
    archiveEndpoint: "https://archive.testnet.zeko.io/graphql",
    explorerBaseUrl: "https://zekoscan.io/tx"
  }
};

export function assertNetworkId(value: string): NetworkId {
  if (value === "mainnet" || value === "devnet" || value === "zeko") {
    return value;
  }

  throw new Error(`Unsupported network: ${value}`);
}

export function isOpenGame(game: Game): boolean {
  return game.status === "created";
}
