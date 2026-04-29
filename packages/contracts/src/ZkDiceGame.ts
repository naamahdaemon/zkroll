import {
  AccountUpdate,
  Field,
  method,
  Permissions,
  Provable,
  PublicKey,
  SmartContract,
  state,
  State,
  UInt64
} from "o1js";
import { commitmentFor, diceOutcome, type DiceOutcome } from "./dice.js";

const NOT_STARTED = Field(0);
const CREATED = Field(1);
const JOINED = Field(2);
const SETTLED = Field(3);

export { commitmentFor, diceOutcome, type DiceOutcome } from "./dice.js";

export class ZkDiceGame extends SmartContract {
  @state(Field) gameId: State<Field> = State<Field>();
  @state(Field) status: State<Field> = State<Field>();
  @state(PublicKey) creator: State<PublicKey> = State<PublicKey>();
  @state(PublicKey) joiner: State<PublicKey> = State<PublicKey>();
  @state(Field) creatorPseudoHash: State<Field> = State<Field>();
  @state(Field) joinerPseudoHash: State<Field> = State<Field>();
  @state(UInt64) stake: State<UInt64> = State<UInt64>();
  @state(Field) creatorCommitment: State<Field> = State<Field>();
  @state(Field) joinerCommitment: State<Field> = State<Field>();
  @state(Field) creatorDie: State<Field> = State<Field>();
  @state(Field) joinerDie: State<Field> = State<Field>();
  @state(PublicKey) winner: State<PublicKey> = State<PublicKey>();

  init() {
    super.init();
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
      send: Permissions.proof()
    });
    this.status.set(NOT_STARTED);
    this.creatorDie.set(Field(0));
    this.joinerDie.set(Field(0));
  }

  @method async createGame(
    gameId: Field,
    creator: PublicKey,
    creatorPseudoHash: Field,
    stake: UInt64,
    creatorCommitment: Field
  ) {
    const status = this.status.getAndRequireEquals();
    status.assertEquals(NOT_STARTED);
    stake.assertGreaterThan(UInt64.zero);

    const creatorPayment = AccountUpdate.createSigned(creator);
    creatorPayment.send({ to: this.address, amount: stake });

    this.gameId.set(gameId);
    this.creator.set(creator);
    this.creatorPseudoHash.set(creatorPseudoHash);
    this.stake.set(stake);
    this.creatorCommitment.set(creatorCommitment);
    this.status.set(CREATED);
  }

  @method async joinGame(joiner: PublicKey, joinerPseudoHash: Field, joinerCommitment: Field) {
    const status = this.status.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();

    status.assertEquals(CREATED);
    joiner.equals(creator).assertFalse();

    const joinerPayment = AccountUpdate.createSigned(joiner);
    joinerPayment.send({ to: this.address, amount: stake });

    this.joiner.set(joiner);
    this.joinerPseudoHash.set(joinerPseudoHash);
    this.joinerCommitment.set(joinerCommitment);
    this.status.set(JOINED);
  }

  @method async settle(creatorSecret: Field, joinerSecret: Field, expectedWinner: PublicKey) {
    const status = this.status.getAndRequireEquals();
    const gameId = this.gameId.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const joiner = this.joiner.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const creatorCommitment = this.creatorCommitment.getAndRequireEquals();
    const joinerCommitment = this.joinerCommitment.getAndRequireEquals();

    status.assertEquals(JOINED);
    commitmentFor(creatorSecret, creator, gameId).assertEquals(creatorCommitment);
    commitmentFor(joinerSecret, joiner, gameId).assertEquals(joinerCommitment);

    const outcome = diceOutcome(creatorSecret, joinerSecret, gameId);
    const pot = stake.add(stake);
    const empty = PublicKey.empty();

    expectedWinner.equals(creator).assertEquals(outcome.creatorWins);
    expectedWinner.equals(joiner).assertEquals(outcome.joinerWins);
    expectedWinner.equals(empty).assertEquals(outcome.draw);

    const creatorPayout = Provable.if(outcome.creatorWins, UInt64, pot, stake);
    const joinerPayout = Provable.if(outcome.joinerWins, UInt64, pot, stake);
    this.send({ to: creator, amount: Provable.if(outcome.joinerWins, UInt64, UInt64.zero, creatorPayout) });
    this.send({ to: joiner, amount: Provable.if(outcome.creatorWins, UInt64, UInt64.zero, joinerPayout) });

    this.creatorDie.set(outcome.creatorDie);
    this.joinerDie.set(outcome.joinerDie);
    this.winner.set(expectedWinner);
    this.status.set(SETTLED);
  }
}
