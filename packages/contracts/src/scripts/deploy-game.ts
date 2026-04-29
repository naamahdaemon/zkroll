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
const gameId = process.env.GAME_ID_FIELD ? Field(process.env.GAME_ID_FIELD) : gameIdFromZkapp(zkappAddress);
const zkapp = new ZkDiceGame(zkappAddress);

console.log("Compiling ZkDiceGame...");
const { verificationKey } = await ZkDiceGame.compile();

console.log("Building deploy + createGame transaction...");
const tx = await Mina.transaction({ sender: feePayer, fee: readFee() }, async () => {
  AccountUpdate.fundNewAccount(feePayer);
  await zkapp.deploy({ verificationKey });
  await zkapp.createGame(gameId, creator, pseudoHash(creatorPseudo), stake, commitment(creatorSecret, creator, gameId));
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
  stakeNanoMina: stake.toString()
};

const indexedGame = await postIndexer("/games", {
  network,
  zkappAddress: output.zkappAddress,
  gameIdField: output.gameIdField,
  creatorPseudo,
  creatorPublicKey: output.creatorPublicKey,
  creatorPseudoHash: output.creatorPseudoHash,
  stakeNanoMina: output.stakeNanoMina,
  creatorCommitment: output.creatorCommitment,
  creationTxHash: output.txHash
});

logJson({ ...output, indexedGame });
