import { AccountUpdate, Mina } from "o1js";
import { ZkRoll } from "../ZkRoll.js";
import { logJson, readFee, readPrivateKey, useNetwork } from "./env.js";

const network = useNetwork();
const feePayerKey = readPrivateKey("FEE_PAYER_PRIVATE_KEY");
const zkappKey = readPrivateKey("ZKAPP_PRIVATE_KEY");
const feePayer = feePayerKey.toPublicKey();
const zkappAddress = zkappKey.toPublicKey();
const zkapp = new ZkRoll(zkappAddress);

console.log("Compiling ZkRoll...");
const { verificationKey } = await ZkRoll.compile();

console.log("Building global contract deployment transaction...");
const tx = await Mina.transaction({ sender: feePayer, fee: readFee() }, async () => {
  AccountUpdate.fundNewAccount(feePayer);
  await zkapp.deploy({ verificationKey });
});

await tx.prove();
tx.sign([feePayerKey, zkappKey]);

console.log("GraphQL deployment mutation:");
console.log(tx.toGraphqlQuery());

const pending = await tx.send();

logJson({
  network,
  txHash: pending.hash,
  zkappAddress: zkappAddress.toBase58()
});
