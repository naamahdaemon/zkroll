import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dices, RefreshCw, ShieldCheck, Trophy, Wallet } from "lucide-react";
import { networks, type Game, type NetworkId } from "@zkroll/shared";
import {
  createGame,
  createPlayer,
  getMerkleWitness,
  getPlayerByPublicKey,
  getTransactionStatus,
  joinGame,
  listGames,
  reconcileCreationTx,
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
  pseudoHash,
  settleGameOnchain,
  type OnchainProgress
} from "./onchain";
import "./styles.css";
import "./types";

const nanoMina = 1_000_000_000;
const onchainEnabled = import.meta.env.VITE_ONCHAIN_ENABLED === "true";
const globalContractAddress = import.meta.env.VITE_ZKROLL_CONTRACT_ADDRESS as string | undefined;
type TxStatus = "INCLUDED" | "PENDING" | "UNKNOWN";

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
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [secretVault, setSecretVault] = useState<Record<string, string>>({});
  const [rollingGameId, setRollingGameId] = useState<string | null>(null);
  const [previewDice, setPreviewDice] = useState<Record<string, { creatorDie: number; joinerDie: number }>>({});
  const [rollFrames, setRollFrames] = useState<Record<string, { creatorDie: number; joinerDie: number }>>({});
  const [busy, setBusy] = useState(false);
  const [onchainProgress, setOnchainProgress] = useState<OnchainProgress | null>(null);
  const [txStatuses, setTxStatuses] = useState<Record<string, TxStatus>>({});
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

  function canJoin(game: Game): boolean {
    return game.status === "created" && statusFor(game.creationTxHash) === "INCLUDED";
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
      const txs = games.flatMap((game) =>
        [
          { network: game.network, hash: game.creationTxHash },
          { network: game.network, hash: game.joinTxHash },
          { network: game.network, hash: game.settlementTxHash }
        ].filter((item): item is { network: NetworkId; hash: string } => Boolean(item.hash))
      );
      const unique = Array.from(new Map(txs.map((item) => [item.hash, item])).values());

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
  }, [games]);

  function rememberSecret(gameId: string, secret: string) {
    setSecretVault((vault) => {
      const nextVault = { ...vault, [gameId]: secret };
      localStorage.setItem("zkroll:secrets", JSON.stringify(nextVault));
      return nextVault;
    });
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
    try {
      await action();
      await refreshGames();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
      setOnchainProgress(null);
    }
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
        creationTxHash: onchainEnabled ? undefined : txHash
      });
      rememberSecret(created.id, secret);
      setSelectedGameId(created.id);

      if (onchainEnabled) {
        const witness = await getMerkleWitness(gameIdField);
        txHash = await createGameOnchain({
          provider: window.mina,
          network,
          senderPublicKey: publicKey,
          pseudo,
          secret,
          gameIdField,
          stakeNanoMina,
          witness: witness.witness,
          onProgress: setOnchainProgress
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
      let txHash = fakeTxHash("join");

      if (onchainEnabled) {
        if (!game.gameIdField || !game.creatorPseudoHash) throw new Error("Partie non compatible on-chain.");
        const witness = await getMerkleWitness(game.gameIdField);
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
          onProgress: setOnchainProgress
        });
      }

      const joined = await joinGame(game.id, {
        joinerPseudo: pseudo,
        joinerPublicKey: publicKey,
        joinerPseudoHash,
        joinerCommitment,
        joinTxHash: txHash
      });
      rememberSecret(joined.id, secret);
      setSelectedGameId(joined.id);
      setMessage(onchainEnabled ? "Defi rejoint on-chain. Les deux joueurs peuvent reveler." : "Defi rejoint en mode simulation.");
    });
  }

  async function handleReveal(game: Game) {
    await runAction(async () => {
      const secret = secretVault[game.id];
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
        if (!game.gameIdField || !game.creatorPseudoHash || !game.joinerPseudoHash || !game.joinerPublicKey || !game.joinerCommitment) {
          throw new Error("Partie incomplete pour settlement on-chain.");
        }
        const witness = await getMerkleWitness(game.gameIdField);
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
          onProgress: setOnchainProgress
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
                    <span className={`txBadge ${statusFor(selectedGame.creationTxHash).toLowerCase()}`}>
                      {statusFor(selectedGame.creationTxHash)}
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
                <div>
                  <dt>Etat on-chain</dt>
                  <dd>
                    {selectedGame.status === "pending_signature"
                      ? "Signature envoyee ou en attente de hash"
                      : selectedGame.status === "created" && statusFor(selectedGame.creationTxHash) !== "INCLUDED"
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
                <button disabled={busy || selectedGame.creatorPublicKey !== publicKey} onClick={() => void handleReconcileCreation(selectedGame)}>
                  Renseigner le hash
                </button>
              )}

              {selectedGame.status === "created" && (
                <button disabled={busy || !canJoin(selectedGame)} onClick={() => void handleJoinGame(selectedGame)} className="primary">
                  <Dices size={18} />
                  Rejoindre
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
                </div>
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
