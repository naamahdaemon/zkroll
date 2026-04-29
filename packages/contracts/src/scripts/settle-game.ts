import { Field, Mina, PublicKey } from "o1js";
import { diceOutcome, ZkDiceGame } from "../ZkDiceGame.js";
import { logJson, postIndexer, readFee, readField, readPrivateKey, readPublicKey, useNetwork } from "./env.js";

const network = useNetwork();
const feePayerKey = readPrivateKey("FEE_PAYER_PRIVATE_KEY");
const feePayer = feePayerKey.toPublicKey();
const zkappAddress = readPublicKey("ZKAPP_ADDRESS");
const creator = readPublicKey("CREATOR_PUBLIC_KEY");
const joiner = readPublicKey("JOINER_PUBLIC_KEY");
const creatorSecret = Field(process.env.CREATOR_SECRET ?? readField("CREATOR_SECRET").toString());
const joinerSecret = Field(process.env.JOINER_SECRET ?? readField("JOINER_SECRET").toString());
const gameId = readField("GAME_ID_FIELD");
const outcome = diceOutcome(creatorSecret, joinerSecret, gameId);
const creatorDie = Number(outcome.creatorDie.toString());
const joinerDie = Number(outcome.joinerDie.toString());
const expectedWinner =
  creatorDie > joinerDie ? creator : joinerDie > creatorDie ? joiner : (PublicKey.empty() as PublicKey);
const zkapp = new ZkDiceGame(zkappAddress);

console.log("Compiling ZkDiceGame...");
await ZkDiceGame.compile();

console.log("Building settle transaction...");
const tx = await Mina.transaction({ sender: feePayer, fee: readFee() }, async () => {
  await zkapp.settle(creatorSecret, joinerSecret, expectedWinner);
});

await tx.prove();
tx.sign([feePayerKey]);
const pending = await tx.send();

const output = {
  network,
  txHash: pending.hash,
  zkappAddress: zkappAddress.toBase58(),
  gameIdField: gameId.toString(),
  creatorDie,
  joinerDie,
  winnerPublicKey: expectedWinner.isEmpty().toBoolean() ? null : expectedWinner.toBase58()
};

const backendGameId = process.env.BACKEND_GAME_ID;
const indexedGame = backendGameId
  ? await postIndexer(`/games/${backendGameId}/settle`, {
      creatorDie,
      joinerDie,
      winnerPublicKey: output.winnerPublicKey,
      settlementTxHash: output.txHash
    })
  : null;

logJson({ ...output, indexedGame });
