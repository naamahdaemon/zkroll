import {
  AccountUpdate,
  declareMethods,
  declareState,
  Field,
  MerkleMap,
  MerkleMapWitness,
  Permissions,
  Poseidon,
  Provable,
  PublicKey,
  SmartContract,
  State,
  UInt64
} from "o1js";
import { commitmentFor, diceOutcome } from "./dice.js";

export const EMPTY: Field = Field(0);
export const EMPTY_ROOT: Field = new MerkleMap().getRoot();
export const CREATED: Field = Field(1);
export const JOINED: Field = Field(2);
export const SETTLED: Field = Field(3);

export function gameLeaf(input: {
  status: Field;
  creator: PublicKey;
  creatorPseudoHash: Field;
  joiner: PublicKey;
  joinerPseudoHash: Field;
  stake: UInt64;
  creatorCommitment: Field;
  joinerCommitment: Field;
  creatorDie: Field;
  joinerDie: Field;
  winner: PublicKey;
}): Field {
  return Poseidon.hash([
    input.status,
    ...input.creator.toFields(),
    input.creatorPseudoHash,
    ...input.joiner.toFields(),
    input.joinerPseudoHash,
    input.stake.value,
    input.creatorCommitment,
    input.joinerCommitment,
    input.creatorDie,
    input.joinerDie,
    ...input.winner.toFields()
  ]);
}

function rootAndKey(witness: MerkleMapWitness, value: Field): [Field, Field] {
  return witness.computeRootAndKey(value) as [Field, Field];
}

export class ZkRoll extends SmartContract {
  declare gamesRoot: State<Field>;

  constructor(address: PublicKey, tokenId?: Field) {
    super(address, tokenId);
    this.gamesRoot = State<Field>();
  }

  init() {
    super.init();
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
      send: Permissions.proof()
    });
    this.gamesRoot.set(EMPTY_ROOT);
  }

  async createGame(
    gameId: Field,
    witness: MerkleMapWitness,
    creator: PublicKey,
    creatorPseudoHash: Field,
    stake: UInt64,
    creatorCommitment: Field
  ) {
    const root = this.gamesRoot.getAndRequireEquals();
    const [emptyRoot, key] = rootAndKey(witness, EMPTY);
    emptyRoot.assertEquals(root);
    key.assertEquals(gameId);
    stake.assertGreaterThan(UInt64.zero);

    AccountUpdate.createSigned(creator).send({ to: this.address, amount: stake });

    const nextLeaf = gameLeaf({
      status: CREATED,
      creator,
      creatorPseudoHash,
      joiner: PublicKey.empty() as PublicKey,
      joinerPseudoHash: EMPTY,
      stake,
      creatorCommitment,
      joinerCommitment: EMPTY,
      creatorDie: EMPTY,
      joinerDie: EMPTY,
      winner: PublicKey.empty() as PublicKey
    });
    const [nextRoot] = rootAndKey(witness, nextLeaf);
    this.gamesRoot.set(nextRoot);
  }

  async joinGame(
    gameId: Field,
    witness: MerkleMapWitness,
    creator: PublicKey,
    creatorPseudoHash: Field,
    stake: UInt64,
    creatorCommitment: Field,
    joiner: PublicKey,
    joinerPseudoHash: Field,
    joinerCommitment: Field
  ) {
    const root = this.gamesRoot.getAndRequireEquals();
    joiner.equals(creator).assertFalse();

    const currentLeaf = gameLeaf({
      status: CREATED,
      creator,
      creatorPseudoHash,
      joiner: PublicKey.empty() as PublicKey,
      joinerPseudoHash: EMPTY,
      stake,
      creatorCommitment,
      joinerCommitment: EMPTY,
      creatorDie: EMPTY,
      joinerDie: EMPTY,
      winner: PublicKey.empty() as PublicKey
    });
    const [currentRoot, key] = rootAndKey(witness, currentLeaf);
    currentRoot.assertEquals(root);
    key.assertEquals(gameId);

    AccountUpdate.createSigned(joiner).send({ to: this.address, amount: stake });

    const nextLeaf = gameLeaf({
      status: JOINED,
      creator,
      creatorPseudoHash,
      joiner,
      joinerPseudoHash,
      stake,
      creatorCommitment,
      joinerCommitment,
      creatorDie: EMPTY,
      joinerDie: EMPTY,
      winner: PublicKey.empty() as PublicKey
    });
    const [nextRoot] = rootAndKey(witness, nextLeaf);
    this.gamesRoot.set(nextRoot);
  }

  async settleGame(
    gameId: Field,
    witness: MerkleMapWitness,
    creator: PublicKey,
    creatorPseudoHash: Field,
    joiner: PublicKey,
    joinerPseudoHash: Field,
    stake: UInt64,
    creatorCommitment: Field,
    joinerCommitment: Field,
    creatorSecret: Field,
    joinerSecret: Field,
    expectedWinner: PublicKey
  ) {
    const root = this.gamesRoot.getAndRequireEquals();
    const currentLeaf = gameLeaf({
      status: JOINED,
      creator,
      creatorPseudoHash,
      joiner,
      joinerPseudoHash,
      stake,
      creatorCommitment,
      joinerCommitment,
      creatorDie: EMPTY,
      joinerDie: EMPTY,
      winner: PublicKey.empty() as PublicKey
    });
    const [currentRoot, key] = rootAndKey(witness, currentLeaf);
    currentRoot.assertEquals(root);
    key.assertEquals(gameId);

    commitmentFor(creatorSecret, creator, gameId).assertEquals(creatorCommitment);
    commitmentFor(joinerSecret, joiner, gameId).assertEquals(joinerCommitment);

    const outcome = diceOutcome(creatorSecret, joinerSecret, gameId);
    const pot = stake.add(stake);
    const empty = PublicKey.empty() as PublicKey;

    expectedWinner.equals(creator).assertEquals(outcome.creatorWins);
    expectedWinner.equals(joiner).assertEquals(outcome.joinerWins);
    expectedWinner.equals(empty).assertEquals(outcome.draw);

    const creatorPayout = Provable.if(outcome.creatorWins, UInt64, pot, stake);
    const joinerPayout = Provable.if(outcome.joinerWins, UInt64, pot, stake);
    this.send({ to: creator, amount: Provable.if(outcome.joinerWins, UInt64, UInt64.zero, creatorPayout) });
    this.send({ to: joiner, amount: Provable.if(outcome.creatorWins, UInt64, UInt64.zero, joinerPayout) });

    const nextLeaf = gameLeaf({
      status: SETTLED,
      creator,
      creatorPseudoHash,
      joiner,
      joinerPseudoHash,
      stake,
      creatorCommitment,
      joinerCommitment,
      creatorDie: outcome.creatorDie,
      joinerDie: outcome.joinerDie,
      winner: expectedWinner
    });
    const [nextRoot] = rootAndKey(witness, nextLeaf);
    this.gamesRoot.set(nextRoot);
  }
}

declareState(ZkRoll, {
  gamesRoot: Field
});

declareMethods(ZkRoll, {
  createGame: [Field, MerkleMapWitness, PublicKey, Field, UInt64, Field] as any,
  joinGame: [Field, MerkleMapWitness, PublicKey, Field, UInt64, Field, PublicKey, Field, Field] as any,
  settleGame: [
    Field,
    MerkleMapWitness,
    PublicKey,
    Field,
    PublicKey,
    Field,
    UInt64,
    Field,
    Field,
    Field,
    Field,
    PublicKey
  ] as any
});
