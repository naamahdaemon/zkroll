import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dices, Languages, Moon, Pencil, RefreshCw, ShieldCheck, Sun, Trophy, Wallet } from "lucide-react";
import { networks, type Game, type NetworkId } from "@zkroll/shared";
import {
  createGame,
  createPlayer,
  confirmJoinGame,
  failPendingJoin,
  getCurrentSlot,
  getMerkleWitness,
  getPlayerByPublicKey,
  getTransactionStatus,
  joinGame,
  listGames,
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
  joinGameOnchain,
  nextRefundDeadlineSlot,
  pseudoHash,
  refundGameOnchain,
  settleGameOnchain,
  type OnchainProgress
} from "./onchain";
import "./styles.css";
import "./types";

const nanoMina = 1_000_000_000;
const onchainEnabled = import.meta.env.VITE_ONCHAIN_ENABLED === "true";
const globalContractAddress = import.meta.env.VITE_ZKROLL_CONTRACT_ADDRESS as string | undefined;
const defaultRefundTimeoutSlots = Number(import.meta.env.VITE_REFUND_TIMEOUT_SLOTS ?? 120);
const txPollIntervalMs = Number(import.meta.env.VITE_TX_POLL_INTERVAL_MS ?? 60_000);
const slotPollIntervalMs = Number(import.meta.env.VITE_SLOT_POLL_INTERVAL_MS ?? 60_000);
type TxStatus = "INCLUDED" | "PENDING" | "FAILED" | "UNKNOWN";
type Locale = "en" | "fr";
type Theme = "light" | "dark";

const copy: Record<Locale, Record<string, string>> = {
  en: {
    walletPrompt: "Connect your wallet to start.",
    noPseudo: "Not configured",
    player: "Player",
    pseudo: "Pseudo",
    network: "Network",
    connectWallet: "Connect wallet",
    walletConnected: "Wallet connected",
    newChallenge: "New challenge",
    stake: "Stake in MINA",
    refundTimeout: "Refund timeout (slots)",
    create: "Create",
    games: "Games",
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
    markFailed: "Mark failed",
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
    minaZkDice: "Mina / Zeko zk dice"
  },
  fr: {
    walletPrompt: "Connecte ton wallet pour commencer.",
    noPseudo: "Non configure",
    player: "Joueur",
    pseudo: "Pseudo",
    network: "Reseau",
    connectWallet: "Connecter wallet",
    walletConnected: "Wallet connecte",
    newChallenge: "Nouveau defi",
    stake: "Mise en MINA",
    refundTimeout: "Timeout refund (slots)",
    create: "Creer",
    games: "Parties",
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
    markFailed: "Marquer echouee",
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
    minaZkDice: "Mina / Zeko zk dice"
  }
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
  const [secretVault, setSecretVault] = useState<Record<string, string>>({});
  const [rollingGameId, setRollingGameId] = useState<string | null>(null);
  const [previewDice, setPreviewDice] = useState<Record<string, { creatorDie: number; joinerDie: number }>>({});
  const [rollFrames, setRollFrames] = useState<Record<string, { creatorDie: number; joinerDie: number }>>({});
  const [busy, setBusy] = useState(false);
  const [onchainProgress, setOnchainProgress] = useState<OnchainProgress | null>(null);
  const [onchainStartedAt, setOnchainStartedAt] = useState<number | null>(null);
  const [onchainElapsedSeconds, setOnchainElapsedSeconds] = useState(0);
  const [txStatuses, setTxStatuses] = useState<Record<string, TxStatus>>({});
  const [currentSlots, setCurrentSlots] = useState<Record<NetworkId, string | null>>({
    mainnet: null,
    devnet: null,
    zeko: null
  });
  const t = (key: string) => copy[locale][key] ?? copy.en[key] ?? key;
  const [message, setMessage] = useState(() => copy.en.walletPrompt);

  const visibleGames = useMemo(
    () => games.filter((game) => game.status !== "pending_signature" || game.creatorPublicKey === publicKey),
    [games, publicKey]
  );

  const selectedGame = useMemo(
    () => visibleGames.find((game) => game.id === selectedGameId) ?? visibleGames[0] ?? null,
    [visibleGames, selectedGameId]
  );

  async function refreshGames() {
    const nextGames = await listGames();
    setGames(nextGames);
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
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("zkroll:theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!onchainEnabled || games.length === 0) return;

    let cancelled = false;
    const poll = async () => {
      const txs = games.flatMap((game) => {
        if (!shouldPollGame(game)) return [];
        return [
          { network: game.network, hash: game.creationTxHash },
          { network: game.network, hash: game.joinTxHash },
          { network: game.network, hash: game.settlementTxHash },
          { network: game.network, hash: game.refundTxHash }
        ].filter((item): item is { network: NetworkId; hash: string } => Boolean(item.hash));
      });
      const unique = Array.from(new Map(txs.map((item) => [item.hash, item])).values()).filter(
        (item) => !isTerminalTxStatus(txStatuses[item.hash])
      );
      if (unique.length === 0) return;

      const nextStatuses: Record<string, TxStatus> = {};
      await Promise.all(
        unique.map(async (item) => {
          try {
            const result = await getTransactionStatus(item.network, item.hash);
            nextStatuses[item.hash] = result.status;
          } catch {
            nextStatuses[item.hash] = "UNKNOWN";
          }
        })
      );

      if (!cancelled) {
        setTxStatuses((current) => ({ ...current, ...nextStatuses }));
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), txPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [games, txStatuses]);

  useEffect(() => {
    if (!onchainEnabled) return;

    let cancelled = false;
    const poll = async () => {
      const networksToPoll = Array.from(new Set([network, ...games.map((game) => game.network)]));
      const nextSlots = await Promise.all(
        networksToPoll.map(async (item) => {
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
  }, [games, network]);

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
    if (!window.mina) {
      setMessage(t("walletMissing"));
      return;
    }

    const accounts = await window.mina.requestAccounts();
    const account = accounts[0] ?? "";
    setPublicKey(account);
    if (!account) {
      setMessage(t("noWalletAccount"));
      return;
    }

    try {
      await ensureWalletNetwork(window.mina, network);
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

  async function handleReconcileCreation(game: Game) {
    await runAction(async () => {
      if (game.creatorPublicKey !== publicKey) {
        throw new Error(t("creatorOnlyHash"));
      }
      const txHash = window.prompt(t("pasteCreationHash"));
      if (!txHash?.trim()) return;
      const reconciled = await reconcileCreationTx(game.id, txHash.trim());
      setSelectedGameId(reconciled.id);
      setMessage(t("hashSaved"));
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
      setSelectedGameId(failed.id);
      setMessage(t("markedFailed"));
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
      const created = await createGame({
        id: gameIdField.slice(0, 12),
        network,
        zkappAddress: onchainEnabled ? globalContractAddress : undefined,
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
      setSelectedGameId(created.id);

      if (onchainEnabled) {
        const witness = await getMerkleWitness(network, gameIdField);
        txHash = await createGameOnchain({
          provider: window.mina,
          network,
          senderPublicKey: publicKey,
          pseudo,
          secret,
          gameIdField,
          stakeNanoMina,
          refundDeadlineSlot,
          witness: witness.witness,
          onProgress: updateOnchainProgress
        });
        const reconciled = await reconcileCreationTx(created.id, txHash);
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
        if (!game.gameIdField || !game.creatorPseudoHash || !game.refundDeadlineSlot) throw new Error(t("incompatibleOnchain"));
        const witness = await getMerkleWitness(game.network, game.gameIdField);
        txHash = await joinGameOnchain({
          provider: window.mina,
          network: game.network,
          senderPublicKey: publicKey,
          pseudo,
          secret,
          gameIdField: game.gameIdField,
          witness: witness.witness,
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
          !game.creatorPseudoHash ||
          !game.joinerPseudoHash ||
          !game.joinerPublicKey ||
          !game.joinerCommitment ||
          !game.refundDeadlineSlot
        ) {
          throw new Error(t("incompleteSettlement"));
        }
        const witness = await getMerkleWitness(game.network, game.gameIdField);
        txHash = await settleGameOnchain({
          provider: window.mina,
          network: game.network,
          senderPublicKey: publicKey,
          gameIdField: game.gameIdField,
          witness: witness.witness,
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
        if (!game.gameIdField || !game.creatorPseudoHash || !game.refundDeadlineSlot) {
          throw new Error(t("incompleteRefund"));
        }
        const witness = await getMerkleWitness(game.network, game.gameIdField);
        txHash = await refundGameOnchain({
          provider: window.mina,
          network: game.network,
          senderPublicKey: publicKey,
          status: game.status,
          gameIdField: game.gameIdField,
          witness: witness.witness,
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
          <button onClick={() => void connectWallet()} className="primary">
            <Wallet size={18} />
            {publicKey ? t("walletConnected") : t("connectWallet")}
          </button>
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
          <span>{visibleGames.length} {t("indexed")}</span>
          </div>
          <div className="gameList">
            {visibleGames.map((game) => (
              <button
                key={game.id}
                className={game.id === selectedGame?.id ? "gameCard selected" : "gameCard"}
                onClick={() => setSelectedGameId(game.id)}
              >
                <span className={`status ${game.status}`}>{game.status}</span>
                <strong>{game.creatorPseudo}</strong>
                <span>{formatMina(game.stakeNanoMina)} MINA</span>
                <small>{networks[game.network].label}</small>
              </button>
            ))}
          </div>
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
                  <dd>{selectedGame.creatorPseudo}</dd>
                </div>
                <div>
                  <dt>{t("opponent")}</dt>
                  <dd>{selectedGame.joinerPseudo ?? t("waiting")}</dd>
                </div>
                <div>
                  <dt>{t("stake")}</dt>
                  <dd>{formatMina(selectedGame.stakeNanoMina)} MINA</dd>
                </div>
                <div>
                  <dt>{t("transaction")}</dt>
                  <dd>
                    {selectedGame.creationTxHash}
                    <span className={`txBadge ${creationStatusFor(selectedGame).toLowerCase()}`}>
                      {creationStatusFor(selectedGame)}
                    </span>
                  </dd>
                </div>
                {selectedGame.joinTxHash && (
                  <div>
                    <dt>Join tx</dt>
                    <dd>
                      {selectedGame.joinTxHash}
                      <span className={`txBadge ${statusFor(selectedGame.joinTxHash).toLowerCase()}`}>
                        {statusFor(selectedGame.joinTxHash)}
                      </span>
                    </dd>
                  </div>
                )}
                {selectedGame.settlementTxHash && (
                  <div>
                    <dt>Settlement tx</dt>
                    <dd>
                      {selectedGame.settlementTxHash}
                      <span className={`txBadge ${statusFor(selectedGame.settlementTxHash).toLowerCase()}`}>
                        {statusFor(selectedGame.settlementTxHash)}
                      </span>
                    </dd>
                  </div>
                )}
                {selectedGame.refundTxHash && (
                  <div>
                    <dt>Refund tx</dt>
                    <dd>
                      {selectedGame.refundTxHash}
                      <span className={`txBadge ${statusFor(selectedGame.refundTxHash).toLowerCase()}`}>
                        {statusFor(selectedGame.refundTxHash)}
                      </span>
                    </dd>
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
                    <dd>{selectedGame.zkappAddress}</dd>
                  </div>
                )}
              </dl>

              {selectedGame.status === "pending_signature" && (
                <div className="actions">
                  <button disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleReconcileCreation(selectedGame)}>
                    {t("enterHash")}
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
                  <strong>{selectedGame.winnerPublicKey ?? "Egalite"}</strong>
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
