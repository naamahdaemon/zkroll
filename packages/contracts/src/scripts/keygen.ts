import { Field, PrivateKey } from "o1js";
import { logJson } from "./env.js";

const key = PrivateKey.random();
const publicKey = key.toPublicKey();

logJson({
  privateKey: key.toBase58(),
  publicKey: publicKey.toBase58(),
  randomFieldSecret: Field.random().toString()
});
