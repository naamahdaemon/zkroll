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
  UInt32,
  UInt64
} from "o1js";
import { commitmentFor, diceOutcome } from "./dice.js";

export const EMPTY: Field = Field(0);
export const EMPTY_ROOT: Field = new MerkleMap().getRoot();
export const CREATED: Field = Field(1);
export const JOINED: Field = Field(2);
export const SETTLED: Field = Field(3);
export const REFUNDED: Field = Field(4);

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
  refundDeadlineSlot: UInt32;
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
    ...input.winner.toFields(),
    input.refundDeadlineSlot.value
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
    creatorCommitment: Field,
    refundDeadlineSlot: UInt32
  ) {
    const root = this.gamesRoot.getAndRequireEquals();
    const [emptyRoot, key] = rootAndKey(witness, EMPTY);
    emptyRoot.assertEquals(root);
    key.assertEquals(gameId);
    stake.assertGreaterThan(UInt64.zero);
    this.currentSlot.requireBetween(UInt32.zero, refundDeadlineSlot);

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
      winner: PublicKey.empty() as PublicKey,
      refundDeadlineSlot
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
    joinerCommitment: Field,
    currentRefundDeadlineSlot: UInt32,
    nextRefundDeadlineSlot: UInt32
  ) {
    const root = this.gamesRoot.getAndRequireEquals();
    joiner.equals(creator).assertFalse();
    this.currentSlot.requireBetween(UInt32.zero, currentRefundDeadlineSlot);

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
      winner: PublicKey.empty() as PublicKey,
      refundDeadlineSlot: currentRefundDeadlineSlot
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
      winner: PublicKey.empty() as PublicKey,
      refundDeadlineSlot: nextRefundDeadlineSlot
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
    expectedWinner: PublicKey,
    refundDeadlineSlot: UInt32
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
      winner: PublicKey.empty() as PublicKey,
      refundDeadlineSlot
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
      winner: expectedWinner,
      refundDeadlineSlot
    });
    const [nextRoot] = rootAndKey(witness, nextLeaf);
    this.gamesRoot.set(nextRoot);
  }

  async refundCreatedGame(
    gameId: Field,
    witness: MerkleMapWitness,
    creator: PublicKey,
    creatorPseudoHash: Field,
    stake: UInt64,
    creatorCommitment: Field,
    refundDeadlineSlot: UInt32
  ) {
    const root = this.gamesRoot.getAndRequireEquals();
    stake.assertGreaterThan(UInt64.zero);
    this.currentSlot.requireBetween(refundDeadlineSlot, UInt32.MAXINT());

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
      winner: PublicKey.empty() as PublicKey,
      refundDeadlineSlot
    });
    const [currentRoot, key] = rootAndKey(witness, currentLeaf);
    currentRoot.assertEquals(root);
    key.assertEquals(gameId);

    this.send({ to: creator, amount: stake });

    const nextLeaf = gameLeaf({
      status: REFUNDED,
      creator,
      creatorPseudoHash,
      joiner: PublicKey.empty() as PublicKey,
      joinerPseudoHash: EMPTY,
      stake,
      creatorCommitment,
      joinerCommitment: EMPTY,
      creatorDie: EMPTY,
      joinerDie: EMPTY,
      winner: PublicKey.empty() as PublicKey,
      refundDeadlineSlot
    });
    const [nextRoot] = rootAndKey(witness, nextLeaf);
    this.gamesRoot.set(nextRoot);
  }

  async refundJoinedGame(
    gameId: Field,
    witness: MerkleMapWitness,
    creator: PublicKey,
    creatorPseudoHash: Field,
    joiner: PublicKey,
    joinerPseudoHash: Field,
    stake: UInt64,
    creatorCommitment: Field,
    joinerCommitment: Field,
    refundDeadlineSlot: UInt32
  ) {
    const root = this.gamesRoot.getAndRequireEquals();
    stake.assertGreaterThan(UInt64.zero);
    this.currentSlot.requireBetween(refundDeadlineSlot, UInt32.MAXINT());

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
      winner: PublicKey.empty() as PublicKey,
      refundDeadlineSlot
    });
    const [currentRoot, key] = rootAndKey(witness, currentLeaf);
    currentRoot.assertEquals(root);
    key.assertEquals(gameId);

    this.send({ to: creator, amount: stake });
    this.send({ to: joiner, amount: stake });

    const nextLeaf = gameLeaf({
      status: REFUNDED,
      creator,
      creatorPseudoHash,
      joiner,
      joinerPseudoHash,
      stake,
      creatorCommitment,
      joinerCommitment,
      creatorDie: EMPTY,
      joinerDie: EMPTY,
      winner: PublicKey.empty() as PublicKey,
      refundDeadlineSlot
    });
    const [nextRoot] = rootAndKey(witness, nextLeaf);
    this.gamesRoot.set(nextRoot);
  }
}

declareState(ZkRoll, {
  gamesRoot: Field
});

declareMethods(ZkRoll, {
  createGame: [Field, MerkleMapWitness, PublicKey, Field, UInt64, Field, UInt32] as any,
  joinGame: [Field, MerkleMapWitness, PublicKey, Field, UInt64, Field, PublicKey, Field, Field, UInt32, UInt32] as any,
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
    PublicKey,
    UInt32
  ] as any,
  refundCreatedGame: [Field, MerkleMapWitness, PublicKey, Field, UInt64, Field, UInt32] as any,
  refundJoinedGame: [Field, MerkleMapWitness, PublicKey, Field, PublicKey, Field, UInt64, Field, Field, UInt32] as any
});
