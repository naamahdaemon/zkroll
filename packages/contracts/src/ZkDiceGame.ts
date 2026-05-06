import {
  AccountUpdate,
  Bool,
  declareMethods,
  declareState,
  Field,
  Permissions,
  Poseidon,
  Provable,
  PublicKey,
  SmartContract,
  State,
  UInt32,
  UInt64
} from "o1js";
import { commitmentFor, diceOutcome, type DiceOutcome } from "./dice.js";

const NOT_STARTED = Field(0);
const CREATED = Field(1);
const JOINED = Field(2);
const SETTLED = Field(3);
const REFUNDED = Field(4);
const EMPTY = Field(0);
export const PAYOUT_CLASSIC: Field = Field(0);
export const PAYOUT_OPPONENT_TAKES_ALL: Field = Field(1);

export { commitmentFor, diceOutcome, type DiceOutcome } from "./dice.js";

export function createdDataHash(input: {
  creatorPseudoHash: Field;
  creatorCommitment: Field;
  payoutMode: Field;
  refundDeadlineSlot: UInt32;
}): Field {
  return Poseidon.hash([
    CREATED,
    input.creatorPseudoHash,
    input.creatorCommitment,
    input.payoutMode,
    input.refundDeadlineSlot.value
  ]);
}

export function joinedDataHash(input: {
  creatorPseudoHash: Field;
  creatorCommitment: Field;
  joinerPseudoHash: Field;
  joinerCommitment: Field;
  payoutMode: Field;
  refundDeadlineSlot: UInt32;
}): Field {
  return Poseidon.hash([
    JOINED,
    input.creatorPseudoHash,
    input.creatorCommitment,
    input.joinerPseudoHash,
    input.joinerCommitment,
    input.payoutMode,
    input.refundDeadlineSlot.value
  ]);
}

export function settledDataHash(input: {
  creatorPseudoHash: Field;
  creatorCommitment: Field;
  joinerPseudoHash: Field;
  joinerCommitment: Field;
  creatorDie: Field;
  joinerDie: Field;
  winner: PublicKey;
  payoutMode: Field;
  refundDeadlineSlot: UInt32;
}): Field {
  return Poseidon.hash([
    SETTLED,
    input.creatorPseudoHash,
    input.creatorCommitment,
    input.joinerPseudoHash,
    input.joinerCommitment,
    input.creatorDie,
    input.joinerDie,
    ...input.winner.toFields(),
    input.payoutMode,
    input.refundDeadlineSlot.value
  ]);
}

export function refundedDataHash(input: {
  previousDataHash: Field;
  refundDeadlineSlot: UInt32;
}): Field {
  return Poseidon.hash([REFUNDED, input.previousDataHash, input.refundDeadlineSlot.value]);
}

function assertValidPayoutMode(payoutMode: Field) {
  payoutMode.equals(PAYOUT_CLASSIC).or(payoutMode.equals(PAYOUT_OPPONENT_TAKES_ALL)).assertTrue();
}

export class ZkDiceGame extends SmartContract {
  declare gameId: State<Field>;
  declare status: State<Field>;
  declare creator: State<PublicKey>;
  declare joiner: State<PublicKey>;
  declare stake: State<UInt64>;
  declare dataHash: State<Field>;

  constructor(address: PublicKey, tokenId?: Field) {
    super(address, tokenId);
    this.gameId = State<Field>();
    this.status = State<Field>();
    this.creator = State<PublicKey>();
    this.joiner = State<PublicKey>();
    this.stake = State<UInt64>();
    this.dataHash = State<Field>();
  }

  init() {
    super.init();
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
      send: Permissions.proof()
    });
    this.status.set(NOT_STARTED);
    this.stake.set(UInt64.zero);
    this.dataHash.set(EMPTY);
  }

  async createGame(
    gameId: Field,
    creator: PublicKey,
    creatorPseudoHash: Field,
    stake: UInt64,
    creatorCommitment: Field,
    payoutMode: Field,
    refundDeadlineSlot: UInt32
  ) {
    this.account.provedState.requireEquals(Bool(false));
    stake.assertGreaterThan(UInt64.zero);
    assertValidPayoutMode(payoutMode);
    this.currentSlot.requireBetween(UInt32.zero, refundDeadlineSlot);

    AccountUpdate.createSigned(creator).send({ to: this.address, amount: stake });

    this.gameId.set(gameId);
    this.creator.set(creator);
    this.joiner.set(PublicKey.empty() as PublicKey);
    this.stake.set(stake);
    this.dataHash.set(createdDataHash({ creatorPseudoHash, creatorCommitment, payoutMode, refundDeadlineSlot }));
    this.status.set(CREATED);
  }

  async joinGame(
    joiner: PublicKey,
    creatorPseudoHash: Field,
    creatorCommitment: Field,
    payoutMode: Field,
    currentRefundDeadlineSlot: UInt32,
    joinerPseudoHash: Field,
    joinerCommitment: Field,
    nextRefundDeadlineSlot: UInt32
  ) {
    const status = this.status.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();

    status.assertEquals(CREATED);
    assertValidPayoutMode(payoutMode);
    dataHash.assertEquals(
      createdDataHash({
        creatorPseudoHash,
        creatorCommitment,
        payoutMode,
        refundDeadlineSlot: currentRefundDeadlineSlot
      })
    );
    joiner.equals(creator).assertFalse();
    this.currentSlot.requireBetween(UInt32.zero, currentRefundDeadlineSlot);
    nextRefundDeadlineSlot.assertGreaterThan(currentRefundDeadlineSlot);

    const joinerUpdate = AccountUpdate.createSigned(joiner);
    const opponentTakesAll = payoutMode.equals(PAYOUT_OPPONENT_TAKES_ALL);
    joinerUpdate.send({ to: this.address, amount: Provable.if(opponentTakesAll, UInt64, UInt64.zero, stake) });

    this.joiner.set(joiner);
    this.dataHash.set(
      joinedDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
        payoutMode,
        refundDeadlineSlot: nextRefundDeadlineSlot
      })
    );
    this.status.set(JOINED);
  }

  async settle(
    creatorPseudoHash: Field,
    joinerPseudoHash: Field,
    creatorCommitment: Field,
    joinerCommitment: Field,
    creatorSecret: Field,
    joinerSecret: Field,
    expectedWinner: PublicKey,
    payoutMode: Field,
    refundDeadlineSlot: UInt32
  ) {
    const status = this.status.getAndRequireEquals();
    const gameId = this.gameId.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const joiner = this.joiner.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();

    status.assertEquals(JOINED);
    assertValidPayoutMode(payoutMode);
    dataHash.assertEquals(
      joinedDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
        payoutMode,
        refundDeadlineSlot
      })
    );
    commitmentFor(creatorSecret, creator, gameId).assertEquals(creatorCommitment);
    commitmentFor(joinerSecret, joiner, gameId).assertEquals(joinerCommitment);

    const outcome = diceOutcome(creatorSecret, joinerSecret, gameId);
    const classicPot = stake.add(stake);
    const empty = PublicKey.empty() as PublicKey;

    expectedWinner.equals(creator).assertEquals(outcome.creatorWins);
    expectedWinner.equals(joiner).assertEquals(outcome.joinerWins);
    expectedWinner.equals(empty).assertEquals(outcome.draw);

    const classicCreatorPayout = Provable.if(outcome.creatorWins, UInt64, classicPot, stake);
    const classicJoinerPayout = Provable.if(outcome.joinerWins, UInt64, classicPot, stake);
    const classicCreatorSend = Provable.if(outcome.joinerWins, UInt64, UInt64.zero, classicCreatorPayout);
    const classicJoinerSend = Provable.if(outcome.creatorWins, UInt64, UInt64.zero, classicJoinerPayout);
    const opponentTakesAll = payoutMode.equals(PAYOUT_OPPONENT_TAKES_ALL);
    const opponentCreatorSend = Provable.if(outcome.joinerWins, UInt64, UInt64.zero, stake);
    const opponentJoinerSend = Provable.if(outcome.joinerWins, UInt64, stake, UInt64.zero);
    this.send({ to: creator, amount: Provable.if(opponentTakesAll, UInt64, opponentCreatorSend, classicCreatorSend) });
    this.send({ to: joiner, amount: Provable.if(opponentTakesAll, UInt64, opponentJoinerSend, classicJoinerSend) });

    this.dataHash.set(
      settledDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
        creatorDie: outcome.creatorDie,
        joinerDie: outcome.joinerDie,
        winner: expectedWinner,
        payoutMode,
        refundDeadlineSlot
      })
    );
    this.status.set(SETTLED);
  }

  async settleOpponentJoinerWins(
    creatorPseudoHash: Field,
    joinerPseudoHash: Field,
    creatorCommitment: Field,
    joinerCommitment: Field,
    creatorSecret: Field,
    joinerSecret: Field,
    expectedWinner: PublicKey,
    refundDeadlineSlot: UInt32
  ) {
    const status = this.status.getAndRequireEquals();
    const gameId = this.gameId.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const joiner = this.joiner.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();
    const payoutMode = PAYOUT_OPPONENT_TAKES_ALL;

    status.assertEquals(JOINED);
    dataHash.assertEquals(
      joinedDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
        payoutMode,
        refundDeadlineSlot
      })
    );
    commitmentFor(creatorSecret, creator, gameId).assertEquals(creatorCommitment);
    commitmentFor(joinerSecret, joiner, gameId).assertEquals(joinerCommitment);

    const outcome = diceOutcome(creatorSecret, joinerSecret, gameId);
    outcome.joinerWins.assertTrue();
    expectedWinner.equals(joiner).assertTrue();

    this.send({ to: joiner, amount: stake });
    this.dataHash.set(
      settledDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
        creatorDie: outcome.creatorDie,
        joinerDie: outcome.joinerDie,
        winner: expectedWinner,
        payoutMode,
        refundDeadlineSlot
      })
    );
    this.status.set(SETTLED);
  }

  async settleOpponentCreatorKeeps(
    creatorPseudoHash: Field,
    joinerPseudoHash: Field,
    creatorCommitment: Field,
    joinerCommitment: Field,
    creatorSecret: Field,
    joinerSecret: Field,
    expectedWinner: PublicKey,
    refundDeadlineSlot: UInt32
  ) {
    const status = this.status.getAndRequireEquals();
    const gameId = this.gameId.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const joiner = this.joiner.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();
    const payoutMode = PAYOUT_OPPONENT_TAKES_ALL;

    status.assertEquals(JOINED);
    dataHash.assertEquals(
      joinedDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
        payoutMode,
        refundDeadlineSlot
      })
    );
    commitmentFor(creatorSecret, creator, gameId).assertEquals(creatorCommitment);
    commitmentFor(joinerSecret, joiner, gameId).assertEquals(joinerCommitment);

    const outcome = diceOutcome(creatorSecret, joinerSecret, gameId);
    const empty = PublicKey.empty() as PublicKey;
    outcome.joinerWins.assertFalse();
    expectedWinner.equals(creator).assertEquals(outcome.creatorWins);
    expectedWinner.equals(empty).assertEquals(outcome.draw);

    this.send({ to: creator, amount: stake });
    this.dataHash.set(
      settledDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
        creatorDie: outcome.creatorDie,
        joinerDie: outcome.joinerDie,
        winner: expectedWinner,
        payoutMode,
        refundDeadlineSlot
      })
    );
    this.status.set(SETTLED);
  }

  async refundCreatedGame(creatorPseudoHash: Field, creatorCommitment: Field, payoutMode: Field, refundDeadlineSlot: UInt32) {
    const status = this.status.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();
    assertValidPayoutMode(payoutMode);
    const currentDataHash = createdDataHash({ creatorPseudoHash, creatorCommitment, payoutMode, refundDeadlineSlot });

    status.assertEquals(CREATED);
    dataHash.assertEquals(currentDataHash);
    stake.assertGreaterThan(UInt64.zero);
    this.currentSlot.requireBetween(refundDeadlineSlot, UInt32.MAXINT());

    this.send({ to: creator, amount: stake });
    this.dataHash.set(refundedDataHash({ previousDataHash: currentDataHash, refundDeadlineSlot }));
    this.status.set(REFUNDED);
  }

  async cancelCreatedGame(creatorPseudoHash: Field, creatorCommitment: Field, payoutMode: Field, refundDeadlineSlot: UInt32) {
    const status = this.status.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();
    assertValidPayoutMode(payoutMode);
    const currentDataHash = createdDataHash({ creatorPseudoHash, creatorCommitment, payoutMode, refundDeadlineSlot });

    status.assertEquals(CREATED);
    dataHash.assertEquals(currentDataHash);
    stake.assertGreaterThan(UInt64.zero);
    AccountUpdate.createSigned(creator);

    this.send({ to: creator, amount: stake });
    this.dataHash.set(refundedDataHash({ previousDataHash: currentDataHash, refundDeadlineSlot }));
    this.status.set(REFUNDED);
  }

  async refundJoinedGame(
    creatorPseudoHash: Field,
    joinerPseudoHash: Field,
    creatorCommitment: Field,
    joinerCommitment: Field,
    payoutMode: Field,
    refundDeadlineSlot: UInt32
  ) {
    const status = this.status.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const joiner = this.joiner.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();
    assertValidPayoutMode(payoutMode);
    const currentDataHash = joinedDataHash({
      creatorPseudoHash,
      creatorCommitment,
      joinerPseudoHash,
      joinerCommitment,
      payoutMode,
      refundDeadlineSlot
    });

    status.assertEquals(JOINED);
    dataHash.assertEquals(currentDataHash);
    stake.assertGreaterThan(UInt64.zero);
    this.currentSlot.requireBetween(refundDeadlineSlot, UInt32.MAXINT());

    const opponentTakesAll = payoutMode.equals(PAYOUT_OPPONENT_TAKES_ALL);
    this.send({ to: creator, amount: stake });
    this.send({ to: joiner, amount: Provable.if(opponentTakesAll, UInt64, UInt64.zero, stake) });
    this.dataHash.set(refundedDataHash({ previousDataHash: currentDataHash, refundDeadlineSlot }));
    this.status.set(REFUNDED);
  }
}

declareState(ZkDiceGame, {
  gameId: Field,
  status: Field,
  creator: PublicKey,
  joiner: PublicKey,
  stake: UInt64,
  dataHash: Field
});

declareMethods(ZkDiceGame, {
  createGame: [Field, PublicKey, Field, UInt64, Field, Field, UInt32] as any,
  joinGame: [PublicKey, Field, Field, Field, UInt32, Field, Field, UInt32] as any,
  settle: [Field, Field, Field, Field, Field, Field, PublicKey, Field, UInt32] as any,
  settleOpponentJoinerWins: [Field, Field, Field, Field, Field, Field, PublicKey, UInt32] as any,
  settleOpponentCreatorKeeps: [Field, Field, Field, Field, Field, Field, PublicKey, UInt32] as any,
  refundCreatedGame: [Field, Field, Field, UInt32] as any,
  cancelCreatedGame: [Field, Field, Field, UInt32] as any,
  refundJoinedGame: [Field, Field, Field, Field, Field, UInt32] as any
});
