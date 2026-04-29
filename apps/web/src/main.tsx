import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dices, RefreshCw, ShieldCheck, Trophy, Wallet } from "lucide-react";
import { networks, type Game, type NetworkId } from "@zkroll/shared";
import {
  createGame,
  createPlayer,
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
type TxStatus = "INCLUDED" | "PENDING" | "FAILED" | "UNKNOWN";

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
  const [message, setMessage] = useState("Connecte ton wallet pour commencer.");

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
      hash.startsWith("settle_")
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
    if (!Number.isInteger(value) || value < 1) throw new Error("Le timeout de refund doit etre un nombre entier positif.");
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
    const interval = window.setInterval(() => void poll(), 15000);
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
    const interval = window.setInterval(() => void poll(), 30000);
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
      throw new Error("Les deux secrets doivent etre reveles.");
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
      setMessage("Wallet Mina introuvable. Installe Auro ou active l'extension.");
      return;
    }

    const accounts = await window.mina.requestAccounts();
    const account = accounts[0] ?? "";
    setPublicKey(account);
    if (!account) {
      setMessage("Aucun compte retourne par le wallet.");
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
      setMessage(`Wallet connecte. Pseudo retrouve : ${player.pseudo}.`);
    } catch {
      setPseudoDraft("");
      setPseudoModalOpen(true);
      setMessage("Wallet connecte. Choisis un pseudo pour enregistrer cette adresse.");
    }
  }

  async function savePseudo(event: FormEvent) {
    event.preventDefault();
    if (!publicKey) return;
    const player = await createPlayer({ pseudo: pseudoDraft.trim(), publicKey });
    setPseudo(player.pseudo);
    setPseudoModalOpen(false);
    setMessage(`Pseudo enregistre : ${player.pseudo}.`);
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
        throw new Error("Seul le createur peut renseigner le hash de creation.");
      }
      const txHash = window.prompt("Colle le hash de la transaction de creation visible dans Auro ou l'explorateur.");
      if (!txHash?.trim()) return;
      const reconciled = await reconcileCreationTx(game.id, txHash.trim());
      setSelectedGameId(reconciled.id);
      setMessage("Hash de creation renseigne. La synchronisation on-chain va etre verifiee.");
    });
  }

  async function handleMarkCreationFailed(game: Game) {
    await runAction(async () => {
      if (game.creatorPublicKey !== publicKey) {
        throw new Error("Seul le createur peut marquer cette creation comme echouee.");
      }
      const confirmed = window.confirm(
        "Marquer cette creation comme echouee ? A utiliser uniquement si la transaction create est failed sur l'explorateur."
      );
      if (!confirmed) return;
      const reason =
        window.prompt("Raison optionnelle", "Create transaction failed on-chain") ?? "Create transaction failed on-chain";
      const failed = await markCreationFailed(game.id, reason.trim() || undefined);
      setSelectedGameId(failed.id);
      setMessage("Creation marquee comme echouee. La partie est exclue de la racine Merkle locale.");
    });
  }

  async function handleCreateGame() {
    await runAction(async () => {
      if (!pseudo || !publicKey) throw new Error("Pseudo et wallet requis.");
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

      setMessage(onchainEnabled ? "Defi cree on-chain et indexe." : "Defi cree en mode simulation.");
    });
  }

  async function handleJoinGame(game: Game) {
    await runAction(async () => {
      if (!pseudo || !publicKey) throw new Error("Pseudo et wallet requis.");
      if (game.creatorPublicKey === publicKey) throw new Error("Tu ne peux pas rejoindre ton propre defi.");
      const secret = randomFieldString();
      const gameIdField = game.gameIdField ?? game.id;
      const joinerPseudoHash = onchainEnabled ? await pseudoHash(pseudo) : undefined;
      const joinerCommitment = onchainEnabled
        ? await onchainCommitment(secret, publicKey, gameIdField)
        : await temporaryCommitment(secret, publicKey, game.id);
      const refundDeadlineSlot = onchainEnabled ? await nextRefundDeadlineSlot(game.network, game.refundTimeoutSlots) : "0";
      let txHash = fakeTxHash("join");

      if (onchainEnabled) {
        if (!game.gameIdField || !game.creatorPseudoHash || !game.refundDeadlineSlot) throw new Error("Partie non compatible on-chain.");
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
      rememberSecret(joined.id, secret);
      setSelectedGameId(joined.id);
      setMessage(onchainEnabled ? "Defi rejoint on-chain. Les deux joueurs peuvent reveler." : "Defi rejoint en mode simulation.");
    });
  }

  async function handleReveal(game: Game) {
    await runAction(async () => {
      const secret = secretFor(game);
      if (!publicKey || !secret) throw new Error("Wallet et secret requis.");
      const updatedGame = await revealGame(game.id, { publicKey, secret });
      if (updatedGame.creatorReveal && updatedGame.joinerReveal) {
        const { creatorDie, joinerDie } = await computeDice(updatedGame);
        await animateDice(updatedGame.id, creatorDie, joinerDie);
        setMessage("Les deux secrets sont reveles. Resultat calcule localement; le settlement fera verifier et payer on-chain.");
      } else {
        setMessage("Secret revele. En attente du reveal de l'autre joueur.");
      }
    });
  }

  async function handleSettle(game: Game) {
    await runAction(async () => {
      if (!game.creatorReveal || !game.joinerReveal) {
        throw new Error("Les deux secrets doivent etre reveles.");
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
          throw new Error("Partie incomplete pour settlement on-chain.");
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
      setMessage(onchainEnabled ? "Partie reglee on-chain et indexee." : "Partie reglee en mode simulation.");
    });
  }

  async function handleRefund(game: Game) {
    await runAction(async () => {
      if (!publicKey) throw new Error("Wallet requis.");
      if (!canRefund(game)) throw new Error("Le timeout doit etre atteint et les transactions create/join doivent etre incluses avant un refund.");
      if (game.creatorPublicKey !== publicKey && game.joinerPublicKey !== publicKey) {
        throw new Error("Seul un joueur de cette partie peut demander le refund.");
      }

      let txHash = fakeTxHash("refund");
      if (onchainEnabled) {
        if (!game.gameIdField || !game.creatorPseudoHash || !game.refundDeadlineSlot) {
          throw new Error("Partie incomplete pour refund on-chain.");
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
      setMessage(onchainEnabled ? "Refund envoye on-chain et indexe." : "Partie remboursee en mode simulation.");
    });
  }

  return (
    <main className="shell">
      {pseudoModalOpen && (
        <div className="modalBackdrop">
          <form className="modal" onSubmit={(event) => void savePseudo(event)}>
            <h2>Choisir un pseudo</h2>
            <p className="notice">Ce pseudo sera associe a ton wallet dans la base locale.</p>
            <label>
              Pseudo
              <input
                autoFocus
                value={pseudoDraft}
                onChange={(event) => setPseudoDraft(event.target.value)}
                placeholder="naamah"
              />
            </label>
            <button className="primary" disabled={!pseudoDraft.trim()} type="submit">
              Enregistrer
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
            <p className="notice">La compilation et la generation de preuve peuvent prendre un moment dans le navigateur.</p>
            <p className="timer">Temps ecoule : {onchainElapsedSeconds}s</p>
          </div>
        </div>
      )}

      <section className="topbar">
        <div>
          <p className="eyebrow">Mina / Zeko zk dice</p>
          <div className="brand">
            <img src="/zkroll-logo.svg" alt="" />
            <h1>zkroll</h1>
          </div>
        </div>
        <button className="iconButton" onClick={() => void refreshGames()} title="Rafraichir">
          <RefreshCw size={18} />
        </button>
      </section>

      <section className="layout">
        <aside className="panel">
          <h2>Joueur</h2>
          <div className="identityBox">
            <span>Pseudo</span>
            <strong>{pseudo || "Non configure"}</strong>
          </div>
          <label>
            Reseau
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
            {publicKey ? "Wallet connecte" : "Connecter wallet"}
          </button>
          {publicKey && <p className="key">{publicKey}</p>}

          <h2>Nouveau defi</h2>
          <label>
            Mise en MINA
            <input min="0.1" step="0.1" type="number" value={stake} onChange={(event) => setStake(event.target.value)} />
          </label>
          <label>
            Timeout refund (slots)
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
            Creer
          </button>
          <p className="notice">{message}</p>
        </aside>

        <section className="games">
          <div className="sectionHead">
            <h2>Parties</h2>
          <span>{visibleGames.length} indexees</span>
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
                <h2>Defi {selectedGame.id}</h2>
                <ShieldCheck size={20} />
              </div>
              <dl>
                <div>
                  <dt>Createur</dt>
                  <dd>{selectedGame.creatorPseudo}</dd>
                </div>
                <div>
                  <dt>Adversaire</dt>
                  <dd>{selectedGame.joinerPseudo ?? "En attente"}</dd>
                </div>
                <div>
                  <dt>Mise</dt>
                  <dd>{formatMina(selectedGame.stakeNanoMina)} MINA</dd>
                </div>
                <div>
                  <dt>Transaction</dt>
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
                  <dt>Refund</dt>
                  <dd>
                    {selectedGame.refundDeadlineSlot
                      ? `${selectedGame.refundTimeoutSlots} slots, actif apres le slot ${selectedGame.refundDeadlineSlot}. Slot courant: ${
                          currentSlots[selectedGame.network] ?? "..."
                        }`
                      : "Non configure"}
                  </dd>
                </div>
                <div>
                  <dt>Etat on-chain</dt>
                  <dd>
                    {selectedGame.status === "pending_signature"
                      ? "Signature envoyee ou en attente de hash"
                      : selectedGame.status === "failed"
                        ? selectedGame.failureReason ?? "Creation echouee on-chain"
                        : selectedGame.status === "created" && creationStatusFor(selectedGame) !== "INCLUDED"
                      ? "En attente de confirmation creation"
                      : selectedGame.status === "joined" && statusFor(selectedGame.joinTxHash) !== "INCLUDED"
                        ? "En attente de confirmation join"
                        : "Actions disponibles selon l'etat de partie"}
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
                    Renseigner le hash
                  </button>
                  <button disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleMarkCreationFailed(selectedGame)}>
                    Marquer echouee
                  </button>
                </div>
              )}

              {selectedGame.status === "created" && (
                <button disabled={busy || !canJoin(selectedGame)} onClick={() => void handleJoinGame(selectedGame)} className="primary">
                  <Dices size={18} />
                  Rejoindre
                </button>
              )}

              {selectedGame.status === "created" && creationStatusFor(selectedGame) !== "INCLUDED" && (
                <button disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleMarkCreationFailed(selectedGame)}>
                  Marquer echouee
                </button>
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
                    Reveler
                  </button>
                  <button disabled={busy || !canSettle(selectedGame)} onClick={() => void handleSettle(selectedGame)}>
                    Regler
                  </button>
                  <button disabled={busy || !canRefund(selectedGame)} onClick={() => void handleRefund(selectedGame)}>
                    Refund
                  </button>
                </div>
              )}

              {selectedGame.status === "created" && (
                <button disabled={busy || !canRefund(selectedGame)} onClick={() => void handleRefund(selectedGame)}>
                  Refund
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
                  <strong>Partie remboursee</strong>
                </div>
              )}

              {selectedGame.status === "failed" && (
                <div className="winner failedBox">
                  <ShieldCheck size={22} />
                  <strong>Creation echouee</strong>
                  <span>{selectedGame.failureReason ?? "Aucun fonds n'a ete verrouille par le contrat."}</span>
                </div>
              )}
            </>
          ) : (
            <p className="empty">Aucune partie pour le moment.</p>
          )}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
