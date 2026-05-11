import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  AtSign,
  Bell,
  ChevronDown,
  CircleEqual,
  Copy,
  Copyright,
  Dices,
  Github,
  Globe,
  Languages,
  Mail,
  MessageCircle,
  MessageSquareText,
  List,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Sun,
  Trophy,
  User,
  X,
  Wallet
} from "lucide-react";
import {
  networks,
  type Game,
  type GameMessage,
  type GameStatus,
  type NetworkId,
  type PayoutMode,
  type Player,
  type TransactionStatus
} from "@zkroll/shared";
import {
  createGame,
  createPlayer,
  clearServerProverCache,
  confirmJoinGame,
  clearPendingRefundTx,
  clearPendingSettlementTx,
  failPendingJoin,
  getCurrentSlot,
  getPlayerByPublicKey,
  getPlayersByPublicKeys,
  getTransactionStatuses,
  getUnreadMessageCounts,
  getWalletBalance,
  inviteGame,
  joinGame,
  listPreviousOpponents,
  listGameMessages,
  listGames,
  markGameMessagesRead,
  markTransactionIncluded,
  markCreationFailed,
  prepareRefundTx,
  prepareSettlementTx,
  reconcileCreationTx,
  reconcileJoinTx,
  refundGame,
  revealGame,
  settleGame,
  sendGameMessage,
  setMessagePreference,
  subscribeGameNotifications,
  subscribeNewGameNotifications,
  unsubscribeGameNotifications,
  unsubscribeNewGameNotifications,
  listNotificationSubscriptions
} from "./api";
import { fakeTxHash, randomFieldString, temporaryCommitment, temporaryDie } from "./crypto";
import {
  commitment as onchainCommitment,
  cancelCreatedGameOnchain,
  createGameOnchain,
  diceOutcomeOnchain,
  ensureWalletNetwork,
  externalBrowserUrl,
  generateGameZkappKey,
  getProvingCompatibility,
  hasPendingWalletSignature,
  joinGameOnchain,
  nextRefundDeadlineSlot,
  nextStrictRefundDeadlineSlot,
  o1jsVersion,
  pseudoHash,
  proverMode,
  rejectPendingWalletSignature,
  refundGameOnchain,
  requiredTransactionHash,
  resolvePendingWalletSignatureWithHash,
  settleGameOnchain,
  type OnchainProgress,
  type ProvingCompatibility,
  type ProvingCompatibilityIssueCode
} from "./onchain";
import {
  auroInstallUrl,
  cancelWalletConnectPrompt,
  disconnectWalletConnect,
  mobileBrowserCanUseWalletConnect,
  restoredWalletConnectAccounts,
  setWalletConnectPromptHandler,
  setWalletConnectNetwork,
  walletConnectConfigured,
  walletConnectProvider,
  type WalletConnectPrompt
} from "./walletconnect";
import {
  browserNotificationsSupported,
  firebaseNotificationsConfigured,
  listenForGameNotifications,
  requestFirebaseNotificationToken
} from "./notifications";
import "./styles.css";
import "./types";

const nanoMina = 1_000_000_000;
const onchainEnabled = import.meta.env.VITE_ONCHAIN_ENABLED === "true";
const adminPublicKey = import.meta.env.VITE_ADMIN_PUBLIC_KEY ?? "B62qigDTGHWNjEhRAbdmDSFhv3MqtkDWh6jYNvK81db5S4KXJvgzLCn";
const defaultRefundTimeoutSlots = Number(import.meta.env.VITE_REFUND_TIMEOUT_SLOTS ?? 120);
const defaultMinJoinDeadlineMarginSlots = Number(import.meta.env.VITE_MIN_JOIN_DEADLINE_MARGIN_SLOTS ?? 20);
const joinDeadlineSafetySlots = Math.max(1, Number(import.meta.env.VITE_JOIN_DEADLINE_SAFETY_SLOTS ?? 1));
const minJoinDeadlineMarginSlotsByNetwork: Record<NetworkId, number> = {
  mainnet: Number(import.meta.env.VITE_MAINNET_MIN_JOIN_DEADLINE_MARGIN_SLOTS ?? defaultMinJoinDeadlineMarginSlots),
  devnet: Number(import.meta.env.VITE_DEVNET_MIN_JOIN_DEADLINE_MARGIN_SLOTS ?? defaultMinJoinDeadlineMarginSlots),
  zeko: Number(import.meta.env.VITE_ZEKO_MIN_JOIN_DEADLINE_MARGIN_SLOTS ?? 30)
};
const txPollIntervalMs = Number(import.meta.env.VITE_TX_POLL_INTERVAL_MS ?? 60_000);
const slotPollIntervalMs = Number(import.meta.env.VITE_SLOT_POLL_INTERVAL_MS ?? 60_000);
const gamesPerPage = 5;
const leaderboardPerPage = 5;
const autoConnectStorageKey = "zkroll:auto-connect-wallet";
const pseudoAdjectives = [
  "Brave",
  "Lucky",
  "Cosmic",
  "Swift",
  "Clever",
  "Bright",
  "Silent",
  "Golden",
  "Mystic",
  "Wild",
  "Velvet",
  "Electric"
];
const pseudoNames = [
  "Roller",
  "Oracle",
  "Comet",
  "Voyager",
  "Cipher",
  "Wizard",
  "Nomad",
  "Pilot",
  "Keeper",
  "Spark",
  "Mina",
  "Zeko"
];
type TxStatus = TransactionStatus;
type Locale = "en" | "fr" | "zh" | "tr" | "ru" | "de" | "ja" | "es";
type Theme = "light" | "dark";
type ViewMode = "cards" | "app";
type AppScreen = "player" | "new" | "games" | "detail" | "messages" | "leaderboard" | "settings";
type StatusFilter = "active" | "mine_active" | "all" | GameStatus;
type WalletConnectQrMode = "auro" | "wc";
type TransactionKind = "creation" | "join" | "settlement" | "refund";
type LeaderboardRow = {
  publicKey: string;
  pseudo: string;
  gamesPlayed: number;
  gamesWon: number;
  amountWonNanoMina: string;
};
const payoutModes: PayoutMode[] = ["classic", "opponent_takes_all"];
const gameStatuses: GameStatus[] = [
  "pending_signature",
  "created",
  "join_pending",
  "joined",
  "player_one_revealed",
  "player_two_revealed",
  "both_revealed",
  "settled",
  "refunded",
  "failed",
  "cancelled"
];
const terminalGameStatuses = new Set<GameStatus>(["settled", "refunded", "failed", "cancelled"]);

type QRCodeBrowserModule = {
  toDataURL: (text: string, options?: { margin?: number; width?: number }) => Promise<string>;
};

async function createQrDataUrl(secret: string, width = 192) {
  const qrcode = (await import("qrcode/lib/browser.js")) as QRCodeBrowserModule;
  return qrcode.toDataURL(secret, { margin: 1, width });
}

async function createSecretQrDataUrl(secret: string) {
  return createQrDataUrl(secret, 192);
}

const credits = [
  { icon: "copyright", text: "2026 naamahdaemon" },
  { icon: "mail", text: "naamahdaemon@gmail.com" },
  { icon: "discord", text: "naamah8064" },
  { icon: "telegram", text: "@naamadaemon", url: "https://t.me/naamahdaemon" },
  { icon: "twitter", text: "@naamahdaemon", url: "https://twitter.com/naamahdaemon" },
  { icon: "github", text: "github.com/naamahdaemon", url: "https://github.com/naamahdaemon" },
  { icon: "web", text: "mina.naamahdaemon.eu", url: "https://mina.naamahdaemon.eu" }
];

const localeOptions: { id: Locale; label: string; shortLabel: string }[] = [
  { id: "en", label: "English", shortLabel: "EN" },
  { id: "fr", label: "Francais", shortLabel: "FR" },
  { id: "zh", label: "中文", shortLabel: "中" },
  { id: "tr", label: "Turkce", shortLabel: "TR" },
  { id: "ru", label: "Русский", shortLabel: "RU" },
  { id: "de", label: "Deutsch", shortLabel: "DE" },
  { id: "ja", label: "日本語", shortLabel: "日" },
  { id: "es", label: "Espanol", shortLabel: "ES" }
];

function savedLocale(): Locale {
  const value = localStorage.getItem("zkroll:locale");
  return localeOptions.some((item) => item.id === value) ? (value as Locale) : "en";
}

const copy: Record<string, Record<string, string>> = {
  en: {
    walletPrompt: "Connect your wallet to start.",
    noPseudo: "Not configured",
    player: "Player",
    pseudo: "Pseudo",
    network: "Network",
    balance: "Balance",
    loading: "Loading",
    unavailable: "Unavailable",
    connectWallet: "Connect wallet",
    disconnectWallet: "Disconnect",
    walletConnected: "Wallet connected",
    newChallenge: "New challenge",
    stake: "Stake in MINA",
    payoutMode: "Payout mode",
    classicPayout: "Classic pot",
    opponentTakesAll: "Opponent takes it all",
    opponentTakesAllHint: "The opponent deposits no stake. If they win, they take the creator stake; otherwise the creator is refunded.",
    inviteOpponent: "Invite player",
    noInvite: "No invitation",
    inviteSent: "Invitation sent.",
    inviteSkipped: "Game created, but the invitation could not be sent.",
    invitedOnly: "Only the invited player can join this challenge.",
    refundTimeout: "Refund timeout (slots)",
    create: "Create",
    games: "Games",
    activeStatuses: "Active games",
    myActiveStatuses: "My active games",
    allStatuses: "All statuses",
    allNetworks: "All networks",
    searchPlayer: "Search player",
    searchGameId: "Search game id",
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
    joinDeadlineTooClose: "This game expires too soon to be joined safely. Create a new game or wait for refund/cancel.",
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
    verifyTransaction: "Verify",
    changeHash: "Change hash",
    join: "Join",
    reveal: "Reveal",
    settle: "Settle",
    enterSettlementHash: "Enter settlement hash",
    pasteSettlementHash: "Paste the settlement transaction hash visible in Auro or the explorer.",
    settlementHashSaved: "Settlement hash saved. On-chain sync will be checked.",
    clearPendingSettlement: "Release pending settlement",
    clearPendingSettlementConfirm: "Release this local pending settlement? Only do this if no settlement transaction exists on-chain.",
    pendingSettlementCleared: "Pending settlement released. You can settle again or enter the existing hash.",
    pendingSettlementClearedReason: "Pending settlement manually released",
    enterRefundHash: "Enter refund/cancel hash",
    pasteRefundHash: "Paste the refund or cancel transaction hash visible in Auro or the explorer.",
    refundHashSaved: "Refund/cancel hash saved. On-chain sync will be checked.",
    clearPendingRefund: "Release pending refund/cancel",
    clearPendingRefundConfirm: "Release this local pending refund/cancel? Only do this if no refund or cancel transaction exists on-chain.",
    pendingRefundCleared: "Pending refund/cancel released. You can retry or enter the existing hash.",
    pendingRefundClearedReason: "Pending refund/cancel manually released",
    transactionHashAlreadyUsed: "This transaction hash is already used by the {kind} transaction for this game.",
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
    progressSwitchNetwork: "Switching wallet network",
    progressCompileCircuit: "Compiling ZK circuit",
    progressCircuitReady: "ZK circuit ready",
    progressWalletSignature: "Wallet signature",
    progressTransactionProvided: "Transaction provided",
    progressWalletNoAutoReturn: "Wallet did not return automatically",
    progressTransactionSent: "Transaction sent",
    progressGenerateProof: "Generating proof",
    progressProofGenerated: "Proof generated",
    refresh: "Refresh",
    settings: "Settings",
    language: "Language",
    theme: "Theme",
    lightTheme: "Light",
    darkTheme: "Dark",
    displayMode: "Display mode",
    cardsMode: "Cards",
    appMode: "Application",
    credits: "Credits",
    technicalInfo: "Technical info",
    o1jsVersionLabel: "o1js version",
    proverModeLabel: "Prover mode",
    clientProverMode: "Client",
    serverProverMode: "Server",
    adminTools: "Admin tools",
    clearServerProverCache: "Clear server prover cache",
    clearServerProverCacheConfirm: "Clear the server o1js cache and reset compiled prover state? Do this only when no server proof is running.",
    serverProverCacheCleared: "Server prover cache cleared.",
    walletTab: "Wallet",
    newGameTab: "New",
    gamesTab: "Games",
    leaderboard: "Leaderboard",
    leaderboardTab: "Ranks",
    gamesPlayed: "Games",
    gamesWon: "Won",
    amountWon: "MINA won",
    emptyLeaderboard: "No settled games yet.",
    messages: "Messages",
    systemMessages: "System messages",
    playerMessages: "Player messages",
    sendMessage: "Send",
    reply: "Reply",
    messagePlayer: "Message player",
    messagePlaceholder: "Write a message...",
    messageSent: "Message sent.",
    messagesDisabled: "This player does not accept messages.",
    acceptMessages: "Accept player messages",
    noPlayerMessages: "No player messages yet.",
    backToGames: "Back to games",
    walletAddress: "Wallet address",
    chooseNetwork: "Choose network",
    mainnetNetworkDescription: "Mina production network",
    devnetNetworkDescription: "Mina development network",
    zekoNetworkDescription: "Zeko test network",
    activeNetwork: "Active",
    enableNotifications: "Enable notifications for this game",
    disableNotifications: "Disable notifications for this game",
    shareGame: "Share game",
    gameLinkCopied: "Game link copied.",
    gameLinkCopyFailed: "Unable to share this game link.",
    notificationsEnabled: "Notifications enabled for this game.",
    notificationsDisabled: "Notifications disabled for this game.",
    enableNewGameNotifications: "Enable new game notifications",
    disableNewGameNotifications: "Disable new game notifications",
    newGameNotificationsEnabled: "New game notifications enabled for this network.",
    newGameNotificationsDisabled: "New game notifications disabled for this network.",
    notificationsUnsupported: "Push notifications are not supported by this browser.",
    notificationsNotConfigured: "Firebase notifications are not configured.",
    notificationsPermissionDenied: "Notification permission was not granted.",
    gameUpdatedNotification: "Game updated",
    newGameNotification: "New game available",
    secret: "Secret",
    secretAvailable: "Secret available",
    secretMissing: "Secret missing",
    yes: "Yes",
    no: "No",
    showSecret: "Show secret",
    hideSecret: "Hide secret",
    copySecret: "Copy secret",
    closeSecret: "Close secret",
    secretCopied: "Secret copied.",
    pasteSecret: "Paste secret",
    pasteSecretPrompt: "Paste the secret for this game.",
    secretImported: "Secret imported locally.",
    scanSecretQr: "Scan QR",
    stopScan: "Stop scan",
    qrScannerUnavailable: "QR scanning is not available in this browser.",
    walletMissing: "Mina wallet not found. Install Auro or enable the extension.",
    noWalletAccount: "No account returned by the wallet.",
    walletFound: "Wallet connected. Pseudo found:",
    choosePseudoMessage: "Wallet connected. Choose a pseudo to register this address.",
    pseudoSaved: "Pseudo saved:",
    pseudoUpdated: "Pseudo updated:",
    creatorOnlyHash: "Only the creator can enter the creation hash.",
    pasteCreationHash: "Paste the creation transaction hash visible in Auro or the explorer.",
    hashSaved: "Creation hash saved. On-chain sync will be checked.",
    pasteJoinHash: "Paste the join transaction hash visible in Auro or the explorer.",
    pasteJoinRefundDeadlineSlot: "Paste the refund deadline slot used by the join transaction. Leave empty to use the suggested value.",
    invalidJoinRecovery: "Join recovery requires the joiner wallet, pseudo, local secret, and on-chain game metadata.",
    joinHashSaved: "Join hash saved. On-chain sync will be checked.",
    joinerOnlyHash: "Only the opponent can enter this join hash.",
    resignCreationConfirm: "Before re-signing, check Auro or the explorer. If the transaction already exists, paste its hash instead. Re-sign now?",
    creationMaterialMissing: "Local creation material is missing. Paste the transaction hash if it exists, or create a new challenge.",
    creationResigned: "Creation transaction signed again and indexed.",
    creatorOnlyFailed: "Only the creator can mark this creation as failed.",
    confirmFailed: "Mark this creation as failed? Use only if the create transaction failed on the explorer.",
    optionalReason: "Optional reason",
    failedReasonDefault: "Create transaction failed on-chain",
    failedReasonLocalSignature: "Local signature failed in Auro",
    failedReasonOnchainCreation: "Create transaction failed on-chain",
    failedReasonOther: "Other",
    failedReasonCustomPlaceholder: "Describe the failure",
    markedFailed: "Creation marked as failed. The game is kept as a local recovery record.",
    manualSignatureTitle: "Wallet signature recovery",
    manualSignatureHash: "Transaction hash",
    manualSignatureHashPlaceholder: "Paste the hash shown in Auro or the explorer",
    manualSignatureUseHash: "Use this hash",
    manualSignatureFailed: "Signature failed in Auro",
    manualSignatureFailedMessage: "Signature marked as failed locally. You can re-sign this game later.",
    manualSignatureHint: "Use these options if Auro accepted or rejected the transaction without returning control to the page.",
    walletRecoveryExplorerHint: "If the transaction was accepted in Auro but the page did not receive the hash, open the zkApp explorer and find the zkApp transaction whose memo matches:",
    openZkappExplorer: "Open zkApp explorer",
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
    cancelGame: "Cancel game",
    cancelSent: "Game cancelled and refund sent.",
    cancelNotReady: "Only the creator can cancel an open game after the creation transaction is included.",
    invalidRefundTimeout: "Refund timeout must be a positive integer.",
    activeAfterSlot: "active after slot",
    minaZkDice: "Mina / Zeko zk dice roll",
    provingCompatibilityTitle: "ZK proving may not work in this browser",
    provingCompatibilityIntro: "This device cannot safely compile the circuit here.",
    provingCompatibilityAdvice: "Open zkroll in a full browser with COOP/COEP support, or use desktop.",
    openInBrowser: "Open in browser",
    copyPageUrl: "Copy page URL",
    openAuro: "Open Auro",
    installAuro: "Install Auro",
    auroInstallHint: "Auro did not seem to open. Install Auro, then retry the connection.",
    cancel: "Cancel",
    copyWalletConnectUri: "Copy Auro WalletConnect URL",
    showWalletConnectQr: "Show connection QR code",
    hideWalletConnectQr: "Hide connection QR code",
    walletConnectQrAuro: "Auro link",
    walletConnectQrWc: "WC URI",
    walletConnectPreparing: "Preparing the WalletConnect request...",
    walletConnectPrompt: "Approve the WalletConnect request in Auro, then return here. If Auro does not open, install it or scan the WalletConnect QR code.",
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
    balance: "Solde",
    loading: "Chargement",
    unavailable: "Indisponible",
    connectWallet: "Connecter wallet",
    disconnectWallet: "Deconnecter",
    walletConnected: "Wallet connecte",
    newChallenge: "Nouveau defi",
    stake: "Mise en MINA",
    payoutMode: "Mode de gain",
    classicPayout: "Pot classique",
    opponentTakesAll: "L'adversaire rafle tout",
    opponentTakesAllHint: "L'adversaire ne depose pas de mise. S'il gagne, il prend la mise du createur ; sinon le createur est rembourse.",
    inviteOpponent: "Inviter un joueur",
    noInvite: "Aucune invitation",
    inviteSent: "Invitation envoyee.",
    inviteSkipped: "Partie creee, mais l'invitation n'a pas pu etre envoyee.",
    invitedOnly: "Seul le joueur invite peut rejoindre ce defi.",
    refundTimeout: "Timeout refund (slots)",
    create: "Creer",
    games: "Parties",
    activeStatuses: "Parties actives",
    myActiveStatuses: "Mes parties actives",
    allStatuses: "Tous les etats",
    allNetworks: "Tous les reseaux",
    searchPlayer: "Rechercher joueur",
    searchGameId: "Rechercher game id",
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
    joinDeadlineTooClose: "Cette partie expire trop bientot pour etre rejointe proprement. Cree une nouvelle partie ou attends le refund/cancel.",
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
    verifyTransaction: "Verifier",
    changeHash: "Changer le hash",
    join: "Rejoindre",
    reveal: "Reveler",
    settle: "Regler",
    enterSettlementHash: "Renseigner le hash settlement",
    pasteSettlementHash: "Colle le hash de la transaction settlement visible dans Auro ou l'explorateur.",
    settlementHashSaved: "Hash settlement renseigne. La synchronisation on-chain va etre verifiee.",
    clearPendingSettlement: "Liberer settlement pending",
    clearPendingSettlementConfirm: "Liberer ce settlement pending local ? A faire uniquement si aucune transaction settlement n'existe on-chain.",
    pendingSettlementCleared: "Settlement pending libere. Tu peux relancer le settlement ou renseigner le hash existant.",
    pendingSettlementClearedReason: "Settlement pending libere manuellement",
    enterRefundHash: "Renseigner le hash refund/cancel",
    pasteRefundHash: "Colle le hash de la transaction refund ou cancel visible dans Auro ou l'explorateur.",
    refundHashSaved: "Hash refund/cancel renseigne. La synchronisation on-chain va etre verifiee.",
    clearPendingRefund: "Liberer refund/cancel pending",
    clearPendingRefundConfirm: "Liberer ce refund/cancel pending local ? A faire uniquement si aucune transaction refund ou cancel n'existe on-chain.",
    pendingRefundCleared: "Refund/cancel pending libere. Tu peux reessayer ou renseigner le hash existant.",
    pendingRefundClearedReason: "Refund/cancel pending libere manuellement",
    transactionHashAlreadyUsed: "Ce hash de transaction est deja utilise par la transaction {kind} de cette partie.",
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
    progressSwitchNetwork: "Changement de reseau wallet",
    progressCompileCircuit: "Compilation du circuit ZK",
    progressCircuitReady: "Circuit ZK pret",
    progressWalletSignature: "Signature dans le wallet",
    progressTransactionProvided: "Transaction renseignee",
    progressWalletNoAutoReturn: "Wallet sans retour automatique",
    progressTransactionSent: "Transaction envoyee",
    progressGenerateProof: "Generation de la preuve",
    progressProofGenerated: "Preuve generee",
    refresh: "Rafraichir",
    settings: "Parametres",
    language: "Langue",
    theme: "Theme",
    lightTheme: "Clair",
    darkTheme: "Sombre",
    displayMode: "Affichage",
    cardsMode: "Cards",
    appMode: "Application",
    credits: "Credits",
    technicalInfo: "Infos techniques",
    o1jsVersionLabel: "Version o1js",
    proverModeLabel: "Mode prover",
    clientProverMode: "Client",
    serverProverMode: "Serveur",
    adminTools: "Outils admin",
    clearServerProverCache: "Vider cache prover serveur",
    clearServerProverCacheConfirm: "Vider le cache o1js serveur et reinitialiser l'etat compile du prover ? A faire seulement quand aucune preuve serveur ne tourne.",
    serverProverCacheCleared: "Cache prover serveur vide.",
    walletTab: "Wallet",
    newGameTab: "Nouvelle",
    gamesTab: "Parties",
    leaderboard: "Classement",
    leaderboardTab: "Classement",
    gamesPlayed: "Parties",
    gamesWon: "Gagnees",
    amountWon: "MINA gagnes",
    emptyLeaderboard: "Aucune partie reglee pour le moment.",
    messages: "Messages",
    systemMessages: "Messages systeme",
    playerMessages: "Messages joueurs",
    sendMessage: "Envoyer",
    reply: "Repondre",
    messagePlayer: "Message joueur",
    messagePlaceholder: "Ecris un message...",
    messageSent: "Message envoye.",
    messagesDisabled: "Ce joueur n'accepte pas les messages.",
    acceptMessages: "Accepter les messages joueurs",
    noPlayerMessages: "Aucun message joueur pour le moment.",
    backToGames: "Retour aux parties",
    walletAddress: "Adresse wallet",
    chooseNetwork: "Choisir reseau",
    mainnetNetworkDescription: "Reseau Mina de production",
    devnetNetworkDescription: "Reseau Mina de developpement",
    zekoNetworkDescription: "Reseau de test Zeko",
    activeNetwork: "Actif",
    enableNotifications: "Activer les notifications pour cette partie",
    disableNotifications: "Desactiver les notifications pour cette partie",
    shareGame: "Partager la partie",
    gameLinkCopied: "Lien de la partie copie.",
    gameLinkCopyFailed: "Impossible de partager le lien de cette partie.",
    notificationsEnabled: "Notifications activees pour cette partie.",
    notificationsDisabled: "Notifications desactivees pour cette partie.",
    enableNewGameNotifications: "Activer les notifications de nouvelles parties",
    disableNewGameNotifications: "Desactiver les notifications de nouvelles parties",
    newGameNotificationsEnabled: "Notifications de nouvelles parties activees pour ce reseau.",
    newGameNotificationsDisabled: "Notifications de nouvelles parties desactivees pour ce reseau.",
    notificationsUnsupported: "Les notifications push ne sont pas supportees par ce navigateur.",
    notificationsNotConfigured: "Les notifications Firebase ne sont pas configurees.",
    notificationsPermissionDenied: "La permission de notification n'a pas ete accordee.",
    gameUpdatedNotification: "Partie mise a jour",
    newGameNotification: "Nouvelle partie disponible",
    secret: "Secret",
    secretAvailable: "Secret disponible",
    secretMissing: "Secret absent",
    yes: "Oui",
    no: "Non",
    showSecret: "Afficher secret",
    hideSecret: "Masquer secret",
    copySecret: "Copier secret",
    closeSecret: "Fermer secret",
    secretCopied: "Secret copie.",
    pasteSecret: "Coller secret",
    pasteSecretPrompt: "Colle le secret de cette partie.",
    secretImported: "Secret importe localement.",
    scanSecretQr: "Scanner QR",
    stopScan: "Arreter scan",
    qrScannerUnavailable: "Le scan QR n'est pas disponible dans ce navigateur.",
    walletMissing: "Wallet Mina introuvable. Installe Auro ou active l'extension.",
    noWalletAccount: "Aucun compte retourne par le wallet.",
    walletFound: "Wallet connecte. Pseudo retrouve :",
    choosePseudoMessage: "Wallet connecte. Choisis un pseudo pour enregistrer cette adresse.",
    pseudoSaved: "Pseudo enregistre :",
    pseudoUpdated: "Pseudo modifie :",
    creatorOnlyHash: "Seul le createur peut renseigner le hash de creation.",
    pasteCreationHash: "Colle le hash de la transaction de creation visible dans Auro ou l'explorateur.",
    hashSaved: "Hash de creation renseigne. La synchronisation on-chain va etre verifiee.",
    pasteJoinHash: "Colle le hash de la transaction de join visible dans Auro ou l'explorateur.",
    pasteJoinRefundDeadlineSlot: "Colle le slot de deadline refund utilise par la transaction de join. Laisse vide pour utiliser la valeur suggeree.",
    invalidJoinRecovery: "La recuperation du join requiert le wallet du joiner, le pseudo, le secret local et les metadonnees on-chain.",
    joinHashSaved: "Hash de join renseigne. La synchronisation on-chain va etre verifiee.",
    joinerOnlyHash: "Seul l'adversaire peut renseigner ce hash de join.",
    resignCreationConfirm: "Avant de resigner, verifie Auro ou l'explorateur. Si la transaction existe deja, colle plutot son hash. Resigner maintenant ?",
    creationMaterialMissing: "Les donnees locales de creation sont manquantes. Colle le hash si la transaction existe, ou cree un nouveau defi.",
    creationResigned: "Transaction de creation signee a nouveau et indexee.",
    creatorOnlyFailed: "Seul le createur peut marquer cette creation comme echouee.",
    confirmFailed: "Marquer cette creation comme echouee ? A utiliser uniquement si la transaction create est failed sur l'explorateur.",
    optionalReason: "Raison optionnelle",
    failedReasonDefault: "Create transaction failed on-chain",
    failedReasonLocalSignature: "Echec local de signature dans Auro",
    failedReasonOnchainCreation: "Echec de creation de la transaction on-chain",
    failedReasonOther: "Autre",
    failedReasonCustomPlaceholder: "Precise la raison",
    markedFailed: "Creation marquee comme echouee. La partie reste conservee comme trace locale de reprise.",
    manualSignatureTitle: "Reprise de signature wallet",
    manualSignatureHash: "Hash de transaction",
    manualSignatureHashPlaceholder: "Colle le hash visible dans Auro ou l'explorateur",
    manualSignatureUseHash: "Utiliser ce hash",
    manualSignatureFailed: "Signature echouee dans Auro",
    manualSignatureFailedMessage: "Signature marquee comme echouee localement. Tu pourras resigner cette partie plus tard.",
    manualSignatureHint: "Utilise ces options si Auro a accepte ou rejete la transaction sans rendre la main a la page.",
    walletRecoveryExplorerHint: "Si la transaction a ete acceptee dans Auro mais que la page n'a pas recu le hash, ouvre l'explorateur zkApp et retrouve la transaction zkApp dont le memo correspond a :",
    openZkappExplorer: "Ouvrir l'explorateur zkApp",
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
    cancelGame: "Annuler la partie",
    cancelSent: "Partie annulee et refund envoye.",
    cancelNotReady: "Seul le createur peut annuler une partie ouverte apres inclusion de la transaction de creation.",
    invalidRefundTimeout: "Le timeout de refund doit etre un nombre entier positif.",
    activeAfterSlot: "actif apres le slot",
    minaZkDice: "Mina / Zeko zk dice roll",
    provingCompatibilityTitle: "La preuve ZK risque de ne pas fonctionner dans ce navigateur",
    provingCompatibilityIntro: "Cet environnement ne peut pas compiler le circuit de maniere fiable.",
    provingCompatibilityAdvice: "Ouvre zkroll dans un navigateur complet compatible COOP/COEP, ou utilise desktop.",
    openInBrowser: "Ouvrir dans le navigateur",
    copyPageUrl: "Copier l'URL",
    openAuro: "Ouvrir Auro",
    installAuro: "Installer Auro",
    auroInstallHint: "Auro ne semble pas s'etre ouvert. Installe Auro, puis relance la connexion.",
    cancel: "Annuler",
    copyWalletConnectUri: "Copier l'URL WalletConnect Auro",
    showWalletConnectQr: "Afficher le QRCode de connexion",
    hideWalletConnectQr: "Masquer le QRCode de connexion",
    walletConnectQrAuro: "Lien Auro",
    walletConnectQrWc: "URI WC",
    walletConnectPreparing: "Preparation de la demande WalletConnect...",
    walletConnectPrompt: "Valide la demande WalletConnect dans Auro, puis reviens ici. Si Auro ne s'ouvre pas, installe-le ou scanne le QRCode WalletConnect.",
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

Object.assign(copy, {
  zh: {
    ...copy.en,
    walletPrompt: "连接钱包开始。",
    noPseudo: "未配置",
    player: "玩家",
    pseudo: "昵称",
    network: "网络",
    balance: "余额",
    loading: "加载中",
    unavailable: "不可用",
    connectWallet: "连接钱包",
    disconnectWallet: "断开连接",
    walletConnected: "钱包已连接",
    newChallenge: "新挑战",
    stake: "MINA 下注",
    payoutMode: "支付模式",
    classicPayout: "经典奖池",
    opponentTakesAll: "对手赢者通吃",
    opponentTakesAllHint: "对手不存入下注。如果对手获胜，将获得创建者的下注；否则创建者退款。",
    refundTimeout: "退款超时（slot）",
    create: "创建",
    games: "游戏",
    activeStatuses: "活跃游戏",
    myActiveStatuses: "我的活跃游戏",
    allStatuses: "全部状态",
    allNetworks: "全部网络",
    searchPlayer: "搜索玩家",
    searchGameId: "搜索游戏 ID",
    previous: "上一页",
    next: "下一页",
    page: "页",
    draw: "平局",
    indexed: "已索引",
    challenge: "挑战",
    creator: "创建者",
    opponent: "对手",
    waiting: "等待中",
    transaction: "交易",
    refund: "退款",
    currentSlot: "当前 slot",
    notConfigured: "未配置",
    onchainState: "链上状态",
    signaturePending: "签名已发送或等待哈希",
    creationFailed: "链上创建失败",
    waitingCreation: "等待创建确认",
    waitingJoin: "等待加入确认",
    joinPending: "加入交易待确认",
    confirmJoin: "确认加入",
    releaseJoin: "释放加入",
    actionsAvailable: "当前状态可用操作",
    enterHash: "输入哈希",
    resignCreation: "重新签名",
    markFailed: "标记失败",
    markIncluded: "标记已包含",
    confirmIncluded: "确定将此交易标记为已包含？请先检查浏览器。",
    transactionIncluded: "交易已标记为已包含。",
    join: "加入",
    reveal: "揭示",
    settle: "结算",
    enterSettlementHash: "输入结算哈希",
    pasteSettlementHash: "粘贴 Auro 或浏览器中的结算交易哈希。",
    settlementHashSaved: "结算哈希已保存，将检查链上同步。",
    refundedGame: "游戏已退款",
    failedGame: "创建失败",
    noLockedFunds: "合约未锁定资金。",
    emptyGames: "暂无游戏。",
    choosePseudo: "选择昵称",
    editPseudo: "编辑昵称",
    pseudoNotice: "此昵称会与钱包地址保存在本地数据库中。",
    save: "保存",
    zkWorkNotice: "浏览器中编译和生成证明可能需要一些时间。",
    elapsed: "已用时间",
    progressSwitchNetwork: "切换钱包网络",
    progressCompileCircuit: "编译 ZK 电路",
    progressCircuitReady: "ZK 电路就绪",
    progressWalletSignature: "钱包签名",
    progressTransactionProvided: "交易已提供",
    progressWalletNoAutoReturn: "钱包没有自动返回",
    progressTransactionSent: "交易已发送",
    progressGenerateProof: "生成证明",
    progressProofGenerated: "证明已生成",
    refresh: "刷新",
    settings: "设置",
    language: "语言",
    theme: "主题",
    lightTheme: "浅色",
    darkTheme: "深色",
    displayMode: "显示模式",
    cardsMode: "卡片",
    appMode: "应用",
    credits: "鸣谢",
    walletTab: "钱包",
    newGameTab: "新建",
    gamesTab: "游戏",
    messages: "消息",
    backToGames: "返回游戏",
    walletAddress: "钱包地址",
    chooseNetwork: "选择网络",
    mainnetNetworkDescription: "Mina 生产网络",
    devnetNetworkDescription: "Mina 开发网络",
    zekoNetworkDescription: "Zeko 测试网络",
    activeNetwork: "当前",
    enableNotifications: "为此游戏开启通知",
    disableNotifications: "关闭此游戏通知",
    notificationsEnabled: "此游戏通知已开启。",
    notificationsDisabled: "此游戏通知已关闭。",
    enableNewGameNotifications: "开启新游戏通知",
    disableNewGameNotifications: "关闭新游戏通知",
    newGameNotificationsEnabled: "此网络的新游戏通知已开启。",
    newGameNotificationsDisabled: "此网络的新游戏通知已关闭。",
    notificationsUnsupported: "此浏览器不支持推送通知。",
    notificationsNotConfigured: "Firebase 通知未配置。",
    notificationsPermissionDenied: "通知权限未授予。",
    gameUpdatedNotification: "游戏已更新",
    newGameNotification: "有新游戏",
    secret: "秘密",
    secretAvailable: "秘密可用",
    secretMissing: "缺少秘密",
    yes: "是",
    no: "否",
    showSecret: "显示秘密",
    hideSecret: "隐藏秘密",
    copySecret: "复制秘密",
    closeSecret: "关闭秘密",
    secretCopied: "秘密已复制。",
    pasteSecret: "粘贴秘密",
    pasteSecretPrompt: "粘贴此游戏的秘密。",
    secretImported: "秘密已导入本地。",
    scanSecretQr: "扫描 QR",
    stopScan: "停止扫描",
    qrScannerUnavailable: "此浏览器无法扫描 QR。",
    walletMissing: "未找到 Mina 钱包。请安装 Auro 或启用扩展。",
    noWalletAccount: "钱包未返回账户。",
    walletFound: "钱包已连接。找到昵称：",
    choosePseudoMessage: "钱包已连接。请选择昵称注册此地址。",
    pseudoSaved: "昵称已保存：",
    pseudoUpdated: "昵称已更新：",
    creatorOnlyHash: "只有创建者可以输入创建哈希。",
    pasteCreationHash: "粘贴 Auro 或浏览器中的创建交易哈希。",
    hashSaved: "创建哈希已保存，将检查链上同步。",
    pasteJoinHash: "粘贴 Auro 或浏览器中的加入交易哈希。",
    joinHashSaved: "加入哈希已保存，将检查链上同步。",
    joinerOnlyHash: "只有对手可以输入此加入哈希。",
    resignCreationConfirm: "重新签名前请检查 Auro 或浏览器。若交易已存在，请粘贴哈希。现在重新签名？",
    creationMaterialMissing: "缺少本地创建数据。若交易存在请粘贴哈希，或创建新挑战。",
    creationResigned: "创建交易已重新签名并索引。",
    creatorOnlyFailed: "只有创建者可以将创建标记为失败。",
    confirmFailed: "将此创建标记为失败？仅在浏览器中确认创建交易失败时使用。",
    optionalReason: "可选原因",
    failedReasonDefault: "创建交易链上失败",
    failedReasonLocalSignature: "Auro 本地签名失败",
    failedReasonOnchainCreation: "创建交易链上失败",
    failedReasonOther: "其他",
    failedReasonCustomPlaceholder: "描述失败原因",
    markedFailed: "创建已标记失败。游戏保留为本地恢复记录。",
    manualSignatureTitle: "钱包签名恢复",
    manualSignatureHash: "交易哈希",
    manualSignatureHashPlaceholder: "粘贴 Auro 或浏览器显示的哈希",
    manualSignatureUseHash: "使用此哈希",
    manualSignatureFailed: "Auro 签名失败",
    manualSignatureFailedMessage: "签名已在本地标记失败。之后可以重新签名。",
    manualSignatureHint: "如果 Auro 接受或拒绝交易但未返回页面，请使用这些选项。",
    walletAndPseudoRequired: "需要昵称和钱包。",
    createdOnchain: "挑战已链上创建并索引。",
    createdMock: "挑战已在模拟模式创建。",
    cannotJoinOwn: "不能加入自己的挑战。",
    incompatibleOnchain: "此游戏不兼容链上模式。",
    joinedOnchain: "挑战已链上加入。双方可以揭示。",
    joinPendingMessage: "加入交易已发送。揭示前等待链上包含。",
    joinConfirmed: "加入已确认。双方可以揭示。",
    joinReleased: "待确认加入已释放。挑战再次开放。",
    joinFailedReason: "加入交易失败或未包含。",
    joinedMock: "挑战已在模拟模式加入。",
    walletSecretRequired: "需要钱包和秘密。",
    bothSecretsRequired: "双方都必须揭示秘密。",
    bothRevealed: "双方秘密已揭示。结果本地计算，结算会链上验证并支付。",
    waitingOtherReveal: "秘密已揭示。等待另一位玩家。",
    incompleteSettlement: "游戏未满足链上结算条件。",
    settledOnchain: "游戏已链上结算并索引。",
    settledMock: "游戏已在模拟模式结算。",
    walletRequired: "需要钱包。",
    refundNotReady: "超时必须达到且创建/加入交易已包含后才能退款。",
    playerOnlyRefund: "只有本局玩家可以请求退款。",
    incompleteRefund: "游戏未满足链上退款条件。",
    refundSent: "退款已链上发送并索引。",
    refundMock: "游戏已在模拟模式退款。",
    cancelGame: "取消游戏",
    cancelSent: "游戏已取消并发送退款。",
    cancelNotReady: "只有创建者可在创建交易包含后取消开放游戏。",
    invalidRefundTimeout: "退款超时必须是正整数。",
    activeAfterSlot: "在 slot 后可用",
    minaZkDice: "Mina / Zeko ZK 掷骰",
    provingCompatibilityTitle: "此浏览器可能无法生成 ZK 证明",
    provingCompatibilityIntro: "此设备无法安全编译电路。",
    provingCompatibilityAdvice: "请在支持 COOP/COEP 的完整浏览器中打开 zkroll，或使用桌面端。",
    openInBrowser: "在浏览器打开",
    copyPageUrl: "复制页面 URL",
    openAuro: "打开 Auro",
    openAuroFallback: "直接打开 Auro",
    cancel: "取消",
    copyWalletConnectUri: "复制 Auro WalletConnect URL",
    showWalletConnectQr: "显示连接 QR 码",
    hideWalletConnectQr: "隐藏连接 QR 码",
    walletConnectQrAuro: "Auro 链接",
    walletConnectQrWc: "WC URI",
    walletConnectPrompt: "请在 Auro 中批准 WalletConnect 请求，然后返回这里。如果 Auro 未显示连接界面，请使用直接打开按钮和复制的 URI。",
    walletConnectNotConfigured: "移动端 WalletConnect 未配置。请设置 VITE_WALLETCONNECT_PROJECT_ID。",
    createdAt: "创建",
    updatedAt: "更新",
    joinedAt: "加入",
    creatorRevealedAt: "创建者揭示",
    joinerRevealedAt: "对手揭示",
    settledAt: "结算",
    refundedAt: "退款",
    failedAt: "失败",
    cancelledAt: "取消",
    timeline: "时间线",
    issueNoWebAssembly: "WebAssembly 不可用。",
    issueNoWorker: "Web worker 或 blob worker 不可用。",
    issueNotCrossOriginIsolated: "页面不是 cross-origin isolated，无法使用 SharedArrayBuffer。",
    issueNoSharedArrayBuffer: "SharedArrayBuffer 不可用。",
    issueWalletWebView: "钱包 WebView 可能阻止 o1js 所需隔离。",
    issueMobileLimitedMemory: "此移动设备内存/CPU 可能不足以生成证明。"
  },
  tr: {
    ...copy.en,
    walletPrompt: "Başlamak için cüzdanını bağla.",
    player: "Oyuncu",
    pseudo: "Takma ad",
    network: "Ağ",
    balance: "Bakiye",
    connectWallet: "Cüzdanı bağla",
    disconnectWallet: "Bağlantıyı kes",
    walletConnected: "Cüzdan bağlı",
    newChallenge: "Yeni meydan okuma",
    stake: "MINA bahsi",
    payoutMode: "Ödeme modu",
    classicPayout: "Klasik pot",
    opponentTakesAll: "Rakip hepsini alır",
    opponentTakesAllHint: "Rakip bahis yatırmaz. Kazanırsa oluşturanın bahsini alır; aksi halde oluşturan iade alır.",
    create: "Oluştur",
    games: "Oyunlar",
    activeStatuses: "Aktif oyunlar",
    myActiveStatuses: "Aktif oyunlarım",
    allStatuses: "Tüm durumlar",
    searchPlayer: "Oyuncu ara",
    searchGameId: "Oyun ID ara",
    challenge: "Meydan okuma",
    creator: "Oluşturan",
    opponent: "Rakip",
    waiting: "Bekleniyor",
    refund: "İade",
    currentSlot: "Geçerli slot",
    onchainState: "Zincir durumu",
    joinPending: "Katılma işlemi bekliyor",
    join: "Katıl",
    reveal: "Açıkla",
    settle: "Sonuçlandır",
    refresh: "Yenile",
    settings: "Ayarlar",
    language: "Dil",
    theme: "Tema",
    displayMode: "Görünüm",
    walletTab: "Cüzdan",
    newGameTab: "Yeni",
    gamesTab: "Oyunlar",
    messages: "Mesajlar",
    chooseNetwork: "Ağ seç",
    enableNotifications: "Bu oyun için bildirimleri aç",
    disableNotifications: "Bu oyun için bildirimleri kapat",
    secret: "Sır",
    showSecret: "Sırrı göster",
    copySecret: "Sırrı kopyala",
    pasteSecret: "Sırrı yapıştır",
    walletMissing: "Mina cüzdanı bulunamadı. Auro kur veya eklentiyi etkinleştir.",
    createdOnchain: "Meydan okuma zincirde oluşturuldu ve indekslendi.",
    joinPendingMessage: "Katılma işlemi gönderildi. Açıklama öncesi zincire dahil edilmesi bekleniyor.",
    bothRevealed: "İki sır da açıklandı. Sonuç yerelde hesaplandı; settlement zincirde doğrulayıp ödeme yapacak.",
    waitingOtherReveal: "Sır açıklandı. Diğer oyuncu bekleniyor.",
    settledOnchain: "Oyun zincirde sonuçlandı ve indekslendi.",
    refundSent: "İade zincire gönderildi ve indekslendi.",
    cancelGame: "Oyunu iptal et",
    minaZkDice: "Mina / Zeko ZK zar",
    openAuro: "Auro'yu aç",
    openAuroFallback: "Auro'yu doğrudan aç",
    cancel: "İptal",
    copyWalletConnectUri: "Auro WalletConnect URL'sini kopyala",
    showWalletConnectQr: "Bağlantı QR kodunu göster",
    hideWalletConnectQr: "Bağlantı QR kodunu gizle",
    walletConnectQrAuro: "Auro bağlantısı",
    walletConnectQrWc: "WC URI",
    walletConnectPrompt: "WalletConnect isteğini Auro'da onayla, sonra buraya dön.",
    timeline: "Zaman çizelgesi"
  },
  ru: {
    ...copy.en,
    walletPrompt: "Подключите кошелек, чтобы начать.",
    player: "Игрок",
    pseudo: "Псевдоним",
    network: "Сеть",
    balance: "Баланс",
    connectWallet: "Подключить кошелек",
    disconnectWallet: "Отключить",
    walletConnected: "Кошелек подключен",
    newChallenge: "Новый вызов",
    stake: "Ставка в MINA",
    payoutMode: "Режим выплаты",
    classicPayout: "Классический банк",
    opponentTakesAll: "Соперник забирает все",
    opponentTakesAllHint: "Соперник не вносит ставку. Если он выигрывает, получает ставку создателя; иначе создатель получает возврат.",
    create: "Создать",
    games: "Игры",
    activeStatuses: "Активные игры",
    myActiveStatuses: "Мои активные игры",
    allStatuses: "Все статусы",
    searchPlayer: "Поиск игрока",
    searchGameId: "Поиск game id",
    challenge: "Вызов",
    creator: "Создатель",
    opponent: "Соперник",
    waiting: "Ожидание",
    refund: "Возврат",
    currentSlot: "Текущий слот",
    onchainState: "Состояние on-chain",
    joinPending: "Транзакция join ожидает",
    join: "Присоединиться",
    reveal: "Reveal",
    settle: "Settlement",
    refresh: "Обновить",
    settings: "Настройки",
    language: "Язык",
    theme: "Тема",
    displayMode: "Режим отображения",
    walletTab: "Кошелек",
    newGameTab: "Новая",
    gamesTab: "Игры",
    messages: "Сообщения",
    chooseNetwork: "Выбрать сеть",
    enableNotifications: "Включить уведомления для этой игры",
    disableNotifications: "Отключить уведомления для этой игры",
    secret: "Секрет",
    showSecret: "Показать секрет",
    copySecret: "Копировать секрет",
    pasteSecret: "Вставить секрет",
    walletMissing: "Кошелек Mina не найден. Установите Auro или включите расширение.",
    createdOnchain: "Вызов создан on-chain и проиндексирован.",
    joinPendingMessage: "Транзакция join отправлена. Ожидается включение on-chain перед reveal.",
    bothRevealed: "Оба секрета раскрыты. Результат рассчитан локально; settlement проверит и выплатит on-chain.",
    waitingOtherReveal: "Секрет раскрыт. Ожидание второго игрока.",
    settledOnchain: "Игра завершена on-chain и проиндексирована.",
    refundSent: "Возврат отправлен on-chain и проиндексирован.",
    cancelGame: "Отменить игру",
    minaZkDice: "Mina / Zeko ZK dice",
    openAuro: "Открыть Auro",
    openAuroFallback: "Открыть Auro напрямую",
    cancel: "Отмена",
    copyWalletConnectUri: "Копировать Auro WalletConnect URL",
    showWalletConnectQr: "Показать QR подключения",
    hideWalletConnectQr: "Скрыть QR подключения",
    walletConnectQrAuro: "Ссылка Auro",
    walletConnectQrWc: "WC URI",
    walletConnectPrompt: "Подтвердите запрос WalletConnect в Auro, затем вернитесь сюда.",
    timeline: "Хронология"
  },
  de: {
    ...copy.en,
    walletPrompt: "Verbinde dein Wallet, um zu starten.",
    noPseudo: "Nicht konfiguriert",
    player: "Spieler",
    pseudo: "Pseudonym",
    network: "Netzwerk",
    balance: "Kontostand",
    loading: "Laden",
    unavailable: "Nicht verfugbar",
    connectWallet: "Wallet verbinden",
    disconnectWallet: "Trennen",
    walletConnected: "Wallet verbunden",
    newChallenge: "Neue Challenge",
    stake: "Einsatz in MINA",
    payoutMode: "Auszahlungsmodus",
    classicPayout: "Klassischer Pot",
    opponentTakesAll: "Gegner gewinnt alles",
    opponentTakesAllHint: "Der Gegner zahlt keinen Einsatz ein. Gewinnt er, erhalt er den Einsatz des Erstellers; sonst wird der Ersteller refunded.",
    refundTimeout: "Refund-Timeout (Slots)",
    create: "Erstellen",
    games: "Spiele",
    activeStatuses: "Aktive Spiele",
    myActiveStatuses: "Meine aktiven Spiele",
    allStatuses: "Alle Status",
    allNetworks: "Alle Netzwerke",
    searchPlayer: "Spieler suchen",
    searchGameId: "Game-ID suchen",
    previous: "Zuruck",
    next: "Weiter",
    page: "Seite",
    draw: "Unentschieden",
    indexed: "indexiert",
    challenge: "Challenge",
    creator: "Ersteller",
    opponent: "Gegner",
    waiting: "Warten",
    transaction: "Transaktion",
    refund: "Refund",
    currentSlot: "Aktueller Slot",
    notConfigured: "Nicht konfiguriert",
    onchainState: "On-chain Status",
    signaturePending: "Signatur gesendet oder Hash ausstehend",
    creationFailed: "On-chain Erstellung fehlgeschlagen",
    waitingCreation: "Warte auf Erstellungsbestatigung",
    waitingJoin: "Warte auf Join-Bestatigung",
    joinPending: "Join-Transaktion ausstehend",
    confirmJoin: "Join bestatigen",
    releaseJoin: "Join freigeben",
    actionsAvailable: "Aktionen fur diesen Spielstatus verfugbar",
    enterHash: "Hash eingeben",
    resignCreation: "Neu signieren",
    markFailed: "Als fehlgeschlagen markieren",
    markIncluded: "Als enthalten markieren",
    confirmIncluded: "Diese Transaktion als enthalten markieren? Bitte zuerst im Explorer prufen.",
    transactionIncluded: "Transaktion als enthalten markiert.",
    join: "Beitreten",
    reveal: "Reveal",
    settle: "Settle",
    enterSettlementHash: "Settlement-Hash eingeben",
    pasteSettlementHash: "Settlement-Transaktionshash aus Auro oder Explorer einfugen.",
    settlementHashSaved: "Settlement-Hash gespeichert. On-chain Sync wird gepruft.",
    refundedGame: "Spiel refunded",
    failedGame: "Erstellung fehlgeschlagen",
    emptyGames: "Noch keine Spiele.",
    choosePseudo: "Pseudonym wahlen",
    editPseudo: "Pseudonym bearbeiten",
    save: "Speichern",
    zkWorkNotice: "Kompilierung und Beweiserzeugung konnen im Browser dauern.",
    elapsed: "Verstrichen",
    progressSwitchNetwork: "Wallet-Netzwerk wechseln",
    progressCompileCircuit: "ZK-Schaltkreis kompilieren",
    progressCircuitReady: "ZK-Schaltkreis bereit",
    progressWalletSignature: "Wallet-Signatur",
    progressTransactionProvided: "Transaktion angegeben",
    progressWalletNoAutoReturn: "Wallet ist nicht automatisch zuruckgekehrt",
    progressTransactionSent: "Transaktion gesendet",
    progressGenerateProof: "Proof erzeugen",
    progressProofGenerated: "Proof erzeugt",
    refresh: "Aktualisieren",
    settings: "Einstellungen",
    language: "Sprache",
    theme: "Theme",
    lightTheme: "Hell",
    darkTheme: "Dunkel",
    displayMode: "Anzeige",
    cardsMode: "Karten",
    appMode: "App",
    credits: "Credits",
    walletTab: "Wallet",
    newGameTab: "Neu",
    gamesTab: "Spiele",
    messages: "Nachrichten",
    backToGames: "Zuruck zu Spielen",
    walletAddress: "Wallet-Adresse",
    chooseNetwork: "Netzwerk wahlen",
    activeNetwork: "Aktiv",
    enableNotifications: "Benachrichtigungen fur dieses Spiel aktivieren",
    disableNotifications: "Benachrichtigungen fur dieses Spiel deaktivieren",
    secret: "Secret",
    showSecret: "Secret anzeigen",
    copySecret: "Secret kopieren",
    pasteSecret: "Secret einfugen",
    walletMissing: "Mina-Wallet nicht gefunden. Installiere Auro oder aktiviere die Erweiterung.",
    createdOnchain: "Challenge on-chain erstellt und indexiert.",
    joinPendingMessage: "Join-Transaktion gesendet. Warte auf On-chain Aufnahme vor Reveal.",
    bothRevealed: "Beide Secrets sind revealed. Ergebnis lokal berechnet; Settlement verifiziert und zahlt on-chain.",
    waitingOtherReveal: "Secret revealed. Warte auf den anderen Spieler.",
    settledOnchain: "Spiel on-chain settled und indexiert.",
    refundSent: "Refund on-chain gesendet und indexiert.",
    cancelGame: "Spiel abbrechen",
    minaZkDice: "Mina / Zeko ZK Wurfel",
    openAuro: "Auro offnen",
    openAuroFallback: "Auro direkt offnen",
    cancel: "Abbrechen",
    copyWalletConnectUri: "Auro WalletConnect URL kopieren",
    showWalletConnectQr: "Verbindungs-QR anzeigen",
    hideWalletConnectQr: "Verbindungs-QR ausblenden",
    walletConnectQrAuro: "Auro-Link",
    walletConnectQrWc: "WC URI",
    walletConnectPrompt: "Bestatige die WalletConnect-Anfrage in Auro und kehre dann hierher zuruck.",
    timeline: "Timeline"
  },
  ja: {
    ...copy.en,
    walletPrompt: "開始するにはウォレットを接続してください。",
    noPseudo: "未設定",
    player: "プレイヤー",
    pseudo: "ニックネーム",
    network: "ネットワーク",
    balance: "残高",
    loading: "読み込み中",
    unavailable: "利用不可",
    connectWallet: "ウォレット接続",
    disconnectWallet: "切断",
    walletConnected: "ウォレット接続済み",
    newChallenge: "新しいチャレンジ",
    stake: "MINA ベット",
    payoutMode: "支払いモード",
    classicPayout: "通常ポット",
    opponentTakesAll: "相手が総取り",
    opponentTakesAllHint: "相手はベットを預けません。相手が勝つと作成者のベットを受け取り、それ以外は作成者へ返金されます。",
    refundTimeout: "返金タイムアウト（slot）",
    create: "作成",
    games: "ゲーム",
    activeStatuses: "アクティブなゲーム",
    myActiveStatuses: "自分のアクティブゲーム",
    allStatuses: "すべての状態",
    searchPlayer: "プレイヤー検索",
    searchGameId: "ゲームID検索",
    challenge: "チャレンジ",
    creator: "作成者",
    opponent: "対戦相手",
    waiting: "待機中",
    transaction: "トランザクション",
    refund: "返金",
    currentSlot: "現在の slot",
    onchainState: "オンチェーン状態",
    joinPending: "Join トランザクション待機中",
    join: "参加",
    reveal: "Reveal",
    settle: "Settle",
    refresh: "更新",
    settings: "設定",
    language: "言語",
    theme: "テーマ",
    displayMode: "表示モード",
    walletTab: "ウォレット",
    newGameTab: "新規",
    gamesTab: "ゲーム",
    messages: "メッセージ",
    chooseNetwork: "ネットワーク選択",
    enableNotifications: "このゲームの通知を有効化",
    disableNotifications: "このゲームの通知を無効化",
    secret: "シークレット",
    showSecret: "シークレット表示",
    copySecret: "シークレットをコピー",
    pasteSecret: "シークレット貼り付け",
    walletMissing: "Mina ウォレットが見つかりません。Auro をインストールするか拡張機能を有効にしてください。",
    createdOnchain: "チャレンジをオンチェーンで作成し、インデックスしました。",
    joinPendingMessage: "Join トランザクションを送信しました。Reveal 前にオンチェーン取り込みを待っています。",
    bothRevealed: "両方のシークレットが公開されました。結果はローカルで計算され、settlement がオンチェーンで検証して支払います。",
    waitingOtherReveal: "シークレットを公開しました。相手プレイヤーを待っています。",
    settledOnchain: "ゲームはオンチェーンで settle され、インデックスされました。",
    refundSent: "返金をオンチェーンに送信し、インデックスしました。",
    cancelGame: "ゲームをキャンセル",
    minaZkDice: "Mina / Zeko ZK サイコロ",
    openAuro: "Auro を開く",
    openAuroFallback: "Auro を直接開く",
    cancel: "キャンセル",
    copyWalletConnectUri: "Auro WalletConnect URL をコピー",
    showWalletConnectQr: "接続 QR コードを表示",
    hideWalletConnectQr: "接続 QR コードを非表示",
    walletConnectQrAuro: "Auro リンク",
    walletConnectQrWc: "WC URI",
    walletConnectPrompt: "Auro で WalletConnect リクエストを承認し、このページに戻ってください。",
    timeline: "タイムライン"
  },
  es: {
    ...copy.en,
    walletPrompt: "Conecta tu wallet para empezar.",
    noPseudo: "No configurado",
    player: "Jugador",
    pseudo: "Pseudo",
    network: "Red",
    balance: "Saldo",
    loading: "Cargando",
    unavailable: "No disponible",
    connectWallet: "Conectar wallet",
    disconnectWallet: "Desconectar",
    walletConnected: "Wallet conectada",
    newChallenge: "Nuevo desafio",
    stake: "Apuesta en MINA",
    payoutMode: "Modo de pago",
    classicPayout: "Bote clasico",
    opponentTakesAll: "El oponente se lleva todo",
    opponentTakesAllHint: "El oponente no deposita apuesta. Si gana, recibe la apuesta del creador; si no, el creador recibe el reembolso.",
    refundTimeout: "Timeout de reembolso (slots)",
    create: "Crear",
    games: "Partidas",
    activeStatuses: "Partidas activas",
    myActiveStatuses: "Mis partidas activas",
    allStatuses: "Todos los estados",
    allNetworks: "Todas las redes",
    searchPlayer: "Buscar jugador",
    searchGameId: "Buscar game id",
    previous: "Anterior",
    next: "Siguiente",
    page: "Pagina",
    draw: "Empate",
    indexed: "indexadas",
    challenge: "Desafio",
    creator: "Creador",
    opponent: "Oponente",
    waiting: "Esperando",
    transaction: "Transaccion",
    refund: "Reembolso",
    currentSlot: "Slot actual",
    notConfigured: "No configurado",
    onchainState: "Estado on-chain",
    signaturePending: "Firma enviada o esperando hash",
    creationFailed: "Creacion fallida on-chain",
    waitingCreation: "Esperando confirmacion de creacion",
    waitingJoin: "Esperando confirmacion de join",
    joinPending: "Transaccion join pendiente",
    confirmJoin: "Confirmar join",
    releaseJoin: "Liberar join",
    actionsAvailable: "Acciones disponibles para este estado",
    enterHash: "Ingresar hash",
    resignCreation: "Firmar de nuevo",
    markFailed: "Marcar fallida",
    markIncluded: "Marcar incluida",
    confirmIncluded: "Marcar esta transaccion como incluida? Hazlo solo tras verificar el explorador.",
    transactionIncluded: "Transaccion marcada como incluida.",
    join: "Unirse",
    reveal: "Reveal",
    settle: "Settle",
    enterSettlementHash: "Ingresar hash de settlement",
    pasteSettlementHash: "Pega el hash de la transaccion settlement visible en Auro o el explorador.",
    settlementHashSaved: "Hash de settlement guardado. Se verificara la sincronizacion on-chain.",
    refundedGame: "Partida reembolsada",
    failedGame: "Creacion fallida",
    noLockedFunds: "El contrato no bloqueo fondos.",
    emptyGames: "Aun no hay partidas.",
    choosePseudo: "Elige un pseudo",
    editPseudo: "Editar pseudo",
    pseudoNotice: "Este pseudo se asociara a tu wallet en la base local.",
    save: "Guardar",
    zkWorkNotice: "La compilacion y la generacion de prueba pueden tardar en el navegador.",
    elapsed: "Transcurrido",
    progressSwitchNetwork: "Cambiando red del wallet",
    progressCompileCircuit: "Compilando circuito ZK",
    progressCircuitReady: "Circuito ZK listo",
    progressWalletSignature: "Firma wallet",
    progressTransactionProvided: "Transaccion proporcionada",
    progressWalletNoAutoReturn: "El wallet no volvio automaticamente",
    progressTransactionSent: "Transaccion enviada",
    progressGenerateProof: "Generando prueba",
    progressProofGenerated: "Prueba generada",
    refresh: "Refrescar",
    settings: "Configuracion",
    language: "Idioma",
    theme: "Tema",
    lightTheme: "Claro",
    darkTheme: "Oscuro",
    displayMode: "Modo de vista",
    cardsMode: "Tarjetas",
    appMode: "Aplicacion",
    credits: "Creditos",
    walletTab: "Wallet",
    newGameTab: "Nueva",
    gamesTab: "Partidas",
    messages: "Mensajes",
    backToGames: "Volver a partidas",
    walletAddress: "Direccion wallet",
    chooseNetwork: "Elegir red",
    activeNetwork: "Activa",
    enableNotifications: "Activar notificaciones para esta partida",
    disableNotifications: "Desactivar notificaciones para esta partida",
    secret: "Secreto",
    showSecret: "Mostrar secreto",
    copySecret: "Copiar secreto",
    pasteSecret: "Pegar secreto",
    walletMissing: "Wallet Mina no encontrada. Instala Auro o activa la extension.",
    createdOnchain: "Desafio creado on-chain e indexado.",
    joinPendingMessage: "Transaccion join enviada. Esperando inclusion on-chain antes del reveal.",
    bothRevealed: "Ambos secretos fueron revelados. El resultado se calcula localmente; settlement verificara y pagara on-chain.",
    waitingOtherReveal: "Secreto revelado. Esperando al otro jugador.",
    settledOnchain: "Partida settled on-chain e indexada.",
    refundSent: "Reembolso enviado on-chain e indexado.",
    cancelGame: "Cancelar partida",
    minaZkDice: "Mina / Zeko ZK dados",
    openAuro: "Abrir Auro",
    openAuroFallback: "Abrir Auro directamente",
    cancel: "Cancelar",
    copyWalletConnectUri: "Copiar URL Auro WalletConnect",
    showWalletConnectQr: "Mostrar QR de conexion",
    hideWalletConnectQr: "Ocultar QR de conexion",
    walletConnectQrAuro: "Enlace Auro",
    walletConnectQrWc: "URI WC",
    walletConnectPrompt: "Aprueba la solicitud WalletConnect en Auro y vuelve aqui.",
    timeline: "Linea de tiempo"
  }
});

const englishCopy = copy.en as Record<string, string>;
const initialMessage = englishCopy.walletPrompt ?? "Connect your wallet to start.";

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

function payoutNanoMinaForWinner(game: Game): bigint {
  if (game.status !== "settled" || !game.winnerPublicKey) return 0n;
  const stake = BigInt(game.stakeNanoMina);
  return game.payoutMode === "opponent_takes_all" ? stake : stake * 2n;
}

function formatBalance(value: string | null, locale: Locale): string {
  if (!value) return "-";
  return `${(Number(value) / nanoMina).toLocaleString(localeTag(locale), {
    maximumFractionDigits: 6
  })} MINA`;
}

function formatDateTime(value: string | null | undefined, locale: Locale): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function localeTag(locale: Locale) {
  return (
    {
      en: "en-US",
      fr: "fr-FR",
      zh: "zh-CN",
      tr: "tr-TR",
      ru: "ru-RU",
      de: "de-DE",
      ja: "ja-JP",
      es: "es-ES"
    } satisfies Record<Locale, string>
  )[locale];
}

function networkFromString(value: string | null): NetworkId | null {
  return value && value in networks ? (value as NetworkId) : null;
}

function savedNetwork(): NetworkId {
  if (typeof window === "undefined") return "devnet";
  return networkFromString(localStorage.getItem("zkroll:network")) ?? "devnet";
}

function randomPseudo() {
  const adjective = pseudoAdjectives[Math.floor(Math.random() * pseudoAdjectives.length)];
  const name = pseudoNames[Math.floor(Math.random() * pseudoNames.length)];
  const suffix = Math.floor(10 + Math.random() * 90);
  return `${adjective}${name}${suffix}`;
}

function initialDeepLinkedGameTarget(): { id: string; network: NetworkId } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("game");
  const network = networkFromString(params.get("network"));
  return id && network ? { id, network } : null;
}

async function refundDeadlineForCreate(network: NetworkId, timeoutSlots: number) {
  const currentSlot = (await getCurrentSlot(network)).currentSlot;
  return nextRefundDeadlineSlot(currentSlot, timeoutSlots);
}

async function strictRefundDeadlineForJoin(network: NetworkId, timeoutSlots: number, previousDeadlineSlot: string) {
  const currentSlot = (await getCurrentSlot(network, { refresh: true })).currentSlot;
  return nextStrictRefundDeadlineSlot(currentSlot, timeoutSlots, previousDeadlineSlot);
}

type PendingCreationMaterial = {
  zkappPrivateKey: string;
  secret: string;
  invitedPublicKey?: string;
  createdAt: string;
};

type PendingJoinMaterial = {
  pseudo: string;
  joinerPublicKey: string;
  secret: string;
  joinerPseudoHash?: string;
  joinerCommitment: string;
  refundDeadlineSlot: string;
  createdAt: string;
};

function pendingCreationStorageKey(gameId: string, creatorPublicKey: string) {
  return `zkroll:pending-creation:${gameId}:${creatorPublicKey}`;
}

function pendingJoinStorageKey(gameId: string, joinerPublicKey: string) {
  return `zkroll:pending-join:${gameId}:${joinerPublicKey}`;
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

function loadPendingJoinMaterial(game: Game, publicKey: string): PendingJoinMaterial | null {
  if (!publicKey || game.creatorPublicKey === publicKey) return null;
  try {
    const value = localStorage.getItem(pendingJoinStorageKey(game.id, publicKey));
    return value ? (JSON.parse(value) as PendingJoinMaterial) : null;
  } catch {
    return null;
  }
}

function savePendingCreationMaterial(game: Game, secret: string, zkappPrivateKey: string, invitedPublicKey?: string) {
  localStorage.setItem(
    pendingCreationStorageKey(game.id, game.creatorPublicKey),
    JSON.stringify({ zkappPrivateKey, secret, invitedPublicKey: invitedPublicKey || undefined, createdAt: new Date().toISOString() } satisfies PendingCreationMaterial)
  );
}

function savePendingJoinMaterial(game: Game, input: Omit<PendingJoinMaterial, "createdAt">) {
  localStorage.setItem(
    pendingJoinStorageKey(game.id, input.joinerPublicKey),
    JSON.stringify({ ...input, createdAt: new Date().toISOString() } satisfies PendingJoinMaterial)
  );
}

function removePendingCreationMaterial(game: Game) {
  localStorage.removeItem(pendingCreationStorageKey(game.id, game.creatorPublicKey));
}

function App() {
  const initialGameTarget = useMemo(() => initialDeepLinkedGameTarget(), []);
  const [locale, setLocale] = useState<Locale>(() => savedLocale());
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("zkroll:theme") === "dark" ? "dark" : "light"));
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem("zkroll:view-mode") === "app" ? "app" : "cards"));
  const [appScreen, setAppScreen] = useState<AppScreen>("games");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [pseudo, setPseudo] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [pseudoDraft, setPseudoDraft] = useState("");
  const [pseudoModalOpen, setPseudoModalOpen] = useState(false);
  const [network, setNetwork] = useState<NetworkId>(() => initialGameTarget?.network ?? savedNetwork());
  const [stake, setStake] = useState("1");
  const [payoutMode, setPayoutMode] = useState<PayoutMode>("classic");
  const [refundTimeoutSlots, setRefundTimeoutSlots] = useState(String(defaultRefundTimeoutSlots));
  const [previousOpponents, setPreviousOpponents] = useState<Player[]>([]);
  const [inviteePublicKey, setInviteePublicKey] = useState("");
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(() => initialGameTarget?.id ?? null);
  const [deepLinkedGameTarget, setDeepLinkedGameTarget] = useState<{ id: string; network: NetworkId } | null>(() => initialGameTarget);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("mine_active");
  const [playerSearch, setPlayerSearch] = useState("");
  const [gameIdSearch, setGameIdSearch] = useState("");
  const [gamesPage, setGamesPage] = useState(1);
  const [leaderboardPage, setLeaderboardPage] = useState(1);
  const [secretVault, setSecretVault] = useState<Record<string, string>>({});
  const [rollingGameId, setRollingGameId] = useState<string | null>(null);
  const [previewDice, setPreviewDice] = useState<Record<string, { creatorDie: number; joinerDie: number }>>({});
  const [rollFrames, setRollFrames] = useState<Record<string, { creatorDie: number; joinerDie: number }>>({});
  const [busy, setBusy] = useState(false);
  const [onchainProgress, setOnchainProgress] = useState<OnchainProgress | null>(null);
  const [onchainStartedAt, setOnchainStartedAt] = useState<number | null>(null);
  const [onchainElapsedSeconds, setOnchainElapsedSeconds] = useState(0);
  const [manualSignatureHash, setManualSignatureHash] = useState("");
  const [failureDialogGame, setFailureDialogGame] = useState<Game | null>(null);
  const [failureReasonKind, setFailureReasonKind] = useState<"localSignature" | "onchainCreation" | "other">("onchainCreation");
  const [failureReasonText, setFailureReasonText] = useState("");
  const [txStatuses, setTxStatuses] = useState<Record<string, TxStatus>>({});
  const txStatusesRef = useRef(txStatuses);
  const [currentSlots, setCurrentSlots] = useState<Record<NetworkId, string | null>>({
    mainnet: null,
    devnet: null,
    zeko: null
  });
  const [walletBalance, setWalletBalance] = useState<{ value: string | null; loading: boolean; error: string | null }>({
    value: null,
    loading: false,
    error: null
  });
  const [notificationGameIds, setNotificationGameIds] = useState<Set<string>>(new Set());
  const [newGameNotificationNetworks, setNewGameNotificationNetworks] = useState<Set<NetworkId>>(new Set());
  const [firebaseToken, setFirebaseToken] = useState<string | null>(null);
  const [secretModalGameId, setSecretModalGameId] = useState<string | null>(null);
  const [secretQrDataUrl, setSecretQrDataUrl] = useState<string | null>(null);
  const [scannerGameId, setScannerGameId] = useState<string | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const [provingCompatibility, setProvingCompatibility] = useState<ProvingCompatibility | null>(null);
  const [walletConnectPrompt, setWalletConnectPrompt] = useState<WalletConnectPrompt | null>(null);
  const [walletConnectQrDataUrl, setWalletConnectQrDataUrl] = useState<string | null>(null);
  const [walletConnectQrMode, setWalletConnectQrMode] = useState<WalletConnectQrMode>("wc");
  const [showAuroInstall, setShowAuroInstall] = useState(false);
  const t = (key: string) => (copy[locale] ?? englishCopy)[key] ?? englishCopy[key] ?? key;
  const [message, setMessage] = useState(initialMessage);
  const [messageHistory, setMessageHistory] = useState<string[]>(() => [initialMessage]);
  const [gameMessages, setGameMessages] = useState<Record<string, GameMessage[]>>({});
  const [unreadMessageCounts, setUnreadMessageCounts] = useState<Record<string, number>>({});
  const [playerMessagePrefs, setPlayerMessagePrefs] = useState<Record<string, boolean>>({});
  const [playerPseudosByPublicKey, setPlayerPseudosByPublicKey] = useState<Record<string, string>>({});
  const [messageDialog, setMessageDialog] = useState<{ game: Game; receiverPublicKey: string; receiverPseudo: string } | null>(null);
  const [messageDraft, setMessageDraft] = useState("");

  const visibleGames = useMemo(
    () => games.filter((game) => game.network === network && (game.status !== "pending_signature" || game.creatorPublicKey === publicKey)),
    [games, network, publicKey]
  );

  const visibleGamePlayerKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const game of visibleGames) {
      keys.add(game.creatorPublicKey);
      if (game.joinerPublicKey) keys.add(game.joinerPublicKey);
    }
    return Array.from(keys).sort();
  }, [visibleGames]);
  const visibleGamePlayerKey = visibleGamePlayerKeys.join("|");

  const leaderboardRows = useMemo(() => {
    const rows = new Map<
      string,
      { publicKey: string; pseudo: string; pseudoSeenAt: number; gamesPlayed: number; gamesWon: number; amountWonNanoMina: bigint }
    >();
    const ensureRow = (publicKeyValue: string, pseudoValue: string, pseudoSeenAt: number) => {
      const displayPseudo = playerPseudosByPublicKey[publicKeyValue] ?? pseudoValue;
      const existing = rows.get(publicKeyValue);
      if (existing) {
        if (displayPseudo && (playerPseudosByPublicKey[publicKeyValue] || pseudoSeenAt >= existing.pseudoSeenAt)) {
          existing.pseudo = displayPseudo;
          existing.pseudoSeenAt = pseudoSeenAt;
        }
        return existing;
      }
      const created = {
        publicKey: publicKeyValue,
        pseudo: displayPseudo,
        pseudoSeenAt,
        gamesPlayed: 0,
        gamesWon: 0,
        amountWonNanoMina: 0n
      };
      rows.set(publicKeyValue, created);
      return created;
    };

    visibleGames
      .filter((game) => game.status !== "pending_signature" && game.status !== "failed")
      .forEach((game) => {
        const pseudoSeenAt = new Date(game.updatedAt ?? game.createdAt).getTime();
        ensureRow(game.creatorPublicKey, game.creatorPseudo, pseudoSeenAt).gamesPlayed += 1;
        if (game.joinerPublicKey && game.joinerPseudo) {
          ensureRow(game.joinerPublicKey, game.joinerPseudo, pseudoSeenAt).gamesPlayed += 1;
        }
        if (game.status === "settled" && game.winnerPublicKey) {
          const winnerPseudo =
            game.winnerPublicKey === game.creatorPublicKey ? game.creatorPseudo : game.joinerPseudo ?? game.winnerPublicKey;
          const winner = ensureRow(game.winnerPublicKey, winnerPseudo, pseudoSeenAt);
          winner.gamesWon += 1;
          winner.amountWonNanoMina += payoutNanoMinaForWinner(game);
        }
      });

    return Array.from(rows.values())
      .map(
        ({ pseudoSeenAt, ...row }) =>
          ({ ...row, amountWonNanoMina: row.amountWonNanoMina.toString() } satisfies LeaderboardRow)
      )
      .sort((left, right) => {
        const wonDiff = right.gamesWon - left.gamesWon;
        if (wonDiff !== 0) return wonDiff;
        const amountDiff = BigInt(right.amountWonNanoMina) - BigInt(left.amountWonNanoMina);
        if (amountDiff !== 0n) return amountDiff > 0n ? 1 : -1;
        return right.gamesPlayed - left.gamesPlayed;
      });
  }, [playerPseudosByPublicKey, visibleGames]);

  const filteredGames = useMemo(() => {
    const playerNeedle = playerSearch.trim().toLowerCase();
    const gameIdNeedle = gameIdSearch.trim().toLowerCase();
    return visibleGames
      .filter((game) => {
        const statusMatches =
          statusFilter === "active"
            ? !terminalGameStatuses.has(game.status)
            : statusFilter === "mine_active"
              ? !terminalGameStatuses.has(game.status) &&
                Boolean(publicKey) &&
                (game.creatorPublicKey === publicKey || game.joinerPublicKey === publicKey)
            : statusFilter === "all" || game.status === statusFilter;
        const searchMatches =
          !playerNeedle ||
          game.creatorPseudo.toLowerCase().includes(playerNeedle) ||
          (game.joinerPseudo?.toLowerCase().includes(playerNeedle) ?? false);
        const gameIdMatches = !gameIdNeedle || game.id.toLowerCase().includes(gameIdNeedle);
        return statusMatches && searchMatches && gameIdMatches;
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [gameIdSearch, playerSearch, publicKey, statusFilter, visibleGames]);

  const totalGamePages = Math.max(1, Math.ceil(filteredGames.length / gamesPerPage));
  const paginatedGames = useMemo(
    () => filteredGames.slice((gamesPage - 1) * gamesPerPage, gamesPage * gamesPerPage),
    [filteredGames, gamesPage]
  );
  const totalLeaderboardPages = Math.max(1, Math.ceil(leaderboardRows.length / leaderboardPerPage));
  const leaderboardStartIndex = (leaderboardPage - 1) * leaderboardPerPage;
  const paginatedLeaderboardRows = useMemo(
    () => leaderboardRows.slice(leaderboardStartIndex, leaderboardPage * leaderboardPerPage),
    [leaderboardRows, leaderboardPage, leaderboardStartIndex]
  );

  const selectedGame = useMemo(
    () => {
      const target = deepLinkedGameTarget && selectedGameId === deepLinkedGameTarget.id ? deepLinkedGameTarget : null;
      if (target) return games.find((game) => game.id === target.id && game.network === target.network) ?? null;
      if (selectedGameId) return games.find((game) => game.id === selectedGameId && game.network === network) ?? null;
      return (
        filteredGames[0] ??
        null
      );
    },
    [deepLinkedGameTarget, filteredGames, games, network, selectedGameId]
  );

  const selectedGameTxs = useMemo(() => {
    if (!selectedGame) return [];
    return [
      { network: selectedGame.network, hash: selectedGame.creationTxHash },
      { network: selectedGame.network, hash: selectedGame.joinTxHash },
      { network: selectedGame.network, hash: selectedGame.settlementTxHash },
      { network: selectedGame.network, hash: selectedGame.refundTxHash }
    ].filter((item): item is { network: NetworkId; hash: string } => Boolean(item.hash) && isExplorerHash(item.hash));
  }, [
    selectedGame?.creationTxHash,
    selectedGame?.joinTxHash,
    selectedGame?.network,
    selectedGame?.refundTxHash,
    selectedGame?.settlementTxHash
  ]);

  const totalUnreadMessages = useMemo(
    () => Object.values(unreadMessageCounts).reduce((sum, count) => sum + count, 0),
    [unreadMessageCounts]
  );

  async function refreshGames() {
    const nextGames = await listGames();
    void refreshUnreadMessages().catch(() => undefined);
    setGames(nextGames);
    setNotificationGameIds((current) => {
      const next = new Set(current);
      for (const game of nextGames) {
        if (terminalGameStatuses.has(game.status)) next.delete(game.id);
      }
      return next;
    });
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
    const nextVisibleGames = nextGames.filter(
      (game) => game.network === network && (game.status !== "pending_signature" || game.creatorPublicKey === publicKey)
    );
    if (!selectedGameId && nextVisibleGames[0]) setSelectedGameId(nextVisibleGames[0].id);
    return nextGames;
  }

  function updateGameInState(game: Game) {
    setGames((current) => {
      const existingIndex = current.findIndex((item) => item.id === game.id);
      if (existingIndex === -1) return [game, ...current];
      return current.map((item) => (item.id === game.id ? game : item));
    });
    setSelectedGameId(game.id);
  }

  async function refreshUnreadMessages() {
    if (!publicKey) {
      setUnreadMessageCounts({});
      return;
    }
    const result = await getUnreadMessageCounts(publicKey);
    setUnreadMessageCounts(result.counts);
  }

  async function refreshMessagesFor(game: Game | null) {
    if (!game || !publicKey || (publicKey !== game.creatorPublicKey && publicKey !== game.joinerPublicKey)) return;
    const result = await listGameMessages(game.id, publicKey);
    setGameMessages((current) => ({ ...current, [game.id]: result.items }));
    await markGameMessagesRead(game.id, publicKey);
    await refreshUnreadMessages();
  }

  async function refreshVisiblePlayerMessages() {
    if (!publicKey) return;
    const playerGames = visibleGames.filter((game) => publicKey === game.creatorPublicKey || publicKey === game.joinerPublicKey);
    if (playerGames.length === 0) return;
    const results = await Promise.allSettled(playerGames.map((game) => listGameMessages(game.id, publicKey)));
    setGameMessages((current) => {
      const next = { ...current };
      for (let index = 0; index < playerGames.length; index += 1) {
        const game = playerGames[index];
        const result = results[index];
        if (game && result?.status === "fulfilled") {
          next[game.id] = result.value.items;
        }
      }
      return next;
    });
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

  function assertGameTransactionHashAvailable(game: Game, kind: TransactionKind, hash: string) {
    const duplicate = [
      { kind: "creation", hash: game.creationTxHash },
      { kind: "join", hash: game.joinTxHash },
      { kind: "settlement", hash: game.settlementTxHash },
      { kind: "refund", hash: game.refundTxHash }
    ].find((item) => item.kind !== kind && item.hash === hash);
    if (duplicate) {
      throw new Error(t("transactionHashAlreadyUsed").replace("{kind}", duplicate.kind));
    }
  }

  function txExplorerUrl(networkId: NetworkId, hash: string) {
    return `${networks[networkId].explorerBaseUrl}/${encodeURIComponent(hash)}`;
  }

  function accountExplorerUrl(networkId: NetworkId, address: string) {
    if (networkId === "zeko") return `https://zekoscan.io/account/${encodeURIComponent(address)}/zk-txs`;
    return `https://minascan.io/${networkId}/account/${encodeURIComponent(address)}/zk-txs`;
  }

  function compactGameMemo(action: string, gameId?: string | null) {
    const suffix = gameId ? ` ${gameId.slice(0, 12)}` : "";
    return `zkroll ${action}${suffix}`.slice(0, 32);
  }

  function pendingRecoveryMemo(game: Game) {
    if (game.status === "pending_signature" && game.creationTxHash.startsWith("pending:")) {
      return compactGameMemo("create", game.id);
    }
    if (game.status === "join_pending" && game.joinTxHash?.startsWith("pending:")) {
      return compactGameMemo("join", game.gameIdField);
    }
    if (game.settlementTxHash?.startsWith("pending:settle:")) {
      return compactGameMemo("settle", game.gameIdField);
    }
    if (game.refundTxHash?.startsWith("pending:cancel:")) {
      return compactGameMemo("cancel", game.gameIdField);
    }
    if (game.refundTxHash?.startsWith("pending:refund:")) {
      return compactGameMemo("refund", game.gameIdField);
    }
    return null;
  }

  function displayTx(networkId: NetworkId, hash: string | null | undefined) {
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
      </span>
    );
  }

  function canRecoverReleasedJoin(game: Game) {
    return Boolean(
      onchainEnabled &&
        game.status === "created" &&
        !game.joinTxHash &&
        publicKey &&
        game.creatorPublicKey !== publicKey &&
        (secretFor(game) || loadPendingJoinMaterial(game, publicKey))
    );
  }

  function transactionActions(game: Game, kind: TransactionKind, hash: string | null | undefined, status?: TxStatus) {
    const effectiveStatus = status ?? statusFor(hash);
    const isIncluded = effectiveStatus === "INCLUDED";
    const canChangeCreation =
      kind === "creation" &&
      game.creatorPublicKey === publicKey &&
      (game.status === "pending_signature" || game.status === "created") &&
      creationStatusFor(game) !== "INCLUDED";
    const canChangeJoin =
      kind === "join" &&
      ((game.status === "join_pending" && !isReservedInvite(game) && game.joinerPublicKey === publicKey && statusFor(game.joinTxHash) !== "INCLUDED") ||
        canRecoverReleasedJoin(game));
    const canChangeSettlement = kind === "settlement" && (hasPendingSettlement(game) || canSettle(game));
    const canChangeRefund = kind === "refund" && (hasPendingRefund(game) || canCancelOrRefund(game) || canRefund(game));
    const canClearSettlement = kind === "settlement" && Boolean(hash) && !isIncluded;
    const canClearRefund = kind === "refund" && Boolean(hash) && !isIncluded;
    const canReleaseJoin =
      kind === "join" &&
      game.status === "join_pending" &&
      Boolean(hash) &&
      !isIncluded &&
      (game.creatorPublicKey === publicKey || game.joinerPublicKey === publicKey);
    const canMarkIncluded = effectiveStatus === "PENDING" && isExplorerHash(hash);

    return (
      <span className="txRecoveryActions">
        {canMarkIncluded && (
          <button
            className="txAction"
            disabled={busy}
            onClick={() => void handleMarkTransactionIncluded(game.network, hash!)}
            type="button"
          >
            {t("markIncluded")}
          </button>
        )}
        {game.zkappAddress && (
          <a className="txAction" href={accountExplorerUrl(game.network, game.zkappAddress)} rel="noreferrer" target="_blank">
            {t("verifyTransaction")}
          </a>
        )}
        {canChangeCreation && (
          <button className="txAction" disabled={busy} onClick={() => void handleReconcileCreation(game)} type="button">
            {hash?.startsWith("pending:") ? t("enterHash") : t("changeHash")}
          </button>
        )}
        {canChangeJoin && (
          <button className="txAction" disabled={busy} onClick={() => void handleReconcileJoin(game)} type="button">
            {hash?.startsWith("pending:") ? t("enterHash") : t("changeHash")}
          </button>
        )}
        {canChangeSettlement && (
          <button className="txAction" disabled={busy} onClick={() => void handleReconcileSettlement(game)} type="button">
            {hash?.startsWith("pending:") || !hash ? t("enterSettlementHash") : t("changeHash")}
          </button>
        )}
        {canChangeRefund && (
          <button className="txAction" disabled={busy} onClick={() => void handleReconcileRefund(game)} type="button">
            {hash?.startsWith("pending:") || !hash ? t("enterRefundHash") : t("changeHash")}
          </button>
        )}
        {kind === "creation" && game.status === "pending_signature" && (
          <>
            <button
              className="txAction"
              disabled={busy || game.creatorPublicKey !== publicKey || !loadPendingCreationMaterial(game, publicKey)}
              onClick={() => void handleResignCreation(game)}
              type="button"
            >
              {t("resignCreation")}
            </button>
            <button className="txAction dangerMini" disabled={busy || game.creatorPublicKey !== publicKey} onClick={() => void handleMarkCreationFailed(game)} type="button">
              {t("markFailed")}
            </button>
          </>
        )}
        {canReleaseJoin && (
          <button className="txAction dangerMini" disabled={busy} onClick={() => void handleReleaseJoin(game)} type="button">
            {t("releaseJoin")}
          </button>
        )}
        {canClearSettlement && (
          <button className="txAction dangerMini" disabled={busy} onClick={() => void handleClearPendingSettlement(game)} type="button">
            {t("clearPendingSettlement")}
          </button>
        )}
        {canClearRefund && (
          <button className="txAction dangerMini" disabled={busy} onClick={() => void handleClearPendingRefund(game)} type="button">
            {t("clearPendingRefund")}
          </button>
        )}
      </span>
    );
  }

  function transactionRow(game: Game, kind: TransactionKind, label: string, hash: string | null | undefined, status?: TxStatus) {
    if (!hash && kind !== "settlement" && kind !== "refund" && !(kind === "join" && canRecoverReleasedJoin(game))) return null;
    if (!hash && kind === "settlement" && !canSettle(game)) return null;
    if (!hash && kind === "refund" && !canCancelOrRefund(game) && !canRefund(game)) return null;

    return (
      <div>
        <dt className="transactionTitle">
          <span>{label}</span>
          {status && <span className={`txBadge ${status.toLowerCase()}`}>{status}</span>}
        </dt>
        <dd className="transactionCell">
          {hash ? displayTx(game.network, hash) : <span className="mutedText">{t("notConfigured")}</span>}
          {transactionActions(game, kind, hash, status)}
        </dd>
      </div>
    );
  }

  function leaderboardPanel() {
    return (
      <section className="panel leaderboardPanel">
        <div className="sectionHead">
          <h2>{t("leaderboard")}</h2>
          <Trophy size={20} />
        </div>
        {leaderboardRows.length > 0 ? (
          <>
            <div className="leaderboardList">
              {paginatedLeaderboardRows.map((row, index) => (
                <div className={row.publicKey === publicKey ? "leaderboardRow current" : "leaderboardRow"} key={row.publicKey}>
                  <span className="leaderboardRank">#{leaderboardStartIndex + index + 1}</span>
                  <strong>{row.pseudo}</strong>
                  <span>
                    {t("gamesPlayed")}: {row.gamesPlayed}
                  </span>
                  <span>
                    {t("gamesWon")}: {row.gamesWon}
                  </span>
                  <span>
                    {t("amountWon")}: {formatMina(row.amountWonNanoMina)} MINA
                  </span>
                </div>
              ))}
            </div>
            {leaderboardRows.length > leaderboardPerPage && (
              <div className="pagination leaderboardPagination">
                <button disabled={leaderboardPage === 1} onClick={() => setLeaderboardPage((page) => Math.max(1, page - 1))}>
                  {t("previous")}
                </button>
                <span>
                  {t("page")} {leaderboardPage} / {totalLeaderboardPages}
                </span>
                <button
                  disabled={leaderboardPage === totalLeaderboardPages}
                  onClick={() => setLeaderboardPage((page) => Math.min(totalLeaderboardPages, page + 1))}
                >
                  {t("next")}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="empty">{t("emptyLeaderboard")}</p>
        )}
      </section>
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

  function isActiveGame(game: Game) {
    return !terminalGameStatuses.has(game.status);
  }

  function creationStatusFor(game: Game): TxStatus {
    return game.status === "failed" ? "FAILED" : statusFor(game.creationTxHash);
  }

  function isReservedInvite(game: Game) {
    return game.status === "join_pending" && Boolean(game.joinTxHash?.startsWith("pending:invite:"));
  }

  function canJoin(game: Game): boolean {
    const openToCurrentPlayer =
      game.status === "created" || (isReservedInvite(game) && Boolean(publicKey) && game.joinerPublicKey === publicKey);
    return openToCurrentPlayer && creationStatusFor(game) === "INCLUDED" && hasSafeJoinDeadline(game);
  }

  function minJoinDeadlineMarginSlots(networkId: NetworkId) {
    return minJoinDeadlineMarginSlotsByNetwork[networkId] + joinDeadlineSafetySlots;
  }

  function remainingJoinDeadlineSlots(game: Game) {
    const currentSlot = currentSlots[game.network];
    if (!onchainEnabled || !game.refundDeadlineSlot || !currentSlot) return null;
    return BigInt(game.refundDeadlineSlot) - BigInt(currentSlot);
  }

  async function freshRemainingJoinDeadlineSlots(game: Game) {
    if (!onchainEnabled || !game.refundDeadlineSlot) return null;
    const result = await getCurrentSlot(game.network, { refresh: true });
    setCurrentSlots((current) => ({ ...current, [game.network]: result.currentSlot }));
    return BigInt(game.refundDeadlineSlot) - BigInt(result.currentSlot);
  }

  function hasSafeJoinDeadline(game: Game): boolean {
    const remaining = remainingJoinDeadlineSlots(game);
    if (remaining === null) return true;
    return remaining > BigInt(minJoinDeadlineMarginSlots(game.network));
  }

  function canReveal(game: Game): boolean {
    return (
      (game.status === "joined" ||
        game.status === "player_one_revealed" ||
        game.status === "player_two_revealed" ||
        game.status === "both_revealed") &&
      statusFor(game.creationTxHash) === "INCLUDED" &&
      statusFor(game.joinTxHash) === "INCLUDED"
    );
  }

  function canConfirmJoin(game: Game): boolean {
    return game.status === "join_pending" && !isReservedInvite(game) && statusFor(game.joinTxHash) === "INCLUDED";
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
      game.status === "joined" ||
      game.status === "player_one_revealed" ||
      game.status === "player_two_revealed" ||
      game.status === "both_revealed";
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
    if (onchainEnabled && value <= minJoinDeadlineMarginSlots(network)) {
      throw new Error(`${t("invalidRefundTimeout")} Minimum: ${minJoinDeadlineMarginSlots(network) + 1} slots.`);
    }
    return value;
  }

  async function notificationToken() {
    if (!firebaseNotificationsConfigured()) throw new Error(t("notificationsNotConfigured"));
    if (!browserNotificationsSupported()) throw new Error(t("notificationsUnsupported"));
    const token = await requestFirebaseNotificationToken();
    setFirebaseToken(token);
    return token;
  }

  async function handleToggleGameNotifications(game: Game) {
    if (!publicKey) {
      setMessage(t("walletRequired"));
      return;
    }
    if (!isActiveGame(game)) return;

    try {
      if (notificationGameIds.has(game.id)) {
        await unsubscribeGameNotifications(game.id, { publicKey, fcmToken: firebaseToken ?? undefined });
        setNotificationGameIds((current) => {
          const next = new Set(current);
          next.delete(game.id);
          return next;
        });
        setMessage(t("notificationsDisabled"));
        return;
      }

      const token = await notificationToken();
      await subscribeGameNotifications(game.id, { publicKey, fcmToken: token });
      setNotificationGameIds((current) => new Set(current).add(game.id));
      setMessage(t("notificationsEnabled"));
    } catch (error) {
      const errorMessage = (error as Error).message;
      setMessage(errorMessage.includes("permission") ? t("notificationsPermissionDenied") : errorMessage);
    }
  }

  async function handleToggleNewGameNotifications(networkId: NetworkId) {
    if (!publicKey) {
      setMessage(t("walletRequired"));
      return;
    }

    try {
      if (newGameNotificationNetworks.has(networkId)) {
        await unsubscribeNewGameNotifications({ network: networkId, publicKey, fcmToken: firebaseToken ?? undefined });
        setNewGameNotificationNetworks((current) => {
          const next = new Set(current);
          next.delete(networkId);
          return next;
        });
        setMessage(t("newGameNotificationsDisabled"));
        return;
      }

      const token = await notificationToken();
      await subscribeNewGameNotifications({ network: networkId, publicKey, fcmToken: token });
      setNewGameNotificationNetworks((current) => new Set(current).add(networkId));
      setMessage(t("newGameNotificationsEnabled"));
    } catch (error) {
      const errorMessage = (error as Error).message;
      setMessage(errorMessage.includes("permission") ? t("notificationsPermissionDenied") : errorMessage);
    }
  }

  function notificationButton(game: Game) {
    if (!isActiveGame(game)) return null;
    const enabled = notificationGameIds.has(game.id);
    return (
      <button
        type="button"
        className={enabled ? "notificationButton active" : "notificationButton"}
        title={enabled ? t("disableNotifications") : t("enableNotifications")}
        aria-label={enabled ? t("disableNotifications") : t("enableNotifications")}
        onClick={(event) => {
          event.stopPropagation();
          void handleToggleGameNotifications(game);
        }}
      >
        <Bell size={16} />
      </button>
    );
  }

  function hasPendingSettlement(game: Game) {
    return Boolean(game.settlementTxHash?.startsWith("pending:"));
  }

  function hasPendingRefund(game: Game) {
    return Boolean(game.refundTxHash?.startsWith("pending:"));
  }

  function canCancelOrRefund(game: Game): boolean {
    return canCancelCreatedGame(game) || canRefund(game);
  }

  function gameAwaitsPlayerAction(game: Game) {
    return (
      game.status === "created" ||
      game.status === "join_pending" ||
      game.status === "joined" ||
      game.status === "player_one_revealed" ||
      game.status === "player_two_revealed" ||
      game.status === "both_revealed"
    );
  }

  function gameDeepLink(game: Game) {
    const url = new URL(window.location.href);
    url.searchParams.set("network", game.network);
    url.searchParams.set("game", game.id);
    url.searchParams.set("share", Date.now().toString(36));
    url.searchParams.delete("notification");
    return url.toString();
  }

  async function handleShareGame(game: Game) {
    const url = gameDeepLink(game);
    const title = `${t("challenge")} ${game.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: title, url });
      } else {
        await navigator.clipboard.writeText(url);
        setMessage(t("gameLinkCopied"));
      }
    } catch (error) {
      const name = (error as Error).name;
      if (name !== "AbortError") setMessage(t("gameLinkCopyFailed"));
    }
  }

  function shareGameButton(game: Game) {
    if (!gameAwaitsPlayerAction(game)) return null;
    return (
      <button
        type="button"
        className="notificationButton"
        title={t("shareGame")}
        aria-label={t("shareGame")}
        onClick={(event) => {
          event.stopPropagation();
          void handleShareGame(game);
        }}
      >
        <Share2 size={16} />
      </button>
    );
  }

  function localSecretIndicator(game: Game) {
    if (!secretFor(game)) return null;
    return (
      <span className="localSecretIndicator" aria-label={t("secretAvailable")} title={t("secretAvailable")}>
        <ShieldCheck size={16} />
      </span>
    );
  }

  function canCancelCreatedGame(game: Game): boolean {
    return (
      game.status === "created" &&
      game.creatorPublicKey === publicKey &&
      !game.joinerPublicKey &&
      creationStatusFor(game) === "INCLUDED"
    );
  }

  function newGameNotificationButton(networkId: NetworkId) {
    const enabled = newGameNotificationNetworks.has(networkId);
    return (
      <button
        type="button"
        className={enabled ? "notificationButton active" : "notificationButton"}
        title={enabled ? t("disableNewGameNotifications") : t("enableNewGameNotifications")}
        aria-label={enabled ? t("disableNewGameNotifications") : t("enableNewGameNotifications")}
        onClick={() => void handleToggleNewGameNotifications(networkId)}
      >
        <Bell size={16} />
      </button>
    );
  }

  function networkFromUrl(value: string | null): NetworkId | null {
    return networkFromString(value);
  }

  function cleanDeepLinkUrl(params: URLSearchParams) {
    params.delete("game");
    params.delete("network");
    params.delete("notification");
    params.delete("share");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }

  function consumedDeepLinkKey(params: URLSearchParams, gameId: string) {
    return `zkroll:consumed-deeplink:${params.get("network") ?? ""}:${gameId}:${params.get("notification") ?? "legacy"}:${params.get("share") ?? ""}`;
  }

  function selectGameFromUrl(items = games) {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get("game");
    if (!gameId) return;
    const requestedNetwork = networkFromUrl(params.get("network"));
    const linkedGame = items.find((item) => item.id === gameId && (!requestedNetwork || item.network === requestedNetwork));
    const linkedNetwork = requestedNetwork ?? linkedGame?.network ?? null;
    if (linkedNetwork) {
      setNetwork(linkedNetwork);
    }
    setStatusFilter("all");
    setPlayerSearch("");
    setGameIdSearch("");
    setDeepLinkedGameTarget(linkedNetwork ? { id: gameId, network: linkedNetwork } : null);
    setSelectedGameId(gameId);
    if (viewMode === "app") setAppScreen("detail");
    sessionStorage.setItem(consumedDeepLinkKey(params, gameId), "1");
    cleanDeepLinkUrl(params);
  }

  useEffect(() => {
    void refreshGames().then((items) => selectGameFromUrl(items));
    const savedVault = localStorage.getItem("zkroll:secrets");
    if (savedVault) {
      setSecretVault(JSON.parse(savedVault) as Record<string, string>);
    }
  }, []);

  useEffect(() => {
    if (publicKey || localStorage.getItem(autoConnectStorageKey) !== "true") return;
    void connectWallet({ silent: true });
  }, [network, publicKey]);

  useEffect(() => {
    selectGameFromUrl();

    const handleDeepLink = () => selectGameFromUrl();
    window.addEventListener("focus", handleDeepLink);
    window.addEventListener("popstate", handleDeepLink);
    navigator.serviceWorker?.addEventListener("message", handleDeepLink);

    return () => {
      window.removeEventListener("focus", handleDeepLink);
      window.removeEventListener("popstate", handleDeepLink);
      navigator.serviceWorker?.removeEventListener("message", handleDeepLink);
    };
  }, [games, viewMode]);

  useEffect(() => {
    localStorage.setItem("zkroll:locale", locale);
  }, [locale]);

  useEffect(() => {
    localStorage.setItem("zkroll:network", network);
  }, [network]);

  useEffect(() => {
    setGamesPage(1);
  }, [gameIdSearch, network, playerSearch, statusFilter]);

  useEffect(() => {
    setGamesPage((current) => Math.min(current, totalGamePages));
  }, [totalGamePages]);

  useEffect(() => {
    setLeaderboardPage(1);
  }, [network]);

  useEffect(() => {
    setLeaderboardPage((current) => Math.min(current, totalLeaderboardPages));
  }, [totalLeaderboardPages]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("zkroll:theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!message.trim()) return;
    setMessageHistory((current) => {
      if (current[0] === message) return current;
      return [message, ...current].slice(0, 60);
    });
  }, [message]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled || busy || document.visibilityState !== "visible") return;
      await refreshGames().catch(() => undefined);
    };

    const interval = window.setInterval(() => void poll(), txPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [busy, network, publicKey, selectedGameId]);

  useEffect(() => {
    void refreshUnreadMessages().catch(() => undefined);
  }, [publicKey]);

  useEffect(() => {
    const publicKeys = visibleGamePlayerKey ? visibleGamePlayerKey.split("|") : [];
    if (publicKeys.length === 0) {
      setPlayerPseudosByPublicKey({});
      return;
    }
    let cancelled = false;
    void getPlayersByPublicKeys(publicKeys)
      .then((result) => {
        if (cancelled) return;
        setPlayerPseudosByPublicKey(
          Object.fromEntries(result.items.map((player) => [player.publicKey, player.pseudo]))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [visibleGamePlayerKey]);

  useEffect(() => {
    if (!publicKey) {
      setPreviousOpponents([]);
      setInviteePublicKey("");
      return;
    }
    void listPreviousOpponents(publicKey)
      .then((result) => {
        setPreviousOpponents(result.items);
        setInviteePublicKey((current) => (result.items.some((player) => player.publicKey === current) ? current : ""));
      })
      .catch(() => {
        setPreviousOpponents([]);
        setInviteePublicKey("");
      });
  }, [publicKey, games]);

  useEffect(() => {
    const messagesVisible = viewMode === "cards" || appScreen === "messages" || appScreen === "detail";
    if (messagesVisible) {
      void refreshMessagesFor(selectedGame).catch((error) => setMessage((error as Error).message));
    }
  }, [appScreen, publicKey, selectedGame?.id, selectedGame?.updatedAt, viewMode]);

  useEffect(() => {
    if (viewMode !== "cards" && !(viewMode === "app" && appScreen === "games")) return;
    void refreshVisiblePlayerMessages().catch((error) => setMessage((error as Error).message));
  }, [appScreen, publicKey, visibleGames, viewMode]);

  useEffect(() => {
    const keys = [selectedGame?.creatorPublicKey, selectedGame?.joinerPublicKey].filter((item): item is string => {
      if (!item) return false;
      return playerMessagePrefs[item] === undefined;
    });
    if (keys.length === 0) return;
    void Promise.allSettled(keys.map((key) => getPlayerByPublicKey(key))).then((results) => {
      setPlayerMessagePrefs((current) => {
        const next = { ...current };
        for (const result of results) {
          if (result.status === "fulfilled") next[result.value.publicKey] = result.value.acceptMessages;
        }
        return next;
      });
    });
  }, [playerMessagePrefs, selectedGame?.creatorPublicKey, selectedGame?.joinerPublicKey]);

  useEffect(() => {
    localStorage.setItem("zkroll:view-mode", viewMode);
    if (viewMode === "app" && appScreen === "detail" && !selectedGameId) {
      setAppScreen("games");
    }
  }, [appScreen, selectedGameId, viewMode]);

  useEffect(() => {
    setProvingCompatibility(getProvingCompatibility());
  }, []);

  useEffect(() => {
    if (!publicKey) {
      setWalletBalance({ value: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setWalletBalance({ value: null, loading: true, error: null });
    getWalletBalance(network, publicKey)
      .then((result) => {
        if (!cancelled) {
          setWalletBalance({ value: result.balanceNanoMina, loading: false, error: result.error });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setWalletBalance({ value: null, loading: false, error: (error as Error).message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [network, publicKey]);

  useEffect(() => {
    if (!publicKey) {
      setNotificationGameIds(new Set());
      return;
    }

    let cancelled = false;
    listNotificationSubscriptions(publicKey)
      .then((result) => {
        if (!cancelled) {
          setNotificationGameIds(new Set(result.items.map((item) => item.gameId)));
          setNewGameNotificationNetworks(new Set(result.newGameItems.map((item) => item.network)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotificationGameIds(new Set());
          setNewGameNotificationNetworks(new Set());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  useEffect(() => {
    if (!firebaseNotificationsConfigured() || !browserNotificationsSupported()) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    listenForGameNotifications((update) => {
      const isSubscribedGame = update.kind === "new_game" ? newGameNotificationNetworks.has(update.network!) : notificationGameIds.has(update.gameId);
      if (cancelled || !isSubscribedGame) return;
      void refreshGames();
      setMessage(
        update.kind === "new_game"
          ? `${t("newGameNotification")}: ${update.gameId}`
          : `${t("gameUpdatedNotification")}: ${update.gameId}${update.status ? ` (${update.status})` : ""}`
      );
    })
      .then((nextUnsubscribe) => {
        unsubscribe = nextUnsubscribe;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [notificationGameIds, newGameNotificationNetworks, locale]);

  useEffect(() => {
    setWalletConnectPromptHandler(setWalletConnectPrompt);
    return () => setWalletConnectPromptHandler(null);
  }, []);

  useEffect(() => {
    setWalletConnectQrDataUrl(null);
    setWalletConnectQrMode("wc");
    setShowAuroInstall(false);
  }, [walletConnectPrompt?.uri, walletConnectPrompt?.openUrl]);

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

  useEffect(() => {
    if (!scannerGameId) return;
    const game = games.find((item) => item.id === scannerGameId);
    if (!game) return;
    if (!window.BarcodeDetector) {
      setMessage(t("qrScannerUnavailable"));
      setScannerGameId(null);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

    const scan = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = scannerVideoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        while (!cancelled) {
          const codes = await detector.detect(video);
          const value = codes[0]?.rawValue;
          if (value) {
            importSecret(game, value);
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 450));
        }
      } catch (error) {
        setMessage((error as Error).message);
        setScannerGameId(null);
      }
    };

    void scan();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scannerGameId, games]);

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

  function connectedPlayerCanUseSecret(game: Game) {
    return publicKey === game.creatorPublicKey || publicKey === game.joinerPublicKey;
  }

  function shouldShowMissingSecret(game: Game) {
    if (!connectedPlayerCanUseSecret(game) || secretFor(game)) return false;
    return !(isReservedInvite(game) && publicKey === game.joinerPublicKey);
  }

  async function openSecretModal(game: Game) {
    const secret = secretFor(game);
    if (!secret) return;
    setSecretModalGameId(game.id);
    setSecretQrDataUrl(await createSecretQrDataUrl(secret));
  }

  function closeSecretModal() {
    setSecretModalGameId(null);
    setSecretQrDataUrl(null);
  }

  async function handleCopySecret(game: Game) {
    const secret = secretFor(game);
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setMessage(t("secretCopied"));
  }

  function importSecret(game: Game, secret: string) {
    const value = secret.trim();
    if (!value) return;
    rememberSecret(game.id, value);
    setScannerGameId(null);
    setMessage(t("secretImported"));
  }

  function handlePasteSecret(game: Game) {
    const secret = window.prompt(t("pasteSecretPrompt"));
    if (secret) importSecret(game, secret);
  }

  function splitSecretForDisplay(secret: string) {
    const midpoint = Math.ceil(secret.length / 2);
    return [secret.slice(0, midpoint), secret.slice(midpoint)];
  }

  function secretButtonFor(game: Game, playerPublicKey: string | null | undefined) {
    if (!publicKey || playerPublicKey !== publicKey || !secretFor(game)) return null;
    return (
      <button
        aria-label={t("showSecret")}
        className="tinyIconButton"
        onClick={() => void openSecretModal(game)}
        title={t("showSecret")}
        type="button"
      >
        <ShieldCheck size={15} />
      </button>
    );
  }

  function canMessagePlayer(game: Game, receiverPublicKey: string | null | undefined) {
    return Boolean(
      publicKey &&
        receiverPublicKey &&
        receiverPublicKey !== publicKey &&
        (publicKey === game.creatorPublicKey || publicKey === game.joinerPublicKey) &&
        (receiverPublicKey === game.creatorPublicKey || receiverPublicKey === game.joinerPublicKey)
    );
  }

  function messageButtonFor(game: Game, receiverPublicKey: string | null | undefined, receiverPseudo: string | null | undefined) {
    if (!canMessagePlayer(game, receiverPublicKey) || !receiverPublicKey || !receiverPseudo) return null;
    if (playerMessagePrefs[receiverPublicKey] === false) return null;
    return (
      <button
        aria-label={`${t("messagePlayer")} ${receiverPseudo}`}
        className="tinyIconButton"
        onClick={() => {
          setMessageDraft("");
          setMessageDialog({ game, receiverPublicKey, receiverPseudo });
        }}
        type="button"
      >
        <MessageSquareText size={14} />
      </button>
    );
  }

  function unreadBadgeFor(game: Game) {
    const count = unreadMessageCounts[game.id] ?? 0;
    if (count <= 0) return null;
    return <span className="unreadBadge">{count > 99 ? "99+" : count}</span>;
  }

  function messageIndicatorFor(game: Game) {
    const messageCount = gameMessages[game.id]?.length ?? 0;
    const unreadCount = unreadMessageCounts[game.id] ?? 0;
    if (messageCount <= 0 && unreadCount <= 0) return null;
    const content = (
      <>
        <MessageSquareText size={16} />
        {unreadCount > 0 && <span className="messageIndicatorBadge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </>
    );
    const className = unreadCount > 0 ? "messageIndicator hasUnread" : "messageIndicator";
    if (viewMode !== "app") {
      return (
        <span className={className} aria-label={t("playerMessages")} title={t("playerMessages")}>
          {content}
        </span>
      );
    }
    return (
      <button
        aria-label={t("playerMessages")}
        className={className}
        onClick={(event) => {
          event.stopPropagation();
          setSelectedGameId(game.id);
          setAppScreen("messages");
        }}
        title={t("playerMessages")}
        type="button"
      >
        {content}
      </button>
    );
  }

  async function handleSendPlayerMessage(event: FormEvent) {
    event.preventDefault();
    if (!messageDialog || !publicKey) return;
    if (!canMessagePlayer(messageDialog.game, messageDialog.receiverPublicKey)) {
      setMessage(t("messagesDisabled"));
      setMessageDialog(null);
      return;
    }
    await runAction(async () => {
      await sendGameMessage(messageDialog.game.id, {
        senderPublicKey: publicKey,
        body: messageDraft.slice(0, 500)
      });
      setMessageDialog(null);
      setMessageDraft("");
      await refreshMessagesFor(messageDialog.game);
      await refreshUnreadMessages();
      setMessage(t("messageSent"));
    });
  }

  async function toggleAcceptMessages() {
    if (!publicKey || !currentPlayer) return;
    await runAction(async () => {
      const player = await setMessagePreference(publicKey, !currentPlayer.acceptMessages);
      setCurrentPlayer(player);
      setPlayerMessagePrefs((current) => ({ ...current, [player.publicKey]: player.acceptMessages }));
      setMessage(player.acceptMessages ? t("acceptMessages") : t("messagesDisabled"));
    });
  }

  async function handleClearServerProverCache() {
    await runAction(async () => {
      if (!publicKey || publicKey !== adminPublicKey || proverMode() !== "server") {
        throw new Error(t("walletRequired"));
      }
      const confirmed = window.confirm(t("clearServerProverCacheConfirm"));
      if (!confirmed) return;
      const result = await clearServerProverCache(publicKey);
      setMessage(`${t("serverProverCacheCleared")} ${result.cacheDirectory}`);
    });
  }

  function handleGameCardSelect(gameId: string) {
    setDeepLinkedGameTarget(null);
    setSelectedGameId(gameId);
    if (viewMode === "app") setAppScreen("detail");
  }

  function openSettings() {
    if (viewMode === "app") {
      setAppScreen("settings");
      return;
    }
    setSettingsOpen(true);
  }

  function setMode(nextMode: ViewMode) {
    setViewMode(nextMode);
    if (nextMode === "app") {
      setSettingsOpen(false);
      setAppScreen("games");
    }
  }

  function settingsContent() {
    const creditIcon = (icon: string) => {
      if (icon === "copyright") return <Copyright size={16} />;
      if (icon === "mail") return <Mail size={16} />;
      if (icon === "discord") return <MessageCircle size={16} />;
      if (icon === "telegram") return <Send size={16} />;
      if (icon === "twitter") return <AtSign size={16} />;
      if (icon === "github") return <Github size={16} />;
      return <Globe size={16} />;
    };

    return (
      <>
        {viewMode === "app" && (
          <>
            <label>
              {t("language")}
              <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                {localeOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("theme")}
              <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                <option value="light">{t("lightTheme")}</option>
                <option value="dark">{t("darkTheme")}</option>
              </select>
            </label>
          </>
        )}
        <label>
          {t("displayMode")}
          <select value={viewMode} onChange={(event) => setMode(event.target.value as ViewMode)}>
            <option value="cards">{t("cardsMode")}</option>
            <option value="app">{t("appMode")}</option>
          </select>
        </label>
        {publicKey && currentPlayer && (
          <div className="settingsInfoBox">
            <strong>{t("messages")}</strong>
            <label className="settingToggle">
              <span>
                <strong>{t("acceptMessages")}</strong>
                <small>{currentPlayer.acceptMessages ? t("enabled") : t("disabled")}</small>
              </span>
              <input checked={currentPlayer.acceptMessages} onChange={() => void toggleAcceptMessages()} type="checkbox" />
              <span aria-hidden="true" className="switchTrack">
                <span className="switchThumb" />
              </span>
            </label>
          </div>
        )}
        <div className="creditsBox">
          <strong>{t("credits")}</strong>
          {credits.map((item) => {
            const content = (
              <>
                {creditIcon(item.icon)}
                <span>{item.text}</span>
              </>
            );
            return item.url ? (
              <a href={item.url} key={item.text} rel="noreferrer" target="_blank">
                {content}
              </a>
            ) : (
              <span key={item.text}>{content}</span>
            );
          })}
        </div>
        <div className="settingsInfoBox">
          <strong>{t("technicalInfo")}</strong>
          <span>
            <span>{t("o1jsVersionLabel")}</span>
            <b>{o1jsVersion()}</b>
          </span>
          <span>
            <span>{t("proverModeLabel")}</span>
            <b>{proverMode() === "server" ? t("serverProverMode") : t("clientProverMode")}</b>
          </span>
        </div>
        {proverMode() === "server" && publicKey === adminPublicKey && (
          <div className="settingsInfoBox">
            <strong>{t("adminTools")}</strong>
            <button className="warningButton" disabled={busy} onClick={() => void handleClearServerProverCache()} type="button">
              <RefreshCw size={16} />
              {t("clearServerProverCache")}
            </button>
          </div>
        )}
      </>
    );
  }

  function networkDescriptionKey(networkId: NetworkId) {
    if (networkId === "mainnet") return "mainnetNetworkDescription";
    if (networkId === "zeko") return "zekoNetworkDescription";
    return "devnetNetworkDescription";
  }

  function selectAppNetwork(nextNetwork: NetworkId) {
    setDeepLinkedGameTarget(null);
    setNetwork(nextNetwork);
    setNetworkMenuOpen(false);
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

  async function connectWallet(options?: { silent?: boolean }) {
    const silent = options?.silent === true;
    if (!window.mina && walletConnectConfigured()) {
      setWalletConnectNetwork(network);
    }
    const provider = window.mina ?? (mobileBrowserCanUseWalletConnect() ? walletConnectProvider() : undefined);
    if (!provider) {
      if (silent) return;
      if (!window.mina && !walletConnectConfigured()) {
        setMessage(t("walletConnectNotConfigured"));
        return;
      }
      setMessage(t("walletMissing"));
      return;
    }

    let accounts: string[];
    try {
      if (silent && !window.mina && mobileBrowserCanUseWalletConnect()) {
        accounts = await restoredWalletConnectAccounts();
        if (accounts.length === 0) return;
      } else if (silent && provider.getAccounts) {
        accounts = await provider.getAccounts();
        if (accounts.length === 0) return;
      } else {
        accounts = await provider.requestAccounts();
      }
    } catch (error) {
      if (silent) return;
      const errorMessage = (error as Error).message;
      setMessage(errorMessage === "WalletConnect cancelled." ? t("walletPrompt") : errorMessage);
      return;
    }
    const account = accounts[0] ?? "";
    setPublicKey(account);
    if (!account) {
      if (silent) return;
      setMessage(t("noWalletAccount"));
      return;
    }

    try {
      await ensureWalletNetwork(provider, network);
    } catch (error) {
      if (silent) return;
      setMessage((error as Error).message);
      return;
    }

    try {
      const player = await getPlayerByPublicKey(account);
      setCurrentPlayer(player);
      setPlayerMessagePrefs((current) => ({ ...current, [player.publicKey]: player.acceptMessages }));
      setPlayerPseudosByPublicKey((current) => ({ ...current, [player.publicKey]: player.pseudo }));
      setPseudo(player.pseudo);
      setPseudoModalOpen(false);
      localStorage.setItem(autoConnectStorageKey, "true");
      if (!silent) setMessage(`${t("walletFound")} ${player.pseudo}.`);
    } catch {
      setCurrentPlayer(null);
      setPseudoDraft(randomPseudo());
      setPseudoModalOpen(true);
      localStorage.setItem(autoConnectStorageKey, "true");
      if (!silent) setMessage(t("choosePseudoMessage"));
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
    setCurrentPlayer(null);
    setPseudoDraft("");
    setPseudoModalOpen(false);
    setWalletConnectPrompt(null);
    localStorage.removeItem(autoConnectStorageKey);
    setMessage(t("walletPrompt"));
  }

  async function savePseudo(event: FormEvent) {
    event.preventDefault();
    if (!publicKey) return;
    const player = await createPlayer({ pseudo: pseudoDraft.trim(), publicKey });
    const wasEditing = Boolean(pseudo);
    setCurrentPlayer(player);
    setPlayerMessagePrefs((current) => ({ ...current, [player.publicKey]: player.acceptMessages }));
    setPlayerPseudosByPublicKey((current) => ({ ...current, [player.publicKey]: player.pseudo }));
    setPseudo(player.pseudo);
    setPseudoModalOpen(false);
    setMessage(`${wasEditing ? t("pseudoUpdated") : t("pseudoSaved")} ${player.pseudo}.`);
  }

  function openPseudoEditor() {
    if (!publicKey) return;
    setPseudoDraft(pseudo);
    setPseudoModalOpen(true);
  }

  async function cancelPseudoRegistration() {
    if (pseudo) {
      setPseudoModalOpen(false);
      setPseudoDraft(pseudo);
      return;
    }
    await disconnectWallet();
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

  function handleManualSignatureHash() {
    const hash = manualSignatureHash.trim();
    if (!hash) return;
    resolvePendingWalletSignatureWithHash(hash);
    setManualSignatureHash("");
  }

  function handleManualSignatureFailed() {
    rejectPendingWalletSignature(t("manualSignatureFailedMessage"));
    setManualSignatureHash("");
  }

  async function toggleWalletConnectQr() {
    if (walletConnectQrDataUrl) {
      setWalletConnectQrDataUrl(null);
      return;
    }
    const url = walletConnectQrValue();
    if (!url) return;
    setWalletConnectQrDataUrl(await createQrDataUrl(url, 240));
  }

  function walletConnectQrValue(mode = walletConnectQrMode) {
    if (!walletConnectPrompt) return null;
    return mode === "auro" ? walletConnectPrompt.openUrl ?? null : walletConnectPrompt.uri ?? null;
  }

  function scheduleAuroInstallHint() {
    setShowAuroInstall(false);
    window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        setShowAuroInstall(true);
      }
    }, 1800);
  }

  async function updateWalletConnectQrMode(mode: WalletConnectQrMode) {
    setWalletConnectQrMode(mode);
    if (!walletConnectQrDataUrl) return;
    const url = walletConnectQrValue(mode);
    if (!url) return;
    setWalletConnectQrDataUrl(await createQrDataUrl(url, 240));
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
      const material = loadPendingCreationMaterial(game, publicKey);
      const txHash = window.prompt(t("pasteCreationHash"));
      if (!txHash?.trim()) return;
      const creationTxHash = requiredTransactionHash(txHash);
      assertGameTransactionHashAvailable(game, "creation", creationTxHash);
      const reconciled = await reconcileCreationTx(game.id, creationTxHash);
      updateGameInState(reconciled);
      if (material?.invitedPublicKey) {
        await sendGameInvite(reconciled, material.invitedPublicKey);
      } else {
        setMessage(t("hashSaved"));
      }
      removePendingCreationMaterial(reconciled);
    });
  }

  async function handleReconcileJoin(game: Game) {
    await runAction(async () => {
      const txHash = window.prompt(t("pasteJoinHash"));
      if (!txHash?.trim()) return;
      const joinTxHash = requiredTransactionHash(txHash);
      assertGameTransactionHashAvailable(game, "join", joinTxHash);

      if (game.status === "created") {
        const pendingJoin = publicKey ? loadPendingJoinMaterial(game, publicKey) : null;
        const secret = pendingJoin?.secret ?? secretFor(game);
        const recoveredPseudo = pendingJoin?.pseudo ?? pseudo;
        if (!recoveredPseudo || !publicKey || !secret || publicKey === game.creatorPublicKey || !game.gameIdField || !game.creatorPseudoHash || !game.refundDeadlineSlot) {
          throw new Error(t("invalidJoinRecovery"));
        }
        const suggestedDeadline =
          pendingJoin?.refundDeadlineSlot ??
          (await strictRefundDeadlineForJoin(game.network, game.refundTimeoutSlots, game.refundDeadlineSlot).catch(() => game.refundDeadlineSlot!));
        const refundDeadlineSlot = pendingJoin ? suggestedDeadline : window.prompt(t("pasteJoinRefundDeadlineSlot"), suggestedDeadline);
        if (refundDeadlineSlot === null) return;
        const normalizedRefundDeadlineSlot = refundDeadlineSlot.trim() || suggestedDeadline;
        if (!/^\d+$/.test(normalizedRefundDeadlineSlot)) {
          throw new Error(t("invalidRefundTimeout"));
        }
        const joinerPseudoHash = pendingJoin?.joinerPseudoHash ?? (onchainEnabled ? await pseudoHash(recoveredPseudo) : undefined);
        const joinerCommitment =
          pendingJoin?.joinerCommitment ??
          (onchainEnabled ? await onchainCommitment(secret, publicKey, game.gameIdField) : await temporaryCommitment(secret, publicKey, game.id));
        const recovered = await joinGame(game.id, {
          joinerPseudo: recoveredPseudo,
          joinerPublicKey: publicKey,
          joinerPseudoHash,
          joinerCommitment,
          refundDeadlineSlot: normalizedRefundDeadlineSlot,
          joinTxHash
        });
        rememberSecret(recovered.id, secret);
        setSelectedGameId(recovered.id);
        setMessage(t("joinHashSaved"));
        return;
      }

      if (game.joinerPublicKey !== publicKey) {
        throw new Error(t("joinerOnlyHash"));
      }
      const reconciled = await reconcileJoinTx(game.id, joinTxHash);
      setSelectedGameId(reconciled.id);
      setMessage(t("joinHashSaved"));
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
        payoutMode: game.payoutMode,
        refundDeadlineSlot: game.refundDeadlineSlot,
        onProgress: updateOnchainProgress
      });
      const reconciled = await reconcileCreationTx(game.id, result.txHash);
      updateGameInState(reconciled);
      rememberSecret(reconciled.id, material.secret);
      if (material.invitedPublicKey) {
        await sendGameInvite(reconciled, material.invitedPublicKey);
      } else {
        setMessage(t("creationResigned"));
      }
      removePendingCreationMaterial(reconciled);
    });
  }

  async function handleMarkCreationFailed(game: Game) {
    if (game.creatorPublicKey !== publicKey) {
      setMessage(t("creatorOnlyFailed"));
      return;
    }
    setFailureDialogGame(game);
    setFailureReasonKind(game.status === "pending_signature" ? "localSignature" : "onchainCreation");
    setFailureReasonText("");
  }

  async function submitMarkCreationFailed(event: FormEvent) {
    event.preventDefault();
    if (!failureDialogGame) return;
    await runAction(async () => {
      const selectedReason =
        failureReasonKind === "localSignature"
          ? t("failedReasonLocalSignature")
          : failureReasonKind === "onchainCreation"
            ? t("failedReasonOnchainCreation")
            : failureReasonText.trim() || t("failedReasonOther");
      const failed = await markCreationFailed(failureDialogGame.id, selectedReason);
      removePendingCreationMaterial(failed);
      setSelectedGameId(failed.id);
      setMessage(t("markedFailed"));
      setFailureDialogGame(null);
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
      const invitedPublicKey = inviteePublicKey;
      const secret = randomFieldString();
      const gameIdField = randomFieldString();
      const creatorPseudoHash = onchainEnabled ? await pseudoHash(pseudo) : undefined;
      const creatorCommitment = onchainEnabled
        ? await onchainCommitment(secret, publicKey, gameIdField)
        : await temporaryCommitment(secret, publicKey, `${pseudo}:${Date.now()}`);
      const stakeNanoMina = String(Math.round(Number(stake) * nanoMina));
      const refundTimeout = normalizedRefundTimeout();
      const refundDeadlineSlot = onchainEnabled ? await refundDeadlineForCreate(network, refundTimeout) : "0";
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
        payoutMode,
        creatorCommitment,
        refundTimeoutSlots: refundTimeout,
        refundDeadlineSlot,
        creationTxHash: onchainEnabled ? undefined : txHash
      });
      rememberSecret(created.id, secret);
      if (onchainEnabled && gameKey) {
        savePendingCreationMaterial(created, secret, gameKey.privateKey, invitedPublicKey);
      }
      updateGameInState(created);
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
          payoutMode,
          refundDeadlineSlot,
          onProgress: updateOnchainProgress
        });
        txHash = result.txHash;
        const reconciled = await reconcileCreationTx(created.id, txHash);
        removePendingCreationMaterial(reconciled);
        updateGameInState(reconciled);
        if (invitedPublicKey) await sendGameInvite(reconciled, invitedPublicKey);
        if (viewMode === "app") setAppScreen("detail");
      } else {
        if (invitedPublicKey) await sendGameInvite(created, invitedPublicKey);
        if (viewMode === "app") setAppScreen("detail");
      }

      if (!invitedPublicKey) setMessage(onchainEnabled ? t("createdOnchain") : t("createdMock"));
      setInviteePublicKey("");
    });
  }

  async function sendGameInvite(game: Game, invitedPublicKey: string) {
    try {
      const reserved = await inviteGame(game.id, { inviterPublicKey: publicKey, inviteePublicKey: invitedPublicKey });
      updateGameInState(reserved);
      setMessage(t("inviteSent"));
    } catch {
      setMessage(t("inviteSkipped"));
    }
  }

  async function handleJoinGame(game: Game) {
    await runAction(async () => {
      if (!pseudo || !publicKey) throw new Error(t("walletAndPseudoRequired"));
      if (game.creatorPublicKey === publicKey) throw new Error(t("cannotJoinOwn"));
      if (isReservedInvite(game) && game.joinerPublicKey !== publicKey) throw new Error(t("invitedOnly"));
      const freshRemaining = await freshRemainingJoinDeadlineSlots(game);
      if (freshRemaining !== null && freshRemaining <= BigInt(minJoinDeadlineMarginSlots(game.network))) {
        throw new Error(t("joinDeadlineTooClose"));
      }
      const secret = randomFieldString();
      const gameIdField = game.gameIdField ?? game.id;
      const joinerPseudoHash = onchainEnabled ? await pseudoHash(pseudo) : undefined;
      const joinerCommitment = onchainEnabled
        ? await onchainCommitment(secret, publicKey, gameIdField)
        : await temporaryCommitment(secret, publicKey, game.id);
      const refundDeadlineSlot =
        onchainEnabled && game.refundDeadlineSlot
          ? await strictRefundDeadlineForJoin(game.network, game.refundTimeoutSlots, game.refundDeadlineSlot)
          : "0";
      let txHash = fakeTxHash("join");
      let joined = await joinGame(game.id, {
        joinerPseudo: pseudo,
        joinerPublicKey: publicKey,
        joinerPseudoHash,
        joinerCommitment,
        refundDeadlineSlot,
        joinTxHash: onchainEnabled ? `pending:join:${game.id}` : txHash
      });
      rememberSecret(joined.id, secret);
      savePendingJoinMaterial(joined, {
        pseudo,
        joinerPublicKey: publicKey,
        secret,
        joinerPseudoHash,
        joinerCommitment,
        refundDeadlineSlot
      });
      setSelectedGameId(joined.id);

      if (onchainEnabled) {
        if (!game.gameIdField || !game.creatorPseudoHash || !game.refundDeadlineSlot || !game.zkappAddress) throw new Error(t("incompatibleOnchain"));
        let walletSignatureRequested = false;
        const joinProgress = (progress: OnchainProgress) => {
          if (progress.label === "progressWalletSignature") {
            walletSignatureRequested = true;
          }
          updateOnchainProgress(progress);
        };
        try {
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
            payoutMode: game.payoutMode,
            creatorCommitment: game.creatorCommitment,
            currentRefundDeadlineSlot: game.refundDeadlineSlot,
            nextRefundDeadlineSlot: refundDeadlineSlot,
            onProgress: joinProgress
          });
          const joinTxHash = requiredTransactionHash(txHash);
          assertGameTransactionHashAvailable(joined, "join", joinTxHash);
          joined = await reconcileJoinTx(joined.id, joinTxHash);
        } catch (error) {
          if (!walletSignatureRequested) {
            const released = await failPendingJoin(joined.id, (error as Error).message);
            setSelectedGameId(released.id);
          }
          throw error;
        }
      }

      const indexedGame = onchainEnabled ? joined : await confirmJoinGame(joined.id);
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
      if (game.status !== "join_pending" || !game.joinTxHash || statusFor(game.joinTxHash) === "INCLUDED") return;
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
      updateGameInState(updatedGame);
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
        const pending = await prepareSettlementTx(game.id, `pending:settle:${game.id}`);
        updateGameInState(pending);
        let walletSignatureRequested = false;
        const settleProgress = (progress: OnchainProgress) => {
          if (progress.label === "progressWalletSignature") walletSignatureRequested = true;
          updateOnchainProgress(progress);
        };
        try {
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
            payoutMode: game.payoutMode,
            creatorCommitment: game.creatorCommitment,
            joinerCommitment: game.joinerCommitment,
            creatorSecret: game.creatorReveal,
            joinerSecret: game.joinerReveal,
            winnerPublicKey,
            refundDeadlineSlot: game.refundDeadlineSlot,
            onProgress: settleProgress
          });
          assertGameTransactionHashAvailable(game, "settlement", txHash);
        } catch (error) {
          if (!walletSignatureRequested) {
            updateGameInState(await clearPendingSettlementTx(game.id, (error as Error).message));
          }
          throw error;
        }
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

  async function handleReconcileSettlement(game: Game) {
    await runAction(async () => {
      if (!canSettle(game) && !hasPendingSettlement(game)) throw new Error(t("incompleteSettlement"));
      const settlementTxHash = window.prompt(t("pasteSettlementHash"));
      if (!settlementTxHash?.trim()) return;
      const normalizedSettlementTxHash = requiredTransactionHash(settlementTxHash);
      assertGameTransactionHashAvailable(game, "settlement", normalizedSettlementTxHash);

      const { creatorDie, joinerDie } = await computeDice(game);
      const winnerPublicKey =
        creatorDie > joinerDie ? game.creatorPublicKey : joinerDie > creatorDie ? game.joinerPublicKey : null;
      const settled = await settleGame(game.id, {
        creatorDie,
        joinerDie,
        winnerPublicKey,
        settlementTxHash: normalizedSettlementTxHash
      });
      setSelectedGameId(settled.id);
      setTxStatuses((current) => ({ ...current, [normalizedSettlementTxHash]: settled.settlementTxStatus ?? "PENDING" }));
      setMessage(t("settlementHashSaved"));
      await refreshGames();
    });
  }

  async function handleReconcileRefund(game: Game) {
    await runAction(async () => {
      if (!publicKey) throw new Error(t("walletRequired"));
      if (!hasPendingRefund(game) && game.creatorPublicKey !== publicKey && game.joinerPublicKey !== publicKey) {
        throw new Error(t("playerOnlyRefund"));
      }

      const txHashInput = window.prompt(t("pasteRefundHash"));
      if (!txHashInput?.trim()) return;

      const refundTxHash = requiredTransactionHash(txHashInput);
      assertGameTransactionHashAvailable(game, "refund", refundTxHash);
      const refunded = await refundGame(game.id, { refundTxHash });
      setSelectedGameId(refunded.id);
      setTxStatuses((current) => ({ ...current, [refundTxHash]: refunded.refundTxStatus ?? "PENDING" }));
      setMessage(t("refundHashSaved"));
      await refreshGames();
    });
  }

  async function handleClearPendingSettlement(game: Game) {
    await runAction(async () => {
      if (!hasPendingSettlement(game)) return;
      const confirmed = window.confirm(t("clearPendingSettlementConfirm"));
      if (!confirmed) return;
      const cleared = await clearPendingSettlementTx(game.id, t("pendingSettlementClearedReason"));
      updateGameInState(cleared);
      setSelectedGameId(cleared.id);
      setMessage(t("pendingSettlementCleared"));
      await refreshGames();
    });
  }

  async function handleClearPendingRefund(game: Game) {
    await runAction(async () => {
      if (!hasPendingRefund(game)) return;
      const confirmed = window.confirm(t("clearPendingRefundConfirm"));
      if (!confirmed) return;
      const cleared = await clearPendingRefundTx(game.id, t("pendingRefundClearedReason"));
      updateGameInState(cleared);
      setSelectedGameId(cleared.id);
      setMessage(t("pendingRefundCleared"));
      await refreshGames();
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
        const pending = await prepareRefundTx(game.id, `pending:refund:${game.id}`);
        updateGameInState(pending);
        let walletSignatureRequested = false;
        const refundProgress = (progress: OnchainProgress) => {
          if (progress.label === "progressWalletSignature") walletSignatureRequested = true;
          updateOnchainProgress(progress);
        };
        try {
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
            payoutMode: game.payoutMode,
            creatorCommitment: game.creatorCommitment,
            joinerCommitment: game.joinerCommitment,
            refundDeadlineSlot: game.refundDeadlineSlot,
            onProgress: refundProgress
          });
        } catch (error) {
          if (!walletSignatureRequested) {
            updateGameInState(await clearPendingRefundTx(game.id, (error as Error).message));
          }
          throw error;
        }
      }

      assertGameTransactionHashAvailable(game, "refund", txHash);
      await refundGame(game.id, { refundTxHash: txHash });
      setMessage(onchainEnabled ? t("refundSent") : t("refundMock"));
    });
  }

  async function handleCancelCreatedGame(game: Game) {
    await runAction(async () => {
      if (!publicKey) throw new Error(t("walletRequired"));
      if (!canCancelCreatedGame(game)) throw new Error(t("cancelNotReady"));

      let txHash = fakeTxHash("refund");
      if (onchainEnabled) {
        if (!game.gameIdField || !game.zkappAddress || !game.creatorPseudoHash || !game.refundDeadlineSlot) {
          throw new Error(t("incompleteRefund"));
        }
        const pending = await prepareRefundTx(game.id, `pending:cancel:${game.id}`);
        updateGameInState(pending);
        let walletSignatureRequested = false;
        const cancelProgress = (progress: OnchainProgress) => {
          if (progress.label === "progressWalletSignature") walletSignatureRequested = true;
          updateOnchainProgress(progress);
        };
        try {
          txHash = await cancelCreatedGameOnchain({
            provider: walletProvider(),
            network: game.network,
            senderPublicKey: publicKey,
            gameIdField: game.gameIdField,
            zkappAddress: game.zkappAddress,
            creatorPseudoHash: game.creatorPseudoHash,
            creatorCommitment: game.creatorCommitment,
            payoutMode: game.payoutMode,
            refundDeadlineSlot: game.refundDeadlineSlot,
            onProgress: cancelProgress
          });
        } catch (error) {
          if (!walletSignatureRequested) {
            updateGameInState(await clearPendingRefundTx(game.id, (error as Error).message));
          }
          throw error;
        }
      }

      assertGameTransactionHashAvailable(game, "refund", txHash);
      const refunded = await refundGame(game.id, { refundTxHash: txHash });
      setSelectedGameId(refunded.id);
      setMessage(t("cancelSent"));
      await refreshGames();
    });
  }

  async function handleCancelOrRefund(game: Game) {
    if (canCancelCreatedGame(game)) {
      await handleCancelCreatedGame(game);
      return;
    }
    await handleRefund(game);
  }

  return (
    <main className={`shell ${viewMode === "app" ? "appShell" : "cardsShell"}`} data-app-screen={appScreen}>
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
            <button className="ghostButton" onClick={() => void cancelPseudoRegistration()} type="button">
              {t("cancel")}
            </button>
          </form>
        </div>
      )}

      {walletConnectPrompt && (
        <div className="modalBackdrop">
          <div className="modal">
            <h2>WalletConnect</h2>
            {walletConnectPrompt.isPreparing ? (
              <div className="walletConnectPreparing">
                <span className="inlineSpinner" aria-hidden="true" />
                <p className="notice">{t("walletConnectPreparing")}</p>
              </div>
            ) : (
              <p className="notice">{t("walletConnectPrompt")}</p>
            )}
            {walletConnectPrompt.openUrl && (
              <a
                className="primary actionLink"
                href={walletConnectPrompt.openUrl}
                onClick={scheduleAuroInstallHint}
                rel="noreferrer"
              >
                {t("openAuro")}
              </a>
            )}
            {showAuroInstall && (
              <div className="walletConnectInstallHint">
                <p>{t("auroInstallHint")}</p>
                <a className="secondaryButton actionLink" href={auroInstallUrl()} rel="noreferrer" target="_blank">
                  {t("installAuro")}
                </a>
              </div>
            )}
            {walletConnectPrompt.uri && (
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  if (walletConnectPrompt.openUrl) {
                    void navigator.clipboard?.writeText(walletConnectPrompt.openUrl);
                  }
                }}
              >
                {t("copyWalletConnectUri")}
              </button>
            )}
            {walletConnectPrompt.uri && (
              <button className="secondaryButton" type="button" onClick={() => void toggleWalletConnectQr()}>
                {walletConnectQrDataUrl ? t("hideWalletConnectQr") : t("showWalletConnectQr")}
              </button>
            )}
            {walletConnectQrDataUrl && (
              <div className="walletConnectQrBox">
                <div className="walletConnectQrSwitch" role="group" aria-label="WalletConnect QR">
                  <button
                    className={walletConnectQrMode === "auro" ? "active" : ""}
                    onClick={() => void updateWalletConnectQrMode("auro")}
                    type="button"
                  >
                    {t("walletConnectQrAuro")}
                  </button>
                  <button
                    className={walletConnectQrMode === "wc" ? "active" : ""}
                    onClick={() => void updateWalletConnectQrMode("wc")}
                    type="button"
                  >
                    {t("walletConnectQrWc")}
                  </button>
                </div>
                <img alt="WalletConnect" className="walletConnectQr" src={walletConnectQrDataUrl} />
                <code>{walletConnectQrValue()}</code>
              </div>
            )}
            <button
              className="ghostButton"
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

      {failureDialogGame && (
        <div className="modalBackdrop">
          <form className="modal" onSubmit={(event) => void submitMarkCreationFailed(event)}>
            <h2>{t("markFailed")}</h2>
            <p className="notice">{t("confirmFailed")}</p>
            <label>
              {t("optionalReason")}
              <select
                value={failureReasonKind}
                onChange={(event) => setFailureReasonKind(event.target.value as "localSignature" | "onchainCreation" | "other")}
              >
                <option value="localSignature">{t("failedReasonLocalSignature")}</option>
                <option value="onchainCreation">{t("failedReasonOnchainCreation")}</option>
                <option value="other">{t("failedReasonOther")}</option>
              </select>
            </label>
            {failureReasonKind === "other" && (
              <label>
                {t("optionalReason")}
                <input
                  onChange={(event) => setFailureReasonText(event.target.value)}
                  placeholder={t("failedReasonCustomPlaceholder")}
                  value={failureReasonText}
                />
              </label>
            )}
            <div className="modalActions">
              <button className="dangerButton" type="submit">{t("markFailed")}</button>
              <button
                className="ghostButton"
                onClick={() => {
                  setFailureDialogGame(null);
                  setFailureReasonText("");
                }}
                type="button"
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {messageDialog && (
        <div className="modalBackdrop" onClick={() => setMessageDialog(null)}>
          <form className="modal messageModal" onClick={(event) => event.stopPropagation()} onSubmit={handleSendPlayerMessage}>
            <div className="modalHeader">
              <h2>
                {t("messagePlayer")} {messageDialog.receiverPseudo}
              </h2>
              <button aria-label={t("cancel")} className="tinyIconButton" onClick={() => setMessageDialog(null)} type="button">
                <X size={16} />
              </button>
            </div>
            <textarea
              autoFocus
              maxLength={500}
              onChange={(event) => setMessageDraft(event.target.value)}
              placeholder={t("messagePlaceholder")}
              value={messageDraft}
            />
            <div className="messageModalFooter">
              <span>{messageDraft.length} / 500</span>
              <button className="ghostButton" onClick={() => setMessageDialog(null)} type="button">
                {t("cancel")}
              </button>
              <button className="primary" disabled={!messageDraft.trim() || busy} type="submit">
                <Send size={16} />
                {t("sendMessage")}
              </button>
            </div>
          </form>
        </div>
      )}

      {settingsOpen && (
        <div className="modalBackdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal settingsModal" onClick={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <h2>{t("settings")}</h2>
              <button aria-label={t("cancel")} className="tinyIconButton" onClick={() => setSettingsOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>
            {settingsContent()}
          </div>
        </div>
      )}

      {scannerGameId && (
        <div className="modalBackdrop">
          <div className="modal">
            <h2>{t("scanSecretQr")}</h2>
            <video className="qrVideo" muted playsInline ref={scannerVideoRef} />
            <div className="modalActions">
              <button className="ghostButton" onClick={() => setScannerGameId(null)} type="button">
                {t("stopScan")}
              </button>
            </div>
          </div>
        </div>
      )}

      {secretModalGameId && (() => {
        const game = games.find((item) => item.id === secretModalGameId);
        const secret = game ? secretFor(game) : undefined;
        if (!game || !secret) return null;
        const secretLines = splitSecretForDisplay(secret);
        return (
          <div className="modalBackdrop" onClick={closeSecretModal}>
            <div className="modal secretModal" onClick={(event) => event.stopPropagation()}>
              <button aria-label={t("closeSecret")} className="tinyIconButton secretCloseButton" onClick={closeSecretModal} type="button">
                <X size={16} />
              </button>
              {secretQrDataUrl && <img alt={t("secret")} className="secretQr" src={secretQrDataUrl} />}
              <div className="secretCopyBox">
                <code>
                  {secretLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </code>
                <button aria-label={t("copySecret")} className="tinyIconButton" onClick={() => void handleCopySecret(game)} type="button">
                  <Copy size={16} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {onchainProgress && (
        <div className="workOverlay">
          <div className="workPanel">
            <h2>{t(onchainProgress.label)}</h2>
            <div className="progress">
              <span style={{ width: `${onchainProgress.progress}%` }} />
            </div>
            <p className="notice">{t("zkWorkNotice")}</p>
            <p className="timer">{t("elapsed")}: {onchainElapsedSeconds}s</p>
            {hasPendingWalletSignature() && (
              <div className="manualSignatureBox">
                <strong>{t("manualSignatureTitle")}</strong>
                <p className="notice">{t("manualSignatureHint")}</p>
                {selectedGame?.zkappAddress && pendingRecoveryMemo(selectedGame) && (
                  <div className="manualRecoveryHelp">
                    <p>{t("walletRecoveryExplorerHint")}</p>
                    <code>{pendingRecoveryMemo(selectedGame)}</code>
                    <a className="failoverButton" href={accountExplorerUrl(selectedGame.network, selectedGame.zkappAddress)} rel="noreferrer" target="_blank">
                      {t("openZkappExplorer")}
                    </a>
                  </div>
                )}
                <label>
                  {t("manualSignatureHash")}
                  <input
                    onChange={(event) => setManualSignatureHash(event.target.value)}
                    placeholder={t("manualSignatureHashPlaceholder")}
                    value={manualSignatureHash}
                  />
                </label>
                <div className="modalActions">
                  <button className="failoverButton" disabled={!manualSignatureHash.trim()} onClick={handleManualSignatureHash} type="button">
                    {t("manualSignatureUseHash")}
                  </button>
                  <button className="dangerButton" onClick={handleManualSignatureFailed} type="button">
                    {t("manualSignatureFailed")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <section className="topbar">
        <div>
          <div className="brand">
            <img src="/zkroll-logo.svg" alt="" />
            <h1>zkroll</h1>
          </div>
          <p className="eyebrow">{t("minaZkDice")}</p>
        </div>
        <div className="topActions">
          {viewMode === "app" && (
            <div className="networkPicker">
              <button
                aria-expanded={networkMenuOpen}
                className={`networkPill ${network}`}
                onClick={() => setNetworkMenuOpen((current) => !current)}
                title={t("chooseNetwork")}
                type="button"
              >
                <span className="networkSpark" />
                <span>{networks[network].label}</span>
                <ChevronDown size={16} />
              </button>
              {networkMenuOpen && (
                <div className="networkMenu">
                  <strong>{t("chooseNetwork")}</strong>
                  {Object.values(networks).map((item) => {
                    const active = item.id === network;
                    return (
                      <button
                        className={active ? `networkOption ${item.id} active` : `networkOption ${item.id}`}
                        key={item.id}
                        onClick={() => selectAppNetwork(item.id)}
                        type="button"
                      >
                        <span>
                          <strong>{item.label}</strong>
                          <small>{t(networkDescriptionKey(item.id))}</small>
                        </span>
                        <em>{active ? t("activeNetwork") : item.id === "mainnet" ? "Mainnet" : item.id === "devnet" ? "Devnet" : "Zeko"}</em>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {viewMode !== "app" && (
            <label className="compactSelect" title={t("language")}>
              <Languages size={16} />
              <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                {localeOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.shortLabel}
                  </option>
                ))}
              </select>
            </label>
          )}
          {viewMode !== "app" && (
            <button
              className="iconButton"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Light" : "Dark"}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          )}
          <button className="iconButton" onClick={openSettings} title={t("settings")}>
            <Settings size={18} />
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
                  className="secondaryButton"
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
        <div className="leftColumn">
        <aside className="panel playerPanel">
          <div className="playerBlock">
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
          {publicKey && (
            <div className="walletAddressBox">
              <span>{t("walletAddress")}</span>
              <strong>{publicKey}</strong>
            </div>
          )}
          <label className="playerNetworkSelect">
            {t("network")}
            <select value={network} onChange={(event) => selectAppNetwork(event.target.value as NetworkId)}>
              {Object.values(networks).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="balanceBox">
            <span>{t("balance")}</span>
            <strong>{walletBalance.loading ? `${t("loading")}...` : formatBalance(walletBalance.value, locale)}</strong>
            {walletBalance.error && <small>{t("unavailable")}: {walletBalance.error}</small>}
          </div>
          <div className="walletActions">
            <button onClick={() => void connectWallet()} className="primary">
              <Wallet size={18} />
              {publicKey ? t("walletConnected") : t("connectWallet")}
            </button>
            {publicKey && (
              <button className="dangerButton subtleButton" onClick={() => void disconnectWallet()} type="button">
                {t("disconnectWallet")}
              </button>
            )}
          </div>
          </div>

          <div className="newChallengeBlock">
          <h2>{t("newChallenge")}</h2>
          <label>
            {t("stake")}
            <input min="0.1" step="0.1" type="number" value={stake} onChange={(event) => setStake(event.target.value)} />
          </label>
          <label>
            {t("payoutMode")}
            <select value={payoutMode} onChange={(event) => setPayoutMode(event.target.value as PayoutMode)}>
              {payoutModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === "opponent_takes_all" ? t("opponentTakesAll") : t("classicPayout")}
                </option>
              ))}
            </select>
          </label>
          {payoutMode === "opponent_takes_all" && <p className="notice compactNotice">{t("opponentTakesAllHint")}</p>}
          <label>
            {t("inviteOpponent")}
            <select value={inviteePublicKey} onChange={(event) => setInviteePublicKey(event.target.value)}>
              <option value="">{t("noInvite")}</option>
              {previousOpponents.map((player) => (
                <option key={player.publicKey} value={player.publicKey}>
                  {player.pseudo}
                </option>
              ))}
            </select>
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
          </div>
        </aside>

        <section className="panel messagesPanel">
          <div className="sectionHead">
            <h2>{t("playerMessages")}</h2>
            {selectedGame && unreadBadgeFor(selectedGame)}
          </div>
          <div className="playerMessageList">
            {selectedGame && (gameMessages[selectedGame.id] ?? []).length > 0 ? (
              (gameMessages[selectedGame.id] ?? []).map((item) => (
                <div className={item.senderPublicKey === publicKey ? "playerMessage mine" : "playerMessage"} key={item.id}>
                  <strong>{item.senderPublicKey === publicKey ? pseudo || t("player") : item.senderPublicKey === selectedGame.creatorPublicKey ? selectedGame.creatorPseudo : selectedGame.joinerPseudo}</strong>
                  <p>{item.body}</p>
                  <span>{formatDateTime(item.createdAt, locale)}</span>
                </div>
              ))
            ) : (
              <p className="muted">{t("noPlayerMessages")}</p>
            )}
          </div>
          {selectedGame && publicKey && (publicKey === selectedGame.creatorPublicKey || publicKey === selectedGame.joinerPublicKey) && (
            <button
              className="secondaryButton"
              onClick={() => {
                const receiverPublicKey = publicKey === selectedGame.creatorPublicKey ? selectedGame.joinerPublicKey : selectedGame.creatorPublicKey;
                const receiverPseudo = publicKey === selectedGame.creatorPublicKey ? selectedGame.joinerPseudo : selectedGame.creatorPseudo;
                if (receiverPublicKey && receiverPseudo) {
                  setMessageDraft("");
                  setMessageDialog({ game: selectedGame, receiverPublicKey, receiverPseudo });
                }
              }}
              type="button"
            >
              <MessageSquareText size={16} />
              {t("reply")}
            </button>
          )}
          <div className="sectionHead compactHead">
            <h2>{t("systemMessages")}</h2>
            <MessageCircle size={20} />
          </div>
          <div className="messageList">
            {messageHistory.map((item, index) => (
              <p className="messageItem" key={`${index}-${item}`}>
                {item}
              </p>
            ))}
          </div>
        </section>
        {leaderboardPanel()}
        </div>

        <section className="games gamesPanel">
          <div className="sectionHead">
            <h2>{t("games")}</h2>
            <span className="sectionTools">
              <button className="tinyIconButton" onClick={() => void refreshGames()} title={t("refresh")} type="button">
                <RefreshCw size={16} />
              </button>
              {newGameNotificationButton(network)}
              <span>{filteredGames.length} / {visibleGames.length} {t("indexed")}</span>
            </span>
          </div>
          <div className="gameFilters">
            <label>
              {t("onchainState")}
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="active">{t("activeStatuses")}</option>
                <option value="mine_active">{t("myActiveStatuses")}</option>
                <option value="all">{t("allStatuses")}</option>
                {gameStatuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
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
            <label>
              {t("searchGameId")}
              <span className="searchInput">
                <Search size={16} />
                <input
                  value={gameIdSearch}
                  onChange={(event) => setGameIdSearch(event.target.value)}
                  placeholder="123..."
                />
              </span>
            </label>
          </div>
          <div className="gameList">
            {paginatedGames.map((game) => (
              <div
                key={game.id}
                className={game.id === selectedGame?.id && game.network === selectedGame.network ? "gameCard selected" : "gameCard"}
                role="button"
                tabIndex={0}
                onClick={() => handleGameCardSelect(game.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") handleGameCardSelect(game.id);
                }}
              >
                <div className="gameCardHead">
                  <div className="gameCardMeta">
                    <span className="gameId">#{game.id}</span>
                    <span className={`status ${game.status}`}>{game.status}</span>
                  </div>
                  <span className="gameCardTools">
                    {messageIndicatorFor(game)}
                    {localSecretIndicator(game)}
                    {shareGameButton(game)}
                    {notificationButton(game)}
                  </span>
                </div>
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
                {game.payoutMode === "opponent_takes_all" && <small>{t("opponentTakesAll")}</small>}
                <small>{networks[game.network].label}</small>
                <small>{t("updatedAt")}: {formatDateTime(game.updatedAt, locale)}</small>
              </div>
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

        <section className="panel detail detailPanel">
          {selectedGame ? (
            <>
              <div className="sectionHead">
                <span className="detailTitleGroup">
                  {viewMode === "app" && (
                    <button className="tinyIconButton appBackButton" onClick={() => setAppScreen("games")} title={t("backToGames")} type="button">
                      <X size={16} />
                    </button>
                  )}
                  <h2>{t("challenge")} {selectedGame.id}</h2>
                </span>
                <span className="detailTools">
                  {shareGameButton(selectedGame)}
                  {notificationButton(selectedGame)}
                  <ShieldCheck size={20} />
                </span>
              </div>
              <dl>
                <div>
                  <dt>{t("creator")}</dt>
                  <dd className="playerResult">
                    {selectedGame.creatorPseudo}
                    {resultIconFor(selectedGame, "creator")}
                    {secretButtonFor(selectedGame, selectedGame.creatorPublicKey)}
                    {messageButtonFor(selectedGame, selectedGame.creatorPublicKey, selectedGame.creatorPseudo)}
                  </dd>
                </div>
                <div>
                  <dt>{t("opponent")}</dt>
                  <dd className="playerResult">
                    {selectedGame.joinerPseudo ?? t("waiting")}
                    {selectedGame.joinerPseudo && resultIconFor(selectedGame, "joiner")}
                    {secretButtonFor(selectedGame, selectedGame.joinerPublicKey)}
                    {messageButtonFor(selectedGame, selectedGame.joinerPublicKey, selectedGame.joinerPseudo)}
                  </dd>
                </div>
                <div>
                  <dt>{t("stake")}</dt>
                  <dd>{formatMina(selectedGame.stakeNanoMina)} MINA</dd>
                </div>
                <div>
                  <dt>{t("payoutMode")}</dt>
                  <dd>{selectedGame.payoutMode === "opponent_takes_all" ? t("opponentTakesAll") : t("classicPayout")}</dd>
                </div>
                {shouldShowMissingSecret(selectedGame) && (
                  <div className="detailWide">
                    <dt>{t("secret")}</dt>
                    <dd className="missingSecretActions">
                      <span>{t("secretMissing")}</span>
                      <button className="secondaryButton" type="button" onClick={() => handlePasteSecret(selectedGame)}>
                        {t("pasteSecret")}
                      </button>
                      <button className="secondaryButton" type="button" onClick={() => setScannerGameId(selectedGame.id)}>
                        {t("scanSecretQr")}
                      </button>
                    </dd>
                  </div>
                )}
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
                {transactionRow(selectedGame, "creation", t("transaction"), selectedGame.creationTxHash, creationStatusFor(selectedGame))}
                {transactionRow(selectedGame, "join", "Join tx", selectedGame.joinTxHash, statusFor(selectedGame.joinTxHash))}
                {transactionRow(selectedGame, "settlement", "Settlement tx", selectedGame.settlementTxHash, statusFor(selectedGame.settlementTxHash))}
                {transactionRow(selectedGame, "refund", "Refund tx", selectedGame.refundTxHash, statusFor(selectedGame.refundTxHash))}
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
                        : selectedGame.status === "created" && creationStatusFor(selectedGame) === "INCLUDED" && !hasSafeJoinDeadline(selectedGame)
                      ? t("joinDeadlineTooClose")
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

              {(selectedGame.status === "created" || isReservedInvite(selectedGame)) && (
                <div className="actions">
                  <button disabled={busy || !canJoin(selectedGame)} onClick={() => void handleJoinGame(selectedGame)} className="primary">
                    <Dices size={18} />
                    {t("join")}
                  </button>
                  {selectedGame.status === "created" && (
                    <button className="warningButton" disabled={busy || !canCancelOrRefund(selectedGame) || hasPendingRefund(selectedGame)} onClick={() => void handleCancelOrRefund(selectedGame)}>
                      {canCancelCreatedGame(selectedGame) ? t("cancelGame") : t("refund")}
                    </button>
                  )}
                </div>
              )}

              {selectedGame.status === "created" && creationStatusFor(selectedGame) !== "INCLUDED" && (
                <button className="dangerButton" disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleMarkCreationFailed(selectedGame)}>
                  {t("markFailed")}
                </button>
              )}

              {selectedGame.status === "join_pending" && !isReservedInvite(selectedGame) && (
                <div className="actions">
                  <button disabled={busy || !canConfirmJoin(selectedGame)} onClick={() => void handleConfirmJoin(selectedGame)} className="primary">
                    {t("confirmJoin")}
                  </button>
                </div>
              )}

              {(selectedGame.status === "joined" ||
                selectedGame.status === "player_one_revealed" ||
                selectedGame.status === "player_two_revealed" ||
                selectedGame.status === "both_revealed") && (
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
                  <button className="secondaryButton" disabled={busy || !canSettle(selectedGame) || hasPendingSettlement(selectedGame)} onClick={() => void handleSettle(selectedGame)}>
                    {t("settle")}
                  </button>
                  <button className="warningButton" disabled={busy || !canRefund(selectedGame) || hasPendingRefund(selectedGame)} onClick={() => void handleRefund(selectedGame)}>
                    {t("refund")}
                  </button>
                </div>
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

        <section className="panel settingsPanel">
          <div className="sectionHead">
            <h2>{t("settings")}</h2>
            <Settings size={20} />
          </div>
          {settingsContent()}
        </section>
      </section>

      {viewMode === "app" && (
        <nav className="bottomNav" aria-label={t("settings")}>
          <button className={appScreen === "player" ? "active" : ""} onClick={() => setAppScreen("player")} type="button">
            <User size={20} />
            <span>{t("walletTab")}</span>
          </button>
          <button className={appScreen === "new" ? "active" : ""} onClick={() => setAppScreen("new")} type="button">
            <Plus size={20} />
            <span>{t("newGameTab")}</span>
          </button>
          <button className={appScreen === "games" || appScreen === "detail" ? "active" : ""} onClick={() => setAppScreen("games")} type="button">
            <List size={20} />
            <span>{t("gamesTab")}</span>
          </button>
          <button className={appScreen === "messages" ? "active" : ""} onClick={() => setAppScreen("messages")} type="button">
            <span className="navIconWithBadge">
              <MessageCircle size={20} />
              {totalUnreadMessages > 0 && <span className="navBadge">{totalUnreadMessages > 99 ? "99+" : totalUnreadMessages}</span>}
            </span>
            <span>{t("messages")}</span>
          </button>
          <button className={appScreen === "leaderboard" ? "active" : ""} onClick={() => setAppScreen("leaderboard")} type="button">
            <Trophy size={20} />
            <span>{t("leaderboardTab")}</span>
          </button>
        </nav>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
