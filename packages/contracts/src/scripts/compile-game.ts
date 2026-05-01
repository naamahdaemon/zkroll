import { ZkDiceGame } from "../ZkDiceGame.js";

console.log("Compiling ZkDiceGame...");
const { verificationKey } = await ZkDiceGame.compile();
console.log(
  JSON.stringify({
    ok: true,
    verificationKeyHash: verificationKey.hash.toString()
  })
);
