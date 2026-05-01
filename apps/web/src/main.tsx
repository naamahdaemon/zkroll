import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  CircleEqual,
  Dices,
  Languages,
  Moon,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sun,
  Trophy,
  Wallet
} from "lucide-react";
import { networks, type Game, type GameStatus, type NetworkId, type TransactionStatus } from "@zkroll/shared";
import {
  createGame,
  createPlayer,
  confirmJoinGame,
  failPendingJoin,
  getCurrentSlot,
  getPlayerByPublicKey,
  getTransactionStatuses,
  joinGame,
  listGames,
  markTransactionIncluded,
  markCreationFailed,
  reconcileCreationTx,
  refundGame,
  revealGame,
  settleGame
} from "./api";
import { fakeTxHash, randomFieldString, temporaryCommitment, temporaryDie } from "./crypto";
import {
  commitment as onchainCommitment,
  createGameOnchain,
  diceOutcomeOnchain,
  ensureWalletNetwork,
  externalBrowserUrl,
  generateGameZkappKey,
  getProvingCompatibility,
  joinGameOnchain,
  nextRefundDeadlineSlot,
  pseudoHash,
  refundGameOnchain,
  requiredTransactionHash,
  settleGameOnchain,
  type OnchainProgress,
  type ProvingCompatibility,
  type ProvingCompatibilityIssueCode
} from "./onchain";
import {
  cancelWalletConnectPrompt,
  disconnectWalletConnect,
  mobileBrowserCanUseWalletConnect,
  setWalletConnectPromptHandler,
  setWalletConnectNetwork,
  walletConnectConfigured,
  walletConnectProvider,
  type WalletConnectPrompt
} from "./walletconnect";
import "./styles.css";
import "./types";

const nanoMina = 1_000_000_000;
const onchainEnabled = import.meta.env.VITE_ONCHAIN_ENABLED === "true";
const defaultRefundTimeoutSlots = Number(import.meta.env.VITE_REFUND_TIMEOUT_SLOTS ?? 120);
const txPollIntervalMs = Number(import.meta.env.VITE_TX_POLL_INTERVAL_MS ?? 60_000);
const slotPollIntervalMs = Number(import.meta.env.VITE_SLOT_POLL_INTERVAL_MS ?? 60_000);
const gamesPerPage = 5;
type TxStatus = TransactionStatus;
type Locale = "en" | "fr";
type Theme = "light" | "dark";
type StatusFilter = "all" | GameStatus;
type NetworkFilter = "all" | NetworkId;
const gameStatuses: GameStatus[] = [
  "pending_signature",
  "created",
  "join_pending",
  "joined",
  "player_one_revealed",
  "player_two_revealed",
  "settled",
  "refunded",
  "failed",
  "cancelled"
];

const copy: Record<Locale, Record<string, string>> = {
  en: {
    walletPrompt: "Connect your wallet to start.",
    noPseudo: "Not configured",
    player: "Player",
    pseudo: "Pseudo",
    network: "Network",
    connectWallet: "Connect wallet",
    disconnectWallet: "Disconnect",
    walletConnected: "Wallet connected",
    newChallenge: "New challenge",
    stake: "Stake in MINA",
    refundTimeout: "Refund timeout (slots)",
    create: "Create",
    games: "Games",
    allStatuses: "All statuses",
    allNetworks: "All networks",
    searchPlayer: "Search player",
    previous: "Previous",
    next: "Next",
    page: "Page",
    draw: "Draw",
    indexed: "indexed",
    challenge: "Challenge",
    creator: "Creator",
    opponent: "Opponent",
    waiting: "Waiting",
    transaction: "Transaction",
    refund: "Refund",
    currentSlot: "Current slot",
    notConfigured: "Not configured",
    onchainState: "On-chain state",
    signaturePending: "Signature sent or waiting for hash",
    creationFailed: "Creation failed on-chain",
    waitingCreation: "Waiting for creation confirmation",
    waitingJoin: "Waiting for join confirmation",
    joinPending: "Join transaction pending",
    confirmJoin: "Confirm join",
    releaseJoin: "Release join",
    actionsAvailable: "Actions available for this game state",
    enterHash: "Enter hash",
    resignCreation: "Resign",
    markFailed: "Mark failed",
    markIncluded: "Mark included",
    confirmIncluded: "Mark this transaction as included? Only do this after checking the explorer.",
    transactionIncluded: "Transaction marked as included.",
    join: "Join",
    reveal: "Reveal",
    settle: "Settle",
    refundedGame: "Game refunded",
    failedGame: "Creation failed",
    noLockedFunds: "No funds were locked by the contract.",
    emptyGames: "No games yet.",
    choosePseudo: "Choose a pseudo",
    editPseudo: "Edit pseudo",
    pseudoNotice: "This pseudo will be associated with your wallet in the local database.",
    save: "Save",
    zkWorkNotice: "Compilation and proof generation can take a while in the browser.",
    elapsed: "Elapsed",
    refresh: "Refresh",
    walletMissing: "Mina wallet not found. Install Auro or enable the extension.",
    noWalletAccount: "No account returned by the wallet.",
    walletFound: "Wallet connected. Pseudo found:",
    choosePseudoMessage: "Wallet connected. Choose a pseudo to register this address.",
    pseudoSaved: "Pseudo saved:",
    pseudoUpdated: "Pseudo updated:",
    creatorOnlyHash: "Only the creator can enter the creation hash.",
    pasteCreationHash: "Paste the creation transaction hash visible in Auro or the explorer.",
    hashSaved: "Creation hash saved. On-chain sync will be checked.",
    resignCreationConfirm: "Before re-signing, check Auro or the explorer. If the transaction already exists, paste its hash instead. Re-sign now?",
    creationMaterialMissing: "Local creation material is missing. Paste the transaction hash if it exists, or create a new challenge.",
    creationResigned: "Creation transaction signed again and indexed.",
    creatorOnlyFailed: "Only the creator can mark this creation as failed.",
    confirmFailed: "Mark this creation as failed? Use only if the create transaction failed on the explorer.",
    optionalReason: "Optional reason",
    failedReasonDefault: "Create transaction failed on-chain",
    markedFailed: "Creation marked as failed. The game is excluded from the local Merkle root.",
    walletAndPseudoRequired: "Pseudo and wallet required.",
    createdOnchain: "Challenge created on-chain and indexed.",
    createdMock: "Challenge created in simulation mode.",
    cannotJoinOwn: "You cannot join your own challenge.",
    incompatibleOnchain: "Game is not compatible with on-chain mode.",
    joinedOnchain: "Challenge joined on-chain. Both players can reveal.",
    joinPendingMessage: "Join transaction sent. Waiting for on-chain inclusion before revealing.",
    joinConfirmed: "Join confirmed. Both players can reveal.",
    joinReleased: "Pending join released. The challenge is open again.",
    joinFailedReason: "Join transaction failed or was not included.",
    joinedMock: "Challenge joined in simulation mode.",
    walletSecretRequired: "Wallet and secret required.",
    bothSecretsRequired: "Both secrets must be revealed.",
    bothRevealed: "Both secrets are revealed. Result computed locally; settlement will verify and pay on-chain.",
    waitingOtherReveal: "Secret revealed. Waiting for the other player.",
    incompleteSettlement: "Game is incomplete for on-chain settlement.",
    settledOnchain: "Game settled on-chain and indexed.",
    settledMock: "Game settled in simulation mode.",
    walletRequired: "Wallet required.",
    refundNotReady: "The timeout must be reached and create/join transactions included before refund.",
    playerOnlyRefund: "Only a player in this game can request refund.",
    incompleteRefund: "Game is incomplete for on-chain refund.",
    refundSent: "Refund sent on-chain and indexed.",
    refundMock: "Game refunded in simulation mode.",
    invalidRefundTimeout: "Refund timeout must be a positive integer.",
    activeAfterSlot: "active after slot",
    minaZkDice: "Mina / Zeko zk dice",
    provingCompatibilityTitle: "ZK proving may not work in this browser",
    provingCompatibilityIntro: "This device cannot safely compile the circuit here.",
    provingCompatibilityAdvice: "Open zkroll in a full browser with COOP/COEP support, or use desktop.",
    openInBrowser: "Open in browser",
    copyPageUrl: "Copy page URL",
    openAuro: "Open Auro",
    cancel: "Cancel",
    copyWalletConnectUri: "Copy WalletConnect URI",
    walletConnectPrompt: "Approve the WalletConnect request in Auro, then return here.",
    walletConnectNotConfigured: "Mobile WalletConnect is not configured. Set VITE_WALLETCONNECT_PROJECT_ID.",
    createdAt: "Created",
    updatedAt: "Updated",
    joinedAt: "Joined",
    creatorRevealedAt: "Creator reveal",
    joinerRevealedAt: "Opponent reveal",
    settledAt: "Settled",
    refundedAt: "Refunded",
    failedAt: "Failed",
    cancelledAt: "Cancelled",
    timeline: "Timeline",
    issueNoWebAssembly: "WebAssembly is not available.",
    issueNoWorker: "Web workers or blob workers are not available.",
    issueNotCrossOriginIsolated: "The page is not cross-origin isolated, so SharedArrayBuffer cannot be used.",
    issueNoSharedArrayBuffer: "SharedArrayBuffer is not available.",
    issueWalletWebView: "The wallet web view may block the isolation required by o1js.",
    issueMobileLimitedMemory: "This mobile device may have limited memory/CPU for proving."
  },
  fr: {
    walletPrompt: "Connecte ton wallet pour commencer.",
    noPseudo: "Non configure",
    player: "Joueur",
    pseudo: "Pseudo",
    network: "Reseau",
    connectWallet: "Connecter wallet",
    disconnectWallet: "Deconnecter",
    walletConnected: "Wallet connecte",
    newChallenge: "Nouveau defi",
    stake: "Mise en MINA",
    refundTimeout: "Timeout refund (slots)",
    create: "Creer",
    games: "Parties",
    allStatuses: "Tous les etats",
    allNetworks: "Tous les reseaux",
    searchPlayer: "Rechercher joueur",
    previous: "Precedent",
    next: "Suivant",
    page: "Page",
    draw: "Egalite",
    indexed: "indexees",
    challenge: "Defi",
    creator: "Createur",
    opponent: "Adversaire",
    waiting: "En attente",
    transaction: "Transaction",
    refund: "Refund",
    currentSlot: "Slot courant",
    notConfigured: "Non configure",
    onchainState: "Etat on-chain",
    signaturePending: "Signature envoyee ou en attente de hash",
    creationFailed: "Creation echouee on-chain",
    waitingCreation: "En attente de confirmation creation",
    waitingJoin: "En attente de confirmation join",
    joinPending: "Transaction join en attente",
    confirmJoin: "Confirmer join",
    releaseJoin: "Liberer join",
    actionsAvailable: "Actions disponibles selon l'etat de partie",
    enterHash: "Renseigner le hash",
    resignCreation: "Resigner",
    markFailed: "Marquer echouee",
    markIncluded: "Marquer incluse",
    confirmIncluded: "Marquer cette transaction comme incluse ? A faire uniquement apres verification dans l'explorateur.",
    transactionIncluded: "Transaction marquee comme incluse.",
    join: "Rejoindre",
    reveal: "Reveler",
    settle: "Regler",
    refundedGame: "Partie remboursee",
    failedGame: "Creation echouee",
    noLockedFunds: "Aucun fonds n'a ete verrouille par le contrat.",
    emptyGames: "Aucune partie pour le moment.",
    choosePseudo: "Choisir un pseudo",
    editPseudo: "Modifier le pseudo",
    pseudoNotice: "Ce pseudo sera associe a ton wallet dans la base locale.",
    save: "Enregistrer",
    zkWorkNotice: "La compilation et la generation de preuve peuvent prendre un moment dans le navigateur.",
    elapsed: "Temps ecoule",
    refresh: "Rafraichir",
    walletMissing: "Wallet Mina introuvable. Installe Auro ou active l'extension.",
    noWalletAccount: "Aucun compte retourne par le wallet.",
    walletFound: "Wallet connecte. Pseudo retrouve :",
    choosePseudoMessage: "Wallet connecte. Choisis un pseudo pour enregistrer cette adresse.",
    pseudoSaved: "Pseudo enregistre :",
    pseudoUpdated: "Pseudo modifie :",
    creatorOnlyHash: "Seul le createur peut renseigner le hash de creation.",
    pasteCreationHash: "Colle le hash de la transaction de creation visible dans Auro ou l'explorateur.",
    hashSaved: "Hash de creation renseigne. La synchronisation on-chain va etre verifiee.",
    resignCreationConfirm: "Avant de resigner, verifie Auro ou l'explorateur. Si la transaction existe deja, colle plutot son hash. Resigner maintenant ?",
    creationMaterialMissing: "Les donnees locales de creation sont manquantes. Colle le hash si la transaction existe, ou cree un nouveau defi.",
    creationResigned: "Transaction de creation signee a nouveau et indexee.",
    creatorOnlyFailed: "Seul le createur peut marquer cette creation comme echouee.",
    confirmFailed: "Marquer cette creation comme echouee ? A utiliser uniquement si la transaction create est failed sur l'explorateur.",
    optionalReason: "Raison optionnelle",
    failedReasonDefault: "Create transaction failed on-chain",
    markedFailed: "Creation marquee comme echouee. La partie est exclue de la racine Merkle locale.",
    walletAndPseudoRequired: "Pseudo et wallet requis.",
    createdOnchain: "Defi cree on-chain et indexe.",
    createdMock: "Defi cree en mode simulation.",
    cannotJoinOwn: "Tu ne peux pas rejoindre ton propre defi.",
    incompatibleOnchain: "Partie non compatible on-chain.",
    joinedOnchain: "Defi rejoint on-chain. Les deux joueurs peuvent reveler.",
    joinPendingMessage: "Transaction join envoyee. En attente d'inclusion on-chain avant reveal.",
    joinConfirmed: "Join confirme. Les deux joueurs peuvent reveler.",
    joinReleased: "Join en attente libere. Le defi est de nouveau ouvert.",
    joinFailedReason: "Transaction join echouee ou non incluse.",
    joinedMock: "Defi rejoint en mode simulation.",
    walletSecretRequired: "Wallet et secret requis.",
    bothSecretsRequired: "Les deux secrets doivent etre reveles.",
    bothRevealed: "Les deux secrets sont reveles. Resultat calcule localement; le settlement fera verifier et payer on-chain.",
    waitingOtherReveal: "Secret revele. En attente du reveal de l'autre joueur.",
    incompleteSettlement: "Partie incomplete pour settlement on-chain.",
    settledOnchain: "Partie reglee on-chain et indexee.",
    settledMock: "Partie reglee en mode simulation.",
    walletRequired: "Wallet requis.",
    refundNotReady: "Le timeout doit etre atteint et les transactions create/join doivent etre incluses avant un refund.",
    playerOnlyRefund: "Seul un joueur de cette partie peut demander le refund.",
    incompleteRefund: "Partie incomplete pour refund on-chain.",
    refundSent: "Refund envoye on-chain et indexe.",
    refundMock: "Partie remboursee en mode simulation.",
    invalidRefundTimeout: "Le timeout de refund doit etre un nombre entier positif.",
    activeAfterSlot: "actif apres le slot",
    minaZkDice: "Mina / Zeko zk dice",
    provingCompatibilityTitle: "La preuve ZK risque de ne pas fonctionner dans ce navigateur",
    provingCompatibilityIntro: "Cet environnement ne peut pas compiler le circuit de maniere fiable.",
    provingCompatibilityAdvice: "Ouvre zkroll dans un navigateur complet compatible COOP/COEP, ou utilise desktop.",
    openInBrowser: "Ouvrir dans le navigateur",
    copyPageUrl: "Copier l'URL",
    openAuro: "Ouvrir Auro",
    cancel: "Annuler",
    copyWalletConnectUri: "Copier l'URI WalletConnect",
    walletConnectPrompt: "Valide la demande WalletConnect dans Auro, puis reviens ici.",
    walletConnectNotConfigured: "WalletConnect mobile n'est pas configure. Renseigne VITE_WALLETCONNECT_PROJECT_ID.",
    createdAt: "Creee",
    updatedAt: "Mise a jour",
    joinedAt: "Rejointe",
    creatorRevealedAt: "Reveal createur",
    joinerRevealedAt: "Reveal adversaire",
    settledAt: "Reglee",
    refundedAt: "Remboursee",
    failedAt: "Echouee",
    cancelledAt: "Annulee",
    timeline: "Chronologie",
    issueNoWebAssembly: "WebAssembly n'est pas disponible.",
    issueNoWorker: "Les web workers ou blob workers ne sont pas disponibles.",
    issueNotCrossOriginIsolated: "La page n'est pas cross-origin isolated, donc SharedArrayBuffer ne peut pas etre utilise.",
    issueNoSharedArrayBuffer: "SharedArrayBuffer n'est pas disponible.",
    issueWalletWebView: "La web view du wallet peut bloquer l'isolation requise par o1js.",
    issueMobileLimitedMemory: "Cet appareil mobile peut manquer de memoire/CPU pour generer une preuve."
  }
};

const provingIssueCopyKey: Record<ProvingCompatibilityIssueCode, string> = {
  noWebAssembly: "issueNoWebAssembly",
  noWorker: "issueNoWorker",
  notCrossOriginIsolated: "issueNotCrossOriginIsolated",
  noSharedArrayBuffer: "issueNoSharedArrayBuffer",
  walletWebView: "issueWalletWebView",
  mobileLimitedMemory: "issueMobileLimitedMemory"
};

function DiceFace({ value }: { value: number | "?" }) {
  const pips: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };

  const visiblePips = value === "?" ? [] : (pips[value] ?? []);

  return (
    <span className="dieFace">
      {value === "?"
        ? "?"
        : Array.from({ length: 9 }, (_, index) => (
            <i key={index} className={visiblePips.includes(index) ? "pip visible" : "pip"} />
          ))}
    </span>
  );
}

function formatMina(value: string): string {
  return (Number(value) / nanoMina).toLocaleString("fr-FR", {
    maximumFractionDigits: 3
  });
}

function formatDateTime(value: string | null | undefined, locale: Locale): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

type PendingCreationMaterial = {
  zkappPrivateKey: string;
  secret: string;
  createdAt: string;
};

function pendingCreationStorageKey(gameId: string, creatorPublicKey: string) {
  return `zkroll:pending-creation:${gameId}:${creatorPublicKey}`;
}

function loadPendingCreationMaterial(game: Game, publicKey: string): PendingCreationMaterial | null {
  if (!publicKey || game.creatorPublicKey !== publicKey) return null;
  try {
    const value = localStorage.getItem(pendingCreationStorageKey(game.id, publicKey));
    return value ? (JSON.parse(value) as PendingCreationMaterial) : null;
  } catch {
    return null;
  }
}

function savePendingCreationMaterial(game: Game, secret: string, zkappPrivateKey: string) {
  localStorage.setItem(
    pendingCreationStorageKey(game.id, game.creatorPublicKey),
    JSON.stringify({ zkappPrivateKey, secret, createdAt: new Date().toISOString() } satisfies PendingCreationMaterial)
  );
}

function removePendingCreationMaterial(game: Game) {
  localStorage.removeItem(pendingCreationStorageKey(game.id, game.creatorPublicKey));
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem("zkroll:locale") === "fr" ? "fr" : "en"));
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("zkroll:theme") === "dark" ? "dark" : "light"));
  const [pseudo, setPseudo] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [pseudoDraft, setPseudoDraft] = useState("");
  const [pseudoModalOpen, setPseudoModalOpen] = useState(false);
  const [network, setNetwork] = useState<NetworkId>("devnet");
  const [stake, setStake] = useState("1");
  const [refundTimeoutSlots, setRefundTimeoutSlots] = useState(String(defaultRefundTimeoutSlots));
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>("all");
  const [playerSearch, setPlayerSearch] = useState("");
  const [gamesPage, setGamesPage] = useState(1);
  const [secretVault, setSecretVault] = useState<Record<string, string>>({});
  const [rollingGameId, setRollingGameId] = useState<string | null>(null);
  const [previewDice, setPreviewDice] = useState<Record<string, { creatorDie: number; joinerDie: number }>>({});
  const [rollFrames, setRollFrames] = useState<Record<string, { creatorDie: number; joinerDie: number }>>({});
  const [busy, setBusy] = useState(false);
  const [onchainProgress, setOnchainProgress] = useState<OnchainProgress | null>(null);
  const [onchainStartedAt, setOnchainStartedAt] = useState<number | null>(null);
  const [onchainElapsedSeconds, setOnchainElapsedSeconds] = useState(0);
  const [txStatuses, setTxStatuses] = useState<Record<string, TxStatus>>({});
  const txStatusesRef = useRef(txStatuses);
  const [currentSlots, setCurrentSlots] = useState<Record<NetworkId, string | null>>({
    mainnet: null,
    devnet: null,
    zeko: null
  });
  const [provingCompatibility, setProvingCompatibility] = useState<ProvingCompatibility | null>(null);
  const [walletConnectPrompt, setWalletConnectPrompt] = useState<WalletConnectPrompt | null>(null);
  const t = (key: string) => copy[locale][key] ?? copy.en[key] ?? key;
  const [message, setMessage] = useState(() => copy.en.walletPrompt);

  const visibleGames = useMemo(
    () => games.filter((game) => game.status !== "pending_signature" || game.creatorPublicKey === publicKey),
    [games, publicKey]
  );

  const filteredGames = useMemo(() => {
    const needle = playerSearch.trim().toLowerCase();
    return visibleGames
      .filter((game) => {
        const statusMatches = statusFilter === "all" || game.status === statusFilter;
        const networkMatches = networkFilter === "all" || game.network === networkFilter;
        const searchMatches =
          !needle ||
          game.creatorPseudo.toLowerCase().includes(needle) ||
          (game.joinerPseudo?.toLowerCase().includes(needle) ?? false);
        return statusMatches && networkMatches && searchMatches;
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [networkFilter, playerSearch, statusFilter, visibleGames]);

  const totalGamePages = Math.max(1, Math.ceil(filteredGames.length / gamesPerPage));
  const paginatedGames = useMemo(
    () => filteredGames.slice((gamesPage - 1) * gamesPerPage, gamesPage * gamesPerPage),
    [filteredGames, gamesPage]
  );

  const selectedGame = useMemo(
    () => filteredGames.find((game) => game.id === selectedGameId) ?? filteredGames[0] ?? null,
    [filteredGames, selectedGameId]
  );

  const selectedGameTxs = useMemo(() => {
    if (!selectedGame) return [];
    return [
      { network: selectedGame.network, hash: selectedGame.creationTxHash },
      { network: selectedGame.network, hash: selectedGame.joinTxHash },
      { network: selectedGame.network, hash: selectedGame.settlementTxHash },
      { network: selectedGame.network, hash: selectedGame.refundTxHash }
    ].filter((item): item is { network: NetworkId; hash: string } => Boolean(item.hash) && isExplorerHash(item.hash));
  }, [selectedGame]);

  async function refreshGames() {
    const nextGames = await listGames();
    setGames(nextGames);
    setTxStatuses((current) => {
      const fromGames = Object.fromEntries(
        nextGames.flatMap((game) =>
          [
            [game.creationTxHash, game.creationTxStatus],
            [game.joinTxHash, game.joinTxStatus],
            [game.settlementTxHash, game.settlementTxStatus],
            [game.refundTxHash, game.refundTxStatus]
          ].filter((item): item is [string, TxStatus] => Boolean(item[0]) && Boolean(item[1]))
        )
      );
      return { ...current, ...fromGames };
    });
    const nextVisibleGames = nextGames.filter((game) => game.status !== "pending_signature" || game.creatorPublicKey === publicKey);
    if (!selectedGameId && nextVisibleGames[0]) setSelectedGameId(nextVisibleGames[0].id);
  }

  function statusFor(hash: string | null | undefined): TxStatus {
    if (!onchainEnabled) return "INCLUDED";
    if (
      !hash ||
      hash.startsWith("pending:") ||
      hash.startsWith("fake") ||
      hash.startsWith("create_") ||
      hash.startsWith("join_") ||
      hash.startsWith("settle_") ||
      hash.startsWith("refund_")
    ) {
      return "UNKNOWN";
    }
    return txStatuses[hash] ?? "PENDING";
  }

  function isTerminalTxStatus(status: TxStatus | undefined) {
    return status === "INCLUDED" || status === "FAILED";
  }

  function isExplorerHash(hash: string | null | undefined) {
    return Boolean(
      hash &&
        !hash.startsWith("pending:") &&
        !hash.startsWith("fake") &&
        !hash.startsWith("create_") &&
        !hash.startsWith("join_") &&
        !hash.startsWith("settle_") &&
        !hash.startsWith("refund_")
    );
  }

  function txExplorerUrl(networkId: NetworkId, hash: string) {
    return `${networks[networkId].explorerBaseUrl}/${encodeURIComponent(hash)}`;
  }

  function accountExplorerUrl(networkId: NetworkId, address: string) {
    if (networkId === "zeko") return `https://zekoscan.io/account/${encodeURIComponent(address)}`;
    return `https://minascan.io/${networkId}/account/${encodeURIComponent(address)}/zk-txs`;
  }

  function displayTx(networkId: NetworkId, hash: string | null | undefined, status?: TxStatus) {
    if (!hash) return null;
    const content = isExplorerHash(hash) ? (
      <a className="hashLink" href={txExplorerUrl(networkId, hash)} rel="noreferrer" target="_blank">
        {hash}
      </a>
    ) : (
      <span>{hash}</span>
    );

    return (
      <span className="txLine">
        {content}
        {status && <span className={`txBadge ${status.toLowerCase()}`}>{status}</span>}
        {status === "PENDING" && isExplorerHash(hash) && (
          <button
            className="txAction"
            disabled={busy}
            onClick={() => void handleMarkTransactionIncluded(networkId, hash)}
            type="button"
          >
            {t("markIncluded")}
          </button>
        )}
      </span>
    );
  }

  function resultIconFor(game: Game, player: "creator" | "joiner") {
    if (game.status === "refunded") return <RotateCcw className="resultIcon mutedIcon" size={16} />;
    if (game.status !== "settled") return null;
    if (!game.winnerPublicKey) return <CircleEqual className="resultIcon mutedIcon" size={16} />;
    const playerKey = player === "creator" ? game.creatorPublicKey : game.joinerPublicKey;
    return playerKey === game.winnerPublicKey ? <Trophy className="resultIcon winnerIcon" size={16} /> : null;
  }

  function shouldPollGame(game: Game) {
    return game.status !== "settled" && game.status !== "refunded" && game.status !== "failed";
  }

  function creationStatusFor(game: Game): TxStatus {
    return game.status === "failed" ? "FAILED" : statusFor(game.creationTxHash);
  }

  function canJoin(game: Game): boolean {
    return game.status === "created" && creationStatusFor(game) === "INCLUDED";
  }

  function canReveal(game: Game): boolean {
    return (
      (game.status === "joined" || game.status === "player_one_revealed" || game.status === "player_two_revealed") &&
      statusFor(game.creationTxHash) === "INCLUDED" &&
      statusFor(game.joinTxHash) === "INCLUDED"
    );
  }

  function canConfirmJoin(game: Game): boolean {
    return game.status === "join_pending" && statusFor(game.joinTxHash) === "INCLUDED";
  }

  function canSettle(game: Game): boolean {
    return Boolean(game.creatorReveal && game.joinerReveal && canReveal(game));
  }

  function canRefund(game: Game): boolean {
    const currentSlot = currentSlots[game.network];
    const deadlineReached =
      !onchainEnabled ||
      (Boolean(currentSlot) && Boolean(game.refundDeadlineSlot) && BigInt(currentSlot!) >= BigInt(game.refundDeadlineSlot!));
    const joinedLike =
      game.status === "joined" || game.status === "player_one_revealed" || game.status === "player_two_revealed";
      if (game.status === "created") {
      return deadlineReached && creationStatusFor(game) === "INCLUDED";
    }
    return (
      deadlineReached &&
      joinedLike &&
      creationStatusFor(game) === "INCLUDED" &&
      statusFor(game.joinTxHash) === "INCLUDED"
    );
  }

  function normalizedRefundTimeout() {
    const value = Number(refundTimeoutSlots);
    if (!Number.isInteger(value) || value < 1) throw new Error(t("invalidRefundTimeout"));
    return value;
  }

  useEffect(() => {
    void refreshGames();
    const savedVault = localStorage.getItem("zkroll:secrets");
    if (savedVault) {
      setSecretVault(JSON.parse(savedVault) as Record<string, string>);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("zkroll:locale", locale);
  }, [locale]);

  useEffect(() => {
    setGamesPage(1);
  }, [networkFilter, playerSearch, statusFilter]);

  useEffect(() => {
    setGamesPage((current) => Math.min(current, totalGamePages));
  }, [totalGamePages]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("zkroll:theme", theme);
  }, [theme]);

  useEffect(() => {
    setProvingCompatibility(getProvingCompatibility());
  }, []);

  useEffect(() => {
    setWalletConnectPromptHandler(setWalletConnectPrompt);
    return () => setWalletConnectPromptHandler(null);
  }, []);

  useEffect(() => {
    txStatusesRef.current = txStatuses;
  }, [txStatuses]);

  useEffect(() => {
    if (!onchainEnabled || selectedGameTxs.length === 0) return;

    let cancelled = false;
    const poll = async () => {
      const unique = Array.from(new Map(selectedGameTxs.map((item) => [item.hash, item])).values()).filter(
        (item) => !isTerminalTxStatus(txStatusesRef.current[item.hash])
      );
      if (unique.length === 0) return;

      let nextStatuses: Record<string, TxStatus> = {};
      try {
        const result = await getTransactionStatuses(unique);
        nextStatuses = Object.fromEntries(result.items.map((item) => [item.hash, item.status]));
      } catch {
        nextStatuses = Object.fromEntries(unique.map((item) => [item.hash, "UNKNOWN"]));
      }

      if (!cancelled) {
        const hasNewTerminal = Object.entries(nextStatuses).some(
          ([hash, status]) => isTerminalTxStatus(status) && txStatusesRef.current[hash] !== status
        );
        setTxStatuses((current) => ({ ...current, ...nextStatuses }));
        if (hasNewTerminal) {
          void refreshGames();
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), txPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedGameTxs]);

  useEffect(() => {
    if (!onchainEnabled || !selectedGame) return;

    let cancelled = false;
    const poll = async () => {
      const nextSlots = await Promise.all(
        [selectedGame.network].map(async (item) => {
          try {
            const result = await getCurrentSlot(item);
            return [item, result.currentSlot] as const;
          } catch {
            return [item, null] as const;
          }
        })
      );

      if (!cancelled) {
        setCurrentSlots((current) => ({ ...current, ...Object.fromEntries(nextSlots) }));
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), slotPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedGame?.network]);

  useEffect(() => {
    if (!onchainProgress || !onchainStartedAt) {
      setOnchainElapsedSeconds(0);
      return;
    }

    const tick = () => {
      setOnchainElapsedSeconds(Math.max(0, Math.floor((Date.now() - onchainStartedAt) / 1000)));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [onchainProgress, onchainStartedAt]);

  function rememberSecret(gameId: string, secret: string) {
    if (!publicKey) return;
    setSecretVault((vault) => {
      const nextVault = { ...vault, [secretKey(gameId, publicKey)]: secret };
      localStorage.setItem("zkroll:secrets", JSON.stringify(nextVault));
      return nextVault;
    });
  }

  function secretKey(gameId: string, playerPublicKey: string) {
    return `${gameId}:${playerPublicKey}`;
  }

  function secretFor(game: Game) {
    if (!publicKey) return undefined;
    return secretVault[secretKey(game.id, publicKey)] ?? secretVault[game.id];
  }

  async function computeDice(game: Game) {
    if (!game.creatorReveal || !game.joinerReveal) {
      throw new Error(t("bothSecretsRequired"));
    }

    const gameIdField = game.gameIdField ?? game.id;
    return onchainEnabled
      ? diceOutcomeOnchain(game.creatorReveal, game.joinerReveal, gameIdField)
      : {
          creatorDie: await temporaryDie(game.creatorReveal, game.joinerReveal, game.id, "1"),
          joinerDie: await temporaryDie(game.joinerReveal, game.creatorReveal, game.id, "2")
        };
  }

  async function animateDice(gameId: string, creatorDie: number, joinerDie: number) {
    setRollingGameId(gameId);
    for (let frame = 0; frame < 14; frame += 1) {
      setRollFrames({
        [gameId]: {
          creatorDie: 1 + Math.floor(Math.random() * 6),
          joinerDie: 1 + Math.floor(Math.random() * 6)
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 90 + frame * 8));
    }
    setRollFrames({ [gameId]: { creatorDie, joinerDie } });
    setPreviewDice({ [gameId]: { creatorDie, joinerDie } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRollingGameId(null);
  }

  async function connectWallet() {
    if (!window.mina && walletConnectConfigured()) {
      setWalletConnectNetwork(network);
    }
    const provider = window.mina ?? (mobileBrowserCanUseWalletConnect() ? walletConnectProvider() : undefined);
    if (!provider) {
      if (!window.mina && !walletConnectConfigured()) {
        setMessage(t("walletConnectNotConfigured"));
        return;
      }
      setMessage(t("walletMissing"));
      return;
    }

    let accounts: string[];
    try {
      accounts = await provider.requestAccounts();
    } catch (error) {
      const errorMessage = (error as Error).message;
      setMessage(errorMessage === "WalletConnect cancelled." ? t("walletPrompt") : errorMessage);
      return;
    }
    const account = accounts[0] ?? "";
    setPublicKey(account);
    if (!account) {
      setMessage(t("noWalletAccount"));
      return;
    }

    try {
      await ensureWalletNetwork(provider, network);
    } catch (error) {
      setMessage((error as Error).message);
      return;
    }

    try {
      const player = await getPlayerByPublicKey(account);
      setPseudo(player.pseudo);
      setPseudoModalOpen(false);
      setMessage(`${t("walletFound")} ${player.pseudo}.`);
    } catch {
      setPseudoDraft("");
      setPseudoModalOpen(true);
      setMessage(t("choosePseudoMessage"));
    }
  }

  async function disconnectWallet() {
    if (!window.mina && walletConnectConfigured()) {
      try {
        await disconnectWalletConnect();
      } catch (error) {
        setMessage((error as Error).message);
      }
    }
    setPublicKey("");
    setPseudo("");
    setPseudoDraft("");
    setPseudoModalOpen(false);
    setWalletConnectPrompt(null);
    setMessage(t("walletPrompt"));
  }

  async function savePseudo(event: FormEvent) {
    event.preventDefault();
    if (!publicKey) return;
    const player = await createPlayer({ pseudo: pseudoDraft.trim(), publicKey });
    const wasEditing = Boolean(pseudo);
    setPseudo(player.pseudo);
    setPseudoModalOpen(false);
    setMessage(`${wasEditing ? t("pseudoUpdated") : t("pseudoSaved")} ${player.pseudo}.`);
  }

  function openPseudoEditor() {
    if (!publicKey) return;
    setPseudoDraft(pseudo);
    setPseudoModalOpen(true);
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setOnchainProgress(null);
    setOnchainStartedAt(null);
    try {
      await action();
      await refreshGames();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
      setOnchainProgress(null);
      setOnchainStartedAt(null);
    }
  }

  function updateOnchainProgress(progress: OnchainProgress) {
    setOnchainStartedAt((startedAt) => startedAt ?? Date.now());
    setOnchainProgress(progress);
  }

  function walletProvider() {
    if (!window.mina && walletConnectConfigured()) {
      setWalletConnectNetwork(network);
    }
    return window.mina ?? (mobileBrowserCanUseWalletConnect() ? walletConnectProvider() : undefined);
  }

  async function handleReconcileCreation(game: Game) {
    await runAction(async () => {
      if (game.creatorPublicKey !== publicKey) {
        throw new Error(t("creatorOnlyHash"));
      }
      const txHash = window.prompt(t("pasteCreationHash"));
      if (!txHash?.trim()) return;
      const reconciled = await reconcileCreationTx(game.id, requiredTransactionHash(txHash));
      removePendingCreationMaterial(reconciled);
      setSelectedGameId(reconciled.id);
      setMessage(t("hashSaved"));
    });
  }

  async function handleResignCreation(game: Game) {
    await runAction(async () => {
      if (game.creatorPublicKey !== publicKey) {
        throw new Error(t("creatorOnlyHash"));
      }
      if (!onchainEnabled || !game.gameIdField || !game.refundDeadlineSlot) {
        throw new Error(t("incompatibleOnchain"));
      }
      const material = loadPendingCreationMaterial(game, publicKey);
      if (!material) {
        throw new Error(t("creationMaterialMissing"));
      }
      const confirmed = window.confirm(t("resignCreationConfirm"));
      if (!confirmed) return;
      const result = await createGameOnchain({
        provider: walletProvider(),
        network: game.network,
        senderPublicKey: publicKey,
        zkappPrivateKey: material.zkappPrivateKey,
        gameId: game.id,
        pseudo: game.creatorPseudo,
        secret: material.secret,
        gameIdField: game.gameIdField,
        stakeNanoMina: game.stakeNanoMina,
        refundDeadlineSlot: game.refundDeadlineSlot,
        onProgress: updateOnchainProgress
      });
      const reconciled = await reconcileCreationTx(game.id, result.txHash);
      removePendingCreationMaterial(reconciled);
      rememberSecret(reconciled.id, material.secret);
      setSelectedGameId(reconciled.id);
      setMessage(t("creationResigned"));
    });
  }

  async function handleMarkCreationFailed(game: Game) {
    await runAction(async () => {
      if (game.creatorPublicKey !== publicKey) {
        throw new Error(t("creatorOnlyFailed"));
      }
      const confirmed = window.confirm(t("confirmFailed"));
      if (!confirmed) return;
      const reason =
        window.prompt(t("optionalReason"), t("failedReasonDefault")) ?? t("failedReasonDefault");
      const failed = await markCreationFailed(game.id, reason.trim() || undefined);
      removePendingCreationMaterial(failed);
      setSelectedGameId(failed.id);
      setMessage(t("markedFailed"));
    });
  }

  async function handleMarkTransactionIncluded(networkId: NetworkId, hash: string) {
    await runAction(async () => {
      const confirmed = window.confirm(t("confirmIncluded"));
      if (!confirmed) return;
      const result = await markTransactionIncluded(networkId, hash);
      setTxStatuses((current) => ({ ...current, [hash]: result.status }));
      setMessage(t("transactionIncluded"));
    });
  }

  async function handleCreateGame() {
    await runAction(async () => {
      if (!pseudo || !publicKey) throw new Error(t("walletAndPseudoRequired"));
      const secret = randomFieldString();
      const gameIdField = randomFieldString();
      const creatorPseudoHash = onchainEnabled ? await pseudoHash(pseudo) : undefined;
      const creatorCommitment = onchainEnabled
        ? await onchainCommitment(secret, publicKey, gameIdField)
        : await temporaryCommitment(secret, publicKey, `${pseudo}:${Date.now()}`);
      const stakeNanoMina = String(Math.round(Number(stake) * nanoMina));
      const refundTimeout = normalizedRefundTimeout();
      const refundDeadlineSlot = onchainEnabled ? await nextRefundDeadlineSlot(network, refundTimeout) : "0";
      let txHash = fakeTxHash("create");
      const gameKey = onchainEnabled ? await generateGameZkappKey() : null;
      const created = await createGame({
        id: gameIdField.slice(0, 12),
        network,
        zkappAddress: gameKey?.address,
        gameIdField,
        creatorPseudo: pseudo,
        creatorPublicKey: publicKey,
        creatorPseudoHash,
        stakeNanoMina,
        creatorCommitment,
        refundTimeoutSlots: refundTimeout,
        refundDeadlineSlot,
        creationTxHash: onchainEnabled ? undefined : txHash
      });
      rememberSecret(created.id, secret);
      if (onchainEnabled && gameKey) {
        savePendingCreationMaterial(created, secret, gameKey.privateKey);
      }
      setSelectedGameId(created.id);

      if (onchainEnabled) {
        const result = await createGameOnchain({
          provider: walletProvider(),
          network,
          senderPublicKey: publicKey,
          zkappPrivateKey: gameKey!.privateKey,
          gameId: created.id,
          pseudo,
          secret,
          gameIdField,
          stakeNanoMina,
          refundDeadlineSlot,
          onProgress: updateOnchainProgress
        });
        txHash = result.txHash;
        const reconciled = await reconcileCreationTx(created.id, txHash);
        removePendingCreationMaterial(reconciled);
        setSelectedGameId(reconciled.id);
      }

      setMessage(onchainEnabled ? t("createdOnchain") : t("createdMock"));
    });
  }

  async function handleJoinGame(game: Game) {
    await runAction(async () => {
      if (!pseudo || !publicKey) throw new Error(t("walletAndPseudoRequired"));
      if (game.creatorPublicKey === publicKey) throw new Error(t("cannotJoinOwn"));
      const secret = randomFieldString();
      const gameIdField = game.gameIdField ?? game.id;
      const joinerPseudoHash = onchainEnabled ? await pseudoHash(pseudo) : undefined;
      const joinerCommitment = onchainEnabled
        ? await onchainCommitment(secret, publicKey, gameIdField)
        : await temporaryCommitment(secret, publicKey, game.id);
      const refundDeadlineSlot = onchainEnabled ? await nextRefundDeadlineSlot(game.network, game.refundTimeoutSlots) : "0";
      let txHash = fakeTxHash("join");

      if (onchainEnabled) {
        if (!game.gameIdField || !game.creatorPseudoHash || !game.refundDeadlineSlot || !game.zkappAddress) throw new Error(t("incompatibleOnchain"));
        txHash = await joinGameOnchain({
          provider: walletProvider(),
          network: game.network,
          senderPublicKey: publicKey,
          pseudo,
          secret,
          gameIdField: game.gameIdField,
          zkappAddress: game.zkappAddress,
          creatorPublicKey: game.creatorPublicKey,
          creatorPseudoHash: game.creatorPseudoHash,
          stakeNanoMina: game.stakeNanoMina,
          creatorCommitment: game.creatorCommitment,
          currentRefundDeadlineSlot: game.refundDeadlineSlot,
          nextRefundDeadlineSlot: refundDeadlineSlot,
          onProgress: updateOnchainProgress
        });
      }

      const joined = await joinGame(game.id, {
        joinerPseudo: pseudo,
        joinerPublicKey: publicKey,
        joinerPseudoHash,
        joinerCommitment,
        refundDeadlineSlot,
        joinTxHash: txHash
      });
      const indexedGame = onchainEnabled ? joined : await confirmJoinGame(joined.id);
      rememberSecret(indexedGame.id, secret);
      setSelectedGameId(indexedGame.id);
      setMessage(onchainEnabled ? t("joinPendingMessage") : t("joinedMock"));
    });
  }

  async function handleConfirmJoin(game: Game) {
    await runAction(async () => {
      if (!canConfirmJoin(game)) throw new Error(t("waitingJoin"));
      const confirmed = await confirmJoinGame(game.id);
      setSelectedGameId(confirmed.id);
      setMessage(t("joinConfirmed"));
    });
  }

  async function handleReleaseJoin(game: Game) {
    await runAction(async () => {
      if (game.status !== "join_pending") return;
      const confirmed = window.confirm(t("releaseJoin"));
      if (!confirmed) return;
      const released = await failPendingJoin(game.id, t("joinFailedReason"));
      setSelectedGameId(released.id);
      setMessage(t("joinReleased"));
    });
  }

  async function handleReveal(game: Game) {
    await runAction(async () => {
      const secret = secretFor(game);
      if (!publicKey || !secret) throw new Error(t("walletSecretRequired"));
      const updatedGame = await revealGame(game.id, { publicKey, secret });
      if (updatedGame.creatorReveal && updatedGame.joinerReveal) {
        const { creatorDie, joinerDie } = await computeDice(updatedGame);
        await animateDice(updatedGame.id, creatorDie, joinerDie);
        setMessage(t("bothRevealed"));
      } else {
        setMessage(t("waitingOtherReveal"));
      }
    });
  }

  async function handleSettle(game: Game) {
    await runAction(async () => {
      if (!game.creatorReveal || !game.joinerReveal) {
        throw new Error(t("bothSecretsRequired"));
      }

      const { creatorDie, joinerDie } = await computeDice(game);
      if (!previewDice[game.id]) {
        await animateDice(game.id, creatorDie, joinerDie);
      }
      const winnerPublicKey =
        creatorDie > joinerDie ? game.creatorPublicKey : joinerDie > creatorDie ? game.joinerPublicKey : null;
      let txHash = fakeTxHash("settle");

      if (onchainEnabled) {
        if (
          !game.gameIdField ||
          !game.zkappAddress ||
          !game.creatorPseudoHash ||
          !game.joinerPseudoHash ||
          !game.joinerPublicKey ||
          !game.joinerCommitment ||
          !game.refundDeadlineSlot
        ) {
          throw new Error(t("incompleteSettlement"));
        }
        txHash = await settleGameOnchain({
          provider: walletProvider(),
          network: game.network,
          senderPublicKey: publicKey,
          gameIdField: game.gameIdField,
          zkappAddress: game.zkappAddress,
          creatorPublicKey: game.creatorPublicKey,
          creatorPseudoHash: game.creatorPseudoHash,
          joinerPublicKey: game.joinerPublicKey,
          joinerPseudoHash: game.joinerPseudoHash,
          stakeNanoMina: game.stakeNanoMina,
          creatorCommitment: game.creatorCommitment,
          joinerCommitment: game.joinerCommitment,
          creatorSecret: game.creatorReveal,
          joinerSecret: game.joinerReveal,
          winnerPublicKey,
          refundDeadlineSlot: game.refundDeadlineSlot,
          onProgress: updateOnchainProgress
        });
      }

      await settleGame(game.id, {
        creatorDie,
        joinerDie,
        winnerPublicKey,
        settlementTxHash: txHash
      });
      setMessage(onchainEnabled ? t("settledOnchain") : t("settledMock"));
    });
  }

  async function handleRefund(game: Game) {
    await runAction(async () => {
      if (!publicKey) throw new Error(t("walletRequired"));
      if (!canRefund(game)) throw new Error(t("refundNotReady"));
      if (game.creatorPublicKey !== publicKey && game.joinerPublicKey !== publicKey) {
        throw new Error(t("playerOnlyRefund"));
      }

      let txHash = fakeTxHash("refund");
      if (onchainEnabled) {
        if (!game.gameIdField || !game.zkappAddress || !game.creatorPseudoHash || !game.refundDeadlineSlot) {
          throw new Error(t("incompleteRefund"));
        }
        txHash = await refundGameOnchain({
          provider: walletProvider(),
          network: game.network,
          senderPublicKey: publicKey,
          status: game.status,
          gameIdField: game.gameIdField,
          zkappAddress: game.zkappAddress,
          creatorPublicKey: game.creatorPublicKey,
          creatorPseudoHash: game.creatorPseudoHash,
          joinerPublicKey: game.joinerPublicKey,
          joinerPseudoHash: game.joinerPseudoHash,
          stakeNanoMina: game.stakeNanoMina,
          creatorCommitment: game.creatorCommitment,
          joinerCommitment: game.joinerCommitment,
          refundDeadlineSlot: game.refundDeadlineSlot,
          onProgress: updateOnchainProgress
        });
      }

      await refundGame(game.id, { refundTxHash: txHash });
      setMessage(onchainEnabled ? t("refundSent") : t("refundMock"));
    });
  }

  return (
    <main className="shell">
      {pseudoModalOpen && (
        <div className="modalBackdrop">
          <form className="modal" onSubmit={(event) => void savePseudo(event)}>
            <h2>{pseudo ? t("editPseudo") : t("choosePseudo")}</h2>
            <p className="notice">{t("pseudoNotice")}</p>
            <label>
              {t("pseudo")}
              <input
                autoFocus
                value={pseudoDraft}
                onChange={(event) => setPseudoDraft(event.target.value)}
                placeholder={t("pseudo")}
              />
            </label>
            <button className="primary" disabled={!pseudoDraft.trim()} type="submit">
              {t("save")}
            </button>
          </form>
        </div>
      )}

      {walletConnectPrompt && (
        <div className="modalBackdrop">
          <div className="modal">
            <h2>WalletConnect</h2>
            <p className="notice">{t("walletConnectPrompt")}</p>
            <a className="primary actionLink" href={walletConnectPrompt.openUrl} rel="noreferrer">
              {t("openAuro")}
            </a>
            {walletConnectPrompt.uri && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(walletConnectPrompt.uri ?? "");
                }}
              >
                {t("copyWalletConnectUri")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                cancelWalletConnectPrompt();
                setMessage(t("walletPrompt"));
              }}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {onchainProgress && (
        <div className="workOverlay">
          <div className="workPanel">
            <h2>{onchainProgress.label}</h2>
            <div className="progress">
              <span style={{ width: `${onchainProgress.progress}%` }} />
            </div>
            <p className="notice">{t("zkWorkNotice")}</p>
            <p className="timer">{t("elapsed")}: {onchainElapsedSeconds}s</p>
          </div>
        </div>
      )}

      <section className="topbar">
        <div>
          <p className="eyebrow">{t("minaZkDice")}</p>
          <div className="brand">
            <img src="/zkroll-logo.svg" alt="" />
            <h1>zkroll</h1>
          </div>
        </div>
        <div className="topActions">
          <label className="compactSelect" title="Language">
            <Languages size={16} />
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              <option value="en">EN</option>
              <option value="fr">FR</option>
            </select>
          </label>
          <button
            className="iconButton"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Light" : "Dark"}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="iconButton" onClick={() => void refreshGames()} title={t("refresh")}>
            <RefreshCw size={18} />
          </button>
        </div>
      </section>

      {onchainEnabled && provingCompatibility && provingCompatibility.issues.length > 0 && (
        <section className={`compatibilityWarning ${provingCompatibility.ok ? "soft" : "hard"}`}>
          <AlertTriangle size={20} />
          <div>
            <strong>{t("provingCompatibilityTitle")}</strong>
            <p>{provingCompatibility.ok ? t("zkWorkNotice") : t("provingCompatibilityIntro")}</p>
            <ul>
              {provingCompatibility.issues.map((issue) => (
                <li key={issue.code}>{t(provingIssueCopyKey[issue.code])}</li>
              ))}
            </ul>
            {!provingCompatibility.ok && <p>{t("provingCompatibilityAdvice")}</p>}
            {!provingCompatibility.ok && provingCompatibility.isWalletWebView && (
              <div className="inlineActions">
                <a className="primary actionLink" href={externalBrowserUrl()} rel="noreferrer" target="_blank">
                  {t("openInBrowser")}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(window.location.href);
                  }}
                >
                  {t("copyPageUrl")}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="layout">
        <aside className="panel">
          <h2>{t("player")}</h2>
          <div className="identityBox">
            <div className="identityHead">
              <span>{t("pseudo")}</span>
              <button
                className="tinyIconButton"
                disabled={!publicKey}
                onClick={openPseudoEditor}
                title={t("editPseudo")}
                type="button"
              >
                <Pencil size={15} />
              </button>
            </div>
            <strong>{pseudo || t("noPseudo")}</strong>
          </div>
          <label>
            {t("network")}
            <select value={network} onChange={(event) => setNetwork(event.target.value as NetworkId)}>
              {Object.values(networks).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="walletActions">
            <button onClick={() => void connectWallet()} className="primary">
              <Wallet size={18} />
              {publicKey ? t("walletConnected") : t("connectWallet")}
            </button>
            {publicKey && (
              <button onClick={() => void disconnectWallet()} type="button">
                {t("disconnectWallet")}
              </button>
            )}
          </div>
          {publicKey && <p className="key">{publicKey}</p>}

          <h2>{t("newChallenge")}</h2>
          <label>
            {t("stake")}
            <input min="0.1" step="0.1" type="number" value={stake} onChange={(event) => setStake(event.target.value)} />
          </label>
          <label>
            {t("refundTimeout")}
            <input
              min="1"
              step="1"
              type="number"
              value={refundTimeoutSlots}
              onChange={(event) => setRefundTimeoutSlots(event.target.value)}
            />
          </label>
          <button disabled={busy || !pseudo || !publicKey} onClick={() => void handleCreateGame()} className="primary">
            <Dices size={18} />
            {t("create")}
          </button>
          <p className="notice">{message}</p>
        </aside>

        <section className="games">
          <div className="sectionHead">
            <h2>{t("games")}</h2>
            <span>{filteredGames.length} / {visibleGames.length} {t("indexed")}</span>
          </div>
          <div className="gameFilters">
            <label>
              {t("onchainState")}
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="all">{t("allStatuses")}</option>
                {gameStatuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("network")}
              <select value={networkFilter} onChange={(event) => setNetworkFilter(event.target.value as NetworkFilter)}>
                <option value="all">{t("allNetworks")}</option>
                {Object.values(networks).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("searchPlayer")}
              <span className="searchInput">
                <Search size={16} />
                <input
                  value={playerSearch}
                  onChange={(event) => setPlayerSearch(event.target.value)}
                  placeholder={t("pseudo")}
                />
              </span>
            </label>
          </div>
          <div className="gameList">
            {paginatedGames.map((game) => (
              <button
                key={game.id}
                className={game.id === selectedGame?.id ? "gameCard selected" : "gameCard"}
                onClick={() => setSelectedGameId(game.id)}
              >
                <span className={`status ${game.status}`}>{game.status}</span>
                <div className="playersLine">
                  <strong>
                    {game.creatorPseudo}
                    {resultIconFor(game, "creator")}
                  </strong>
                  <span>vs</span>
                  <strong>
                    {game.joinerPseudo ?? t("waiting")}
                    {game.joinerPseudo && resultIconFor(game, "joiner")}
                  </strong>
                </div>
                <div className="revealDots" aria-label={`${t("reveal")}: ${game.creatorReveal ? "1" : "0"} / ${game.joinerReveal ? "1" : "0"}`}>
                  <span className={game.creatorReveal ? "revealDot done" : "revealDot"} title={t("creatorRevealedAt")} />
                  <span className={game.joinerReveal ? "revealDot done" : "revealDot"} title={t("joinerRevealedAt")} />
                </div>
                <span>{formatMina(game.stakeNanoMina)} MINA</span>
                <small>{networks[game.network].label}</small>
                <small>{t("updatedAt")}: {formatDateTime(game.updatedAt, locale)}</small>
              </button>
            ))}
            {filteredGames.length === 0 && <p className="empty">{t("emptyGames")}</p>}
          </div>
          {filteredGames.length > gamesPerPage && (
            <div className="pagination">
              <button disabled={gamesPage === 1} onClick={() => setGamesPage((page) => Math.max(1, page - 1))}>
                {t("previous")}
              </button>
              <span>
                {t("page")} {gamesPage} / {totalGamePages}
              </span>
              <button
                disabled={gamesPage === totalGamePages}
                onClick={() => setGamesPage((page) => Math.min(totalGamePages, page + 1))}
              >
                {t("next")}
              </button>
            </div>
          )}
        </section>

        <section className="panel detail">
          {selectedGame ? (
            <>
              <div className="sectionHead">
                <h2>{t("challenge")} {selectedGame.id}</h2>
                <ShieldCheck size={20} />
              </div>
              <dl>
                <div>
                  <dt>{t("creator")}</dt>
                  <dd className="playerResult">
                    {selectedGame.creatorPseudo}
                    {resultIconFor(selectedGame, "creator")}
                  </dd>
                </div>
                <div>
                  <dt>{t("opponent")}</dt>
                  <dd className="playerResult">
                    {selectedGame.joinerPseudo ?? t("waiting")}
                    {selectedGame.joinerPseudo && resultIconFor(selectedGame, "joiner")}
                  </dd>
                </div>
                <div>
                  <dt>{t("stake")}</dt>
                  <dd>{formatMina(selectedGame.stakeNanoMina)} MINA</dd>
                </div>
                <div>
                  <dt>{t("timeline")}</dt>
                  <dd className="timeline">
                    <span>{t("createdAt")}: {formatDateTime(selectedGame.createdAt, locale)}</span>
                    {selectedGame.joinAt && <span>{t("joinedAt")}: {formatDateTime(selectedGame.joinAt, locale)}</span>}
                    {selectedGame.creatorRevealAt && (
                      <span>{t("creatorRevealedAt")}: {formatDateTime(selectedGame.creatorRevealAt, locale)}</span>
                    )}
                    {selectedGame.joinerRevealAt && (
                      <span>{t("joinerRevealedAt")}: {formatDateTime(selectedGame.joinerRevealAt, locale)}</span>
                    )}
                    {selectedGame.settledAt && <span>{t("settledAt")}: {formatDateTime(selectedGame.settledAt, locale)}</span>}
                    {selectedGame.refundedAt && <span>{t("refundedAt")}: {formatDateTime(selectedGame.refundedAt, locale)}</span>}
                    {selectedGame.failedAt && <span>{t("failedAt")}: {formatDateTime(selectedGame.failedAt, locale)}</span>}
                    {selectedGame.cancelledAt && <span>{t("cancelledAt")}: {formatDateTime(selectedGame.cancelledAt, locale)}</span>}
                    <span>{t("updatedAt")}: {formatDateTime(selectedGame.updatedAt, locale)}</span>
                  </dd>
                </div>
                <div>
                  <dt>{t("transaction")}</dt>
                  <dd>{displayTx(selectedGame.network, selectedGame.creationTxHash, creationStatusFor(selectedGame))}</dd>
                </div>
                {selectedGame.joinTxHash && (
                  <div>
                    <dt>Join tx</dt>
                    <dd>{displayTx(selectedGame.network, selectedGame.joinTxHash, statusFor(selectedGame.joinTxHash))}</dd>
                  </div>
                )}
                {selectedGame.settlementTxHash && (
                  <div>
                    <dt>Settlement tx</dt>
                    <dd>{displayTx(selectedGame.network, selectedGame.settlementTxHash, statusFor(selectedGame.settlementTxHash))}</dd>
                  </div>
                )}
                {selectedGame.refundTxHash && (
                  <div>
                    <dt>Refund tx</dt>
                    <dd>{displayTx(selectedGame.network, selectedGame.refundTxHash, statusFor(selectedGame.refundTxHash))}</dd>
                  </div>
                )}
                <div>
                  <dt>{t("refund")}</dt>
                  <dd>
                    {selectedGame.refundDeadlineSlot
                      ? `${selectedGame.refundTimeoutSlots} slots, ${t("activeAfterSlot")} ${selectedGame.refundDeadlineSlot}. ${t("currentSlot")}: ${
                          currentSlots[selectedGame.network] ?? "..."
                        }`
                      : t("notConfigured")}
                  </dd>
                </div>
                <div>
                  <dt>{t("onchainState")}</dt>
                  <dd>
                    {selectedGame.status === "pending_signature"
                      ? t("signaturePending")
                      : selectedGame.status === "failed"
                        ? selectedGame.failureReason ?? t("creationFailed")
                        : selectedGame.status === "created" && creationStatusFor(selectedGame) !== "INCLUDED"
                      ? t("waitingCreation")
                      : selectedGame.status === "join_pending"
                        ? t("joinPending")
                      : selectedGame.status === "joined" && statusFor(selectedGame.joinTxHash) !== "INCLUDED"
                        ? t("waitingJoin")
                        : t("actionsAvailable")}
                  </dd>
                </div>
                {selectedGame.zkappAddress && (
                  <div>
                    <dt>zkApp</dt>
                    <dd>
                      <a
                        className="hashLink"
                        href={accountExplorerUrl(selectedGame.network, selectedGame.zkappAddress)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {selectedGame.zkappAddress}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>

              {selectedGame.status === "pending_signature" && (
                <div className="actions">
                  <button disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleReconcileCreation(selectedGame)}>
                    {t("enterHash")}
                  </button>
                  <button
                    disabled={busy || selectedGame.creatorPublicKey !== publicKey || !loadPendingCreationMaterial(selectedGame, publicKey)}
                    onClick={() => void handleResignCreation(selectedGame)}
                  >
                    {t("resignCreation")}
                  </button>
                  <button disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleMarkCreationFailed(selectedGame)}>
                    {t("markFailed")}
                  </button>
                </div>
              )}

              {selectedGame.status === "created" && (
                <button disabled={busy || !canJoin(selectedGame)} onClick={() => void handleJoinGame(selectedGame)} className="primary">
                  <Dices size={18} />
                  {t("join")}
                </button>
              )}

              {selectedGame.status === "created" && creationStatusFor(selectedGame) !== "INCLUDED" && (
                <button disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleMarkCreationFailed(selectedGame)}>
                  {t("markFailed")}
                </button>
              )}

              {selectedGame.status === "join_pending" && (
                <div className="actions">
                  <button disabled={busy || !canConfirmJoin(selectedGame)} onClick={() => void handleConfirmJoin(selectedGame)} className="primary">
                    {t("confirmJoin")}
                  </button>
                  <button
                    disabled={busy || (selectedGame.creatorPublicKey !== publicKey && selectedGame.joinerPublicKey !== publicKey)}
                    onClick={() => void handleReleaseJoin(selectedGame)}
                  >
                    {t("releaseJoin")}
                  </button>
                </div>
              )}

              {(selectedGame.status === "joined" ||
                selectedGame.status === "player_one_revealed" ||
                selectedGame.status === "player_two_revealed") && (
                <div className="actions">
                  <div className={rollingGameId === selectedGame.id ? "dice rolling" : "dice"}>
                    <DiceFace
                      value={
                        rollingGameId === selectedGame.id
                          ? rollFrames[selectedGame.id]?.creatorDie ?? "?"
                          : previewDice[selectedGame.id]?.creatorDie ?? selectedGame.creatorDie ?? "?"
                      }
                    />
                    <DiceFace
                      value={
                        rollingGameId === selectedGame.id
                          ? rollFrames[selectedGame.id]?.joinerDie ?? "?"
                          : previewDice[selectedGame.id]?.joinerDie ?? selectedGame.joinerDie ?? "?"
                      }
                    />
                  </div>
                  <button disabled={busy || !canReveal(selectedGame)} onClick={() => void handleReveal(selectedGame)} className="primary">
                    {t("reveal")}
                  </button>
                  <button disabled={busy || !canSettle(selectedGame)} onClick={() => void handleSettle(selectedGame)}>
                    {t("settle")}
                  </button>
                  <button disabled={busy || !canRefund(selectedGame)} onClick={() => void handleRefund(selectedGame)}>
                    {t("refund")}
                  </button>
                </div>
              )}

              {selectedGame.status === "created" && (
                <button disabled={busy || !canRefund(selectedGame)} onClick={() => void handleRefund(selectedGame)}>
                  {t("refund")}
                </button>
              )}

              {selectedGame.status === "settled" && (
                <div className="winner">
                  <Trophy size={22} />
                  <span>
                    {selectedGame.creatorDie} - {selectedGame.joinerDie}
                  </span>
                  <strong>{selectedGame.winnerPublicKey ?? t("draw")}</strong>
                </div>
              )}

              {selectedGame.status === "refunded" && (
                <div className="winner">
                  <ShieldCheck size={22} />
                  <strong>{t("refundedGame")}</strong>
                </div>
              )}

              {selectedGame.status === "failed" && (
                <div className="winner failedBox">
                  <ShieldCheck size={22} />
                  <strong>{t("failedGame")}</strong>
                  <span>{selectedGame.failureReason ?? t("noLockedFunds")}</span>
                </div>
              )}
            </>
          ) : (
            <p className="empty">{t("emptyGames")}</p>
          )}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
