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
  List,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sun,
  Trophy,
  User,
  X,
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
  getWalletBalance,
  joinGame,
  listGames,
  markTransactionIncluded,
  markCreationFailed,
  reconcileCreationTx,
  refundGame,
  revealGame,
  settleGame,
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
  pseudoHash,
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
  cancelWalletConnectPrompt,
  disconnectWalletConnect,
  mobileBrowserCanUseWalletConnect,
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
const defaultRefundTimeoutSlots = Number(import.meta.env.VITE_REFUND_TIMEOUT_SLOTS ?? 120);
const txPollIntervalMs = Number(import.meta.env.VITE_TX_POLL_INTERVAL_MS ?? 60_000);
const slotPollIntervalMs = Number(import.meta.env.VITE_SLOT_POLL_INTERVAL_MS ?? 60_000);
const gamesPerPage = 5;
const zekoCreatedRefundDeadlineSlot = "4294967294";
const zekoJoinedRefundDeadlineSlot = "4294967295";
type TxStatus = TransactionStatus;
type Locale = "en" | "fr";
type Theme = "light" | "dark";
type ViewMode = "cards" | "app";
type AppScreen = "player" | "new" | "games" | "detail" | "messages" | "settings";
type StatusFilter = "active" | "mine_active" | "all" | GameStatus;
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
const terminalGameStatuses = new Set<GameStatus>(["settled", "refunded", "failed", "cancelled"]);

type QRCodeBrowserModule = {
  toDataURL: (text: string, options?: { margin?: number; width?: number }) => Promise<string>;
};

async function createSecretQrDataUrl(secret: string) {
  const qrcode = (await import("qrcode/lib/browser.js")) as QRCodeBrowserModule;
  return qrcode.toDataURL(secret, { margin: 1, width: 192 });
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

const copy: Record<Locale, Record<string, string>> = {
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
    refundTimeout: "Refund timeout (slots)",
    create: "Create",
    games: "Games",
    activeStatuses: "Active games",
    myActiveStatuses: "My active games",
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
    enterSettlementHash: "Enter settlement hash",
    pasteSettlementHash: "Paste the settlement transaction hash visible in Auro or the explorer.",
    settlementHashSaved: "Settlement hash saved. On-chain sync will be checked.",
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
    walletTab: "Wallet",
    newGameTab: "New",
    gamesTab: "Games",
    messages: "Messages",
    backToGames: "Back to games",
    walletAddress: "Wallet address",
    chooseNetwork: "Choose network",
    mainnetNetworkDescription: "Mina production network",
    devnetNetworkDescription: "Mina development network",
    zekoNetworkDescription: "Zeko test network",
    activeNetwork: "Active",
    enableNotifications: "Enable notifications for this game",
    disableNotifications: "Disable notifications for this game",
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
    openAuroFallback: "Open Auro directly",
    cancel: "Cancel",
    copyWalletConnectUri: "Copy WalletConnect URI",
    walletConnectPrompt: "Approve the WalletConnect request in Auro, then return here. If Auro opens without a connection screen, use the direct open button and the copied URI from Auro WalletConnect.",
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
    refundTimeout: "Timeout refund (slots)",
    create: "Creer",
    games: "Parties",
    activeStatuses: "Parties actives",
    myActiveStatuses: "Mes parties actives",
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
    enterSettlementHash: "Renseigner le hash settlement",
    pasteSettlementHash: "Colle le hash de la transaction settlement visible dans Auro ou l'explorateur.",
    settlementHashSaved: "Hash settlement renseigne. La synchronisation on-chain va etre verifiee.",
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
    walletTab: "Wallet",
    newGameTab: "Nouvelle",
    gamesTab: "Parties",
    messages: "Messages",
    backToGames: "Retour aux parties",
    walletAddress: "Adresse wallet",
    chooseNetwork: "Choisir reseau",
    mainnetNetworkDescription: "Reseau Mina de production",
    devnetNetworkDescription: "Reseau Mina de developpement",
    zekoNetworkDescription: "Reseau de test Zeko",
    activeNetwork: "Actif",
    enableNotifications: "Activer les notifications pour cette partie",
    disableNotifications: "Desactiver les notifications pour cette partie",
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
    openAuroFallback: "Ouvrir Auro directement",
    cancel: "Annuler",
    copyWalletConnectUri: "Copier l'URI WalletConnect",
    walletConnectPrompt: "Valide la demande WalletConnect dans Auro, puis reviens ici. Si Auro s'ouvre sans mire de connexion, utilise l'ouverture directe et l'URI copiee depuis WalletConnect dans Auro.",
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

const initialMessage = copy.en.walletPrompt ?? "Connect your wallet to start.";

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

function formatBalance(value: string | null, locale: Locale): string {
  if (!value) return "-";
  return `${(Number(value) / nanoMina).toLocaleString(locale === "fr" ? "fr-FR" : "en-US", {
    maximumFractionDigits: 6
  })} MINA`;
}

function formatDateTime(value: string | null | undefined, locale: Locale): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

async function refundDeadlineForCreate(network: NetworkId, timeoutSlots: number) {
  // Zeko does not currently expose a reliable Mina-style current slot in its GraphQL API.
  // Use high deadlines so create/join remain usable there; Devnet/Mainnet keep slot timeouts.
  if (network === "zeko") return zekoCreatedRefundDeadlineSlot;
  const currentSlot = (await getCurrentSlot(network)).currentSlot;
  return nextRefundDeadlineSlot(currentSlot, timeoutSlots);
}

async function refundDeadlineForJoin(network: NetworkId, timeoutSlots: number) {
  if (network === "zeko") return zekoJoinedRefundDeadlineSlot;
  const currentSlot = (await getCurrentSlot(network)).currentSlot;
  return nextRefundDeadlineSlot(currentSlot, timeoutSlots);
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
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem("zkroll:view-mode") === "app" ? "app" : "cards"));
  const [appScreen, setAppScreen] = useState<AppScreen>("games");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [pseudo, setPseudo] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [pseudoDraft, setPseudoDraft] = useState("");
  const [pseudoModalOpen, setPseudoModalOpen] = useState(false);
  const [network, setNetwork] = useState<NetworkId>("devnet");
  const [stake, setStake] = useState("1");
  const [refundTimeoutSlots, setRefundTimeoutSlots] = useState(String(defaultRefundTimeoutSlots));
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("mine_active");
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
  const t = (key: string) => copy[locale][key] ?? copy.en[key] ?? key;
  const [message, setMessage] = useState(initialMessage);
  const [messageHistory, setMessageHistory] = useState<string[]>(() => [initialMessage]);

  const visibleGames = useMemo(
    () => games.filter((game) => game.network === network && (game.status !== "pending_signature" || game.creatorPublicKey === publicKey)),
    [games, network, publicKey]
  );

  const filteredGames = useMemo(() => {
    const needle = playerSearch.trim().toLowerCase();
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
          !needle ||
          game.creatorPseudo.toLowerCase().includes(needle) ||
          (game.joinerPseudo?.toLowerCase().includes(needle) ?? false);
        return statusMatches && searchMatches;
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [playerSearch, publicKey, statusFilter, visibleGames]);

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

  function isActiveGame(game: Game) {
    return !terminalGameStatuses.has(game.status);
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
    return value && value in networks ? (value as NetworkId) : null;
  }

  function selectGameFromUrl(items = games) {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get("game");
    if (!gameId) return;

    const linkedGame = items.find((item) => item.id === gameId);
    const linkedNetwork = networkFromUrl(params.get("network")) ?? linkedGame?.network ?? null;
    if (linkedNetwork) setNetwork(linkedNetwork);
    setStatusFilter("all");
    setPlayerSearch("");
    setSelectedGameId(gameId);
    if (viewMode === "app") setAppScreen("detail");

    params.delete("game");
    params.delete("network");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }

  useEffect(() => {
    void refreshGames().then((items) => selectGameFromUrl(items));
    const savedVault = localStorage.getItem("zkroll:secrets");
    if (savedVault) {
      setSecretVault(JSON.parse(savedVault) as Record<string, string>);
    }
  }, []);

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
    setGamesPage(1);
  }, [network, playerSearch, statusFilter]);

  useEffect(() => {
    setGamesPage((current) => Math.min(current, totalGamePages));
  }, [totalGamePages]);

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

  function handleGameCardSelect(gameId: string) {
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
                <option value="en">English</option>
                <option value="fr">Francais</option>
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
      </>
    );
  }

  function networkDescriptionKey(networkId: NetworkId) {
    if (networkId === "mainnet") return "mainnetNetworkDescription";
    if (networkId === "zeko") return "zekoNetworkDescription";
    return "devnetNetworkDescription";
  }

  function selectAppNetwork(nextNetwork: NetworkId) {
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
        if (viewMode === "app") setAppScreen("detail");
      } else if (viewMode === "app") {
        setAppScreen("detail");
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
      const refundDeadlineSlot = onchainEnabled ? await refundDeadlineForJoin(game.network, game.refundTimeoutSlots) : "0";
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

  async function handleReconcileSettlement(game: Game) {
    await runAction(async () => {
      if (!canSettle(game)) throw new Error(t("incompleteSettlement"));
      const settlementTxHash = window.prompt(t("pasteSettlementHash"));
      if (!settlementTxHash?.trim()) return;

      const { creatorDie, joinerDie } = await computeDice(game);
      const winnerPublicKey =
        creatorDie > joinerDie ? game.creatorPublicKey : joinerDie > creatorDie ? game.joinerPublicKey : null;
      const settled = await settleGame(game.id, {
        creatorDie,
        joinerDie,
        winnerPublicKey,
        settlementTxHash: settlementTxHash.trim()
      });
      setSelectedGameId(settled.id);
      setTxStatuses((current) => ({ ...current, [settlementTxHash.trim()]: settled.settlementTxStatus ?? "PENDING" }));
      setMessage(t("settlementHashSaved"));
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

  async function handleCancelCreatedGame(game: Game) {
    await runAction(async () => {
      if (!publicKey) throw new Error(t("walletRequired"));
      if (!canCancelCreatedGame(game)) throw new Error(t("cancelNotReady"));

      let txHash = fakeTxHash("refund");
      if (onchainEnabled) {
        if (!game.gameIdField || !game.zkappAddress || !game.creatorPseudoHash || !game.refundDeadlineSlot) {
          throw new Error(t("incompleteRefund"));
        }
        txHash = await cancelCreatedGameOnchain({
          provider: walletProvider(),
          network: game.network,
          senderPublicKey: publicKey,
          gameIdField: game.gameIdField,
          zkappAddress: game.zkappAddress,
          creatorPseudoHash: game.creatorPseudoHash,
          creatorCommitment: game.creatorCommitment,
          refundDeadlineSlot: game.refundDeadlineSlot,
          onProgress: updateOnchainProgress
        });
      }

      const refunded = await refundGame(game.id, { refundTxHash: txHash });
      setSelectedGameId(refunded.id);
      setMessage(t("cancelSent"));
      await refreshGames();
    });
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
            {walletConnectPrompt.fallbackOpenUrl && (
              <a className="secondaryButton actionLink" href={walletConnectPrompt.fallbackOpenUrl} rel="noreferrer">
                {t("openAuroFallback")}
              </a>
            )}
            {walletConnectPrompt.uri && (
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(walletConnectPrompt.uri ?? "");
                }}
              >
                {t("copyWalletConnectUri")}
              </button>
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
                <label>
                  {t("manualSignatureHash")}
                  <input
                    onChange={(event) => setManualSignatureHash(event.target.value)}
                    placeholder={t("manualSignatureHashPlaceholder")}
                    value={manualSignatureHash}
                  />
                </label>
                <div className="modalActions">
                  <button className="secondaryButton" disabled={!manualSignatureHash.trim()} onClick={handleManualSignatureHash} type="button">
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
                <option value="en">EN</option>
                <option value="fr">FR</option>
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
          {viewMode !== "app" && (
            <button className="iconButton" onClick={openSettings} title={t("settings")}>
              <Settings size={18} />
            </button>
          )}
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
            <select value={network} onChange={(event) => setNetwork(event.target.value as NetworkId)}>
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
            <h2>{t("messages")}</h2>
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
          </div>
          <div className="gameList">
            {paginatedGames.map((game) => (
              <div
                key={game.id}
                className={game.id === selectedGame?.id ? "gameCard selected" : "gameCard"}
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
                  {notificationButton(game)}
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
                  </dd>
                </div>
                <div>
                  <dt>{t("opponent")}</dt>
                  <dd className="playerResult">
                    {selectedGame.joinerPseudo ?? t("waiting")}
                    {selectedGame.joinerPseudo && resultIconFor(selectedGame, "joiner")}
                    {secretButtonFor(selectedGame, selectedGame.joinerPublicKey)}
                  </dd>
                </div>
                <div>
                  <dt>{t("stake")}</dt>
                  <dd>{formatMina(selectedGame.stakeNanoMina)} MINA</dd>
                </div>
                {connectedPlayerCanUseSecret(selectedGame) && !secretFor(selectedGame) && (
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
                  <button className="secondaryButton" disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleReconcileCreation(selectedGame)}>
                    {t("enterHash")}
                  </button>
                  <button
                    className="secondaryButton"
                    disabled={busy || selectedGame.creatorPublicKey !== publicKey || !loadPendingCreationMaterial(selectedGame, publicKey)}
                    onClick={() => void handleResignCreation(selectedGame)}
                  >
                    {t("resignCreation")}
                  </button>
                  <button className="dangerButton" disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleMarkCreationFailed(selectedGame)}>
                    {t("markFailed")}
                  </button>
                </div>
              )}

              {selectedGame.status === "created" && (
                <div className="actions">
                  <button disabled={busy || !canJoin(selectedGame)} onClick={() => void handleJoinGame(selectedGame)} className="primary">
                    <Dices size={18} />
                    {t("join")}
                  </button>
                  <button className="warningButton" disabled={busy || !canCancelCreatedGame(selectedGame)} onClick={() => void handleCancelCreatedGame(selectedGame)}>
                    {t("cancelGame")}
                  </button>
                </div>
              )}

              {selectedGame.status === "created" && creationStatusFor(selectedGame) !== "INCLUDED" && (
                <button className="dangerButton" disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleMarkCreationFailed(selectedGame)}>
                  {t("markFailed")}
                </button>
              )}

              {selectedGame.status === "join_pending" && (
                <div className="actions">
                  <button disabled={busy || !canConfirmJoin(selectedGame)} onClick={() => void handleConfirmJoin(selectedGame)} className="primary">
                    {t("confirmJoin")}
                  </button>
                  <button
                    className="warningButton"
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
                  <button className="secondaryButton" disabled={busy || !canSettle(selectedGame)} onClick={() => void handleSettle(selectedGame)}>
                    {t("settle")}
                  </button>
                  <button className="secondaryButton" disabled={busy || !canSettle(selectedGame)} onClick={() => void handleReconcileSettlement(selectedGame)}>
                    {t("enterSettlementHash")}
                  </button>
                  <button className="warningButton" disabled={busy || !canRefund(selectedGame)} onClick={() => void handleRefund(selectedGame)}>
                    {t("refund")}
                  </button>
                </div>
              )}

              {selectedGame.status === "created" && (
                <button className="warningButton" disabled={busy || !canRefund(selectedGame)} onClick={() => void handleRefund(selectedGame)}>
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
            <MessageCircle size={20} />
            <span>{t("messages")}</span>
          </button>
          <button className={appScreen === "settings" ? "active" : ""} onClick={() => setAppScreen("settings")} type="button">
            <Settings size={20} />
            <span>{t("settings")}</span>
          </button>
        </nav>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
