import { AccountUpdate, Field, Mina, UInt64 } from "o1js";
import { ZkDiceGame } from "../ZkDiceGame.js";
import {
  commitment,
  gameIdFromZkapp,
  logJson,
  postIndexer,
  pseudoHash,
  readEnv,
  readFee,
  readPrivateKey,
  readUInt32,
  readUInt64,
  useNetwork
} from "./env.js";

const network = useNetwork();
const feePayerKey = readPrivateKey("FEE_PAYER_PRIVATE_KEY");
const creatorKey = process.env.CREATOR_PRIVATE_KEY ? readPrivateKey("CREATOR_PRIVATE_KEY") : feePayerKey;
const zkappKey = readPrivateKey("ZKAPP_PRIVATE_KEY");
const feePayer = feePayerKey.toPublicKey();
const creator = creatorKey.toPublicKey();
const zkappAddress = zkappKey.toPublicKey();
const creatorPseudo = readEnv("CREATOR_PSEUDO");
const creatorSecret = Field(readEnv("CREATOR_SECRET"));
const stake = readUInt64("STAKE_NANOMINA");
const payoutMode = Field(process.env.PAYOUT_MODE === "opponent_takes_all" ? 1 : 0);
const refundDeadlineSlot = readUInt32("REFUND_DEADLINE_SLOT");
const gameId = process.env.GAME_ID_FIELD ? Field(process.env.GAME_ID_FIELD) : gameIdFromZkapp(zkappAddress);
const zkapp = new ZkDiceGame(zkappAddress);

console.log("Compiling ZkDiceGame...");
const { verificationKey } = await ZkDiceGame.compile();

console.log("Building deploy + createGame transaction...");
const tx = await Mina.transaction({ sender: feePayer, fee: readFee() }, async () => {
  AccountUpdate.fundNewAccount(feePayer);
  await zkapp.deploy({ verificationKey });
  await zkapp.createGame(
    gameId,
    creator,
    pseudoHash(creatorPseudo),
    stake,
    commitment(creatorSecret, creator, gameId),
    payoutMode,
    refundDeadlineSlot
  );
});

await tx.prove();
tx.sign([feePayerKey, creatorKey, zkappKey]);
const pending = await tx.send();

const output = {
  network,
  txHash: pending.hash,
  zkappAddress: zkappAddress.toBase58(),
  gameIdField: gameId.toString(),
  creatorPublicKey: creator.toBase58(),
  creatorPseudo,
  creatorPseudoHash: pseudoHash(creatorPseudo).toString(),
  creatorCommitment: commitment(creatorSecret, creator, gameId).toString(),
  stakeNanoMina: stake.toString(),
  payoutMode: process.env.PAYOUT_MODE === "opponent_takes_all" ? "opponent_takes_all" : "classic",
  refundDeadlineSlot: refundDeadlineSlot.toString()
};

const indexedGame = await postIndexer("/games", {
  network,
  zkappAddress: output.zkappAddress,
  gameIdField: output.gameIdField,
  creatorPseudo,
  creatorPublicKey: output.creatorPublicKey,
  creatorPseudoHash: output.creatorPseudoHash,
  stakeNanoMina: output.stakeNanoMina,
  payoutMode: output.payoutMode,
  creatorCommitment: output.creatorCommitment,
  refundTimeoutSlots: Number(process.env.REFUND_TIMEOUT_SLOTS ?? 120),
  refundDeadlineSlot: output.refundDeadlineSlot,
  creationTxHash: output.txHash
});

logJson({ ...output, indexedGame });
