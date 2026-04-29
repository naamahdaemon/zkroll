import { Bool, Field, Poseidon, Provable, PublicKey } from "o1js";

export type DiceOutcome = {
  creatorDie: Field;
  joinerDie: Field;
  creatorWins: Bool;
  joinerWins: Bool;
  draw: Bool;
};

export function commitmentFor(secret: Field, player: PublicKey, gameId: Field): Field {
  return Poseidon.hash([secret, ...player.toFields(), gameId]);
}

export function dieFromSecrets(firstSecret: Field, secondSecret: Field, gameId: Field, salt: Field): Field {
  const rollHash = Poseidon.hash([firstSecret, secondSecret, gameId, salt]);
  const raw = Field.fromBits(rollHash.toBits(3));
  return Provable.if(raw.greaterThan(5), raw.sub(6), raw).add(1);
}

export function diceOutcome(creatorSecret: Field, joinerSecret: Field, gameId: Field): DiceOutcome {
  const creatorDie = dieFromSecrets(creatorSecret, joinerSecret, gameId, Field(1));
  const joinerDie = dieFromSecrets(joinerSecret, creatorSecret, gameId, Field(2));
  const creatorWins = creatorDie.greaterThan(joinerDie);
  const joinerWins = joinerDie.greaterThan(creatorDie);

  return {
    creatorDie,
    joinerDie,
    creatorWins,
    joinerWins,
    draw: creatorWins.not().and(joinerWins.not())
  };
}
