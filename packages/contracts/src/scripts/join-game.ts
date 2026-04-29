import { Field, Mina } from "o1js";
import { ZkDiceGame } from "../ZkDiceGame.js";
import {
  commitment,
  logJson,
  postIndexer,
  pseudoHash,
  readEnv,
  readFee,
  readField,
  readPrivateKey,
  readPublicKey,
  useNetwork
} from "./env.js";

const network = useNetwork();
const feePayerKey = readPrivateKey("FEE_PAYER_PRIVATE_KEY");
const joinerKey = process.env.JOINER_PRIVATE_KEY ? readPrivateKey("JOINER_PRIVATE_KEY") : feePayerKey;
const feePayer = feePayerKey.toPublicKey();
const joiner = joinerKey.toPublicKey();
const zkappAddress = readPublicKey("ZKAPP_ADDRESS");
const joinerPseudo = readEnv("JOINER_PSEUDO");
const joinerSecret = Field(readEnv("JOINER_SECRET"));
const gameId = readField("GAME_ID_FIELD");
const zkapp = new ZkDiceGame(zkappAddress);

console.log("Compiling ZkDiceGame...");
await ZkDiceGame.compile();

console.log("Building joinGame transaction...");
const tx = await Mina.transaction({ sender: feePayer, fee: readFee() }, async () => {
  await zkapp.joinGame(joiner, pseudoHash(joinerPseudo), commitment(joinerSecret, joiner, gameId));
});

await tx.prove();
tx.sign([feePayerKey, joinerKey]);
const pending = await tx.send();

const output = {
  network,
  txHash: pending.hash,
  zkappAddress: zkappAddress.toBase58(),
  gameIdField: gameId.toString(),
  joinerPublicKey: joiner.toBase58(),
  joinerPseudo,
  joinerPseudoHash: pseudoHash(joinerPseudo).toString(),
  joinerCommitment: commitment(joinerSecret, joiner, gameId).toString()
};

const backendGameId = process.env.BACKEND_GAME_ID;
const indexedGame = backendGameId
  ? await postIndexer(`/games/${backendGameId}/join`, {
      joinerPseudo,
      joinerPublicKey: output.joinerPublicKey,
      joinerPseudoHash: output.joinerPseudoHash,
      joinerCommitment: output.joinerCommitment,
      joinTxHash: output.txHash
    })
  : null;

logJson({ ...output, indexedGame });
