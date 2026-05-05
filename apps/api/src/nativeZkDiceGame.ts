import {
  AccountUpdate,
  Bool,
  declareMethods,
  declareState,
  Field,
  Mina,
  Permissions,
  Poseidon,
  Provable,
  PublicKey,
  SmartContract,
  State,
  UInt32,
  UInt64,
  setBackend
} from "o1js-native";
import { networks, type NetworkId } from "@zkroll/shared";

setBackend("native");

const NOT_STARTED = Field(0);
const CREATED = Field(1);
const JOINED = Field(2);
const SETTLED = Field(3);
const REFUNDED = Field(4);
const EMPTY = Field(0);

export function createNativeMinaNetwork(networkId: NetworkId): ReturnType<typeof Mina.Network> {
  const config = networks[networkId];

  return Mina.Network({
    networkId: config.networkId as Parameters<typeof Mina.Network>[0] extends { networkId?: infer T } ? T : never,
    mina: config.minaEndpoint,
    archive: config.archiveEndpoint
  });
}

export function commitmentFor(secret: Field, player: PublicKey, gameId: Field): Field {
  return Poseidon.hash([secret, ...player.toFields(), gameId]);
}

export function dieFromSecrets(firstSecret: Field, secondSecret: Field, gameId: Field, salt: Field): Field {
  const rollHash = Poseidon.hash([firstSecret, secondSecret, gameId, salt]);
  const raw = Field.fromBits(rollHash.toBits().slice(0, 3));
  return Provable.if(raw.greaterThan(5), raw.sub(6), raw).add(1);
}

export function diceOutcome(creatorSecret: Field, joinerSecret: Field, gameId: Field) {
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

function createdDataHash(input: {
  creatorPseudoHash: Field;
  creatorCommitment: Field;
  refundDeadlineSlot: UInt32;
}): Field {
  return Poseidon.hash([CREATED, input.creatorPseudoHash, input.creatorCommitment, input.refundDeadlineSlot.value]);
}

function joinedDataHash(input: {
  creatorPseudoHash: Field;
  creatorCommitment: Field;
  joinerPseudoHash: Field;
  joinerCommitment: Field;
  refundDeadlineSlot: UInt32;
}): Field {
  return Poseidon.hash([
    JOINED,
    input.creatorPseudoHash,
    input.creatorCommitment,
    input.joinerPseudoHash,
    input.joinerCommitment,
    input.refundDeadlineSlot.value
  ]);
}

function settledDataHash(input: {
  creatorPseudoHash: Field;
  creatorCommitment: Field;
  joinerPseudoHash: Field;
  joinerCommitment: Field;
  creatorDie: Field;
  joinerDie: Field;
  winner: PublicKey;
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
    input.refundDeadlineSlot.value
  ]);
}

function refundedDataHash(input: {
  previousDataHash: Field;
  refundDeadlineSlot: UInt32;
}): Field {
  return Poseidon.hash([REFUNDED, input.previousDataHash, input.refundDeadlineSlot.value]);
}

export class NativeZkDiceGame extends SmartContract {
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
    refundDeadlineSlot: UInt32
  ) {
    this.account.provedState.requireEquals(Bool(false));
    stake.assertGreaterThan(UInt64.zero);
    this.currentSlot.requireBetween(UInt32.zero, refundDeadlineSlot);

    AccountUpdate.createSigned(creator).send({ to: this.address, amount: stake });

    this.gameId.set(gameId);
    this.creator.set(creator);
    this.joiner.set(PublicKey.empty() as PublicKey);
    this.stake.set(stake);
    this.dataHash.set(createdDataHash({ creatorPseudoHash, creatorCommitment, refundDeadlineSlot }));
    this.status.set(CREATED);
  }

  async joinGame(
    joiner: PublicKey,
    creatorPseudoHash: Field,
    creatorCommitment: Field,
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
    dataHash.assertEquals(
      createdDataHash({
        creatorPseudoHash,
        creatorCommitment,
        refundDeadlineSlot: currentRefundDeadlineSlot
      })
    );
    joiner.equals(creator).assertFalse();
    this.currentSlot.requireBetween(UInt32.zero, currentRefundDeadlineSlot);
    nextRefundDeadlineSlot.assertGreaterThan(currentRefundDeadlineSlot);

    AccountUpdate.createSigned(joiner).send({ to: this.address, amount: stake });

    this.joiner.set(joiner);
    this.dataHash.set(
      joinedDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
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
    refundDeadlineSlot: UInt32
  ) {
    const status = this.status.getAndRequireEquals();
    const gameId = this.gameId.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const joiner = this.joiner.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();

    status.assertEquals(JOINED);
    dataHash.assertEquals(
      joinedDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
        refundDeadlineSlot
      })
    );
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

    this.dataHash.set(
      settledDataHash({
        creatorPseudoHash,
        creatorCommitment,
        joinerPseudoHash,
        joinerCommitment,
        creatorDie: outcome.creatorDie,
        joinerDie: outcome.joinerDie,
        winner: expectedWinner,
        refundDeadlineSlot
      })
    );
    this.status.set(SETTLED);
  }

  async refundCreatedGame(creatorPseudoHash: Field, creatorCommitment: Field, refundDeadlineSlot: UInt32) {
    const status = this.status.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();
    const currentDataHash = createdDataHash({ creatorPseudoHash, creatorCommitment, refundDeadlineSlot });

    status.assertEquals(CREATED);
    dataHash.assertEquals(currentDataHash);
    stake.assertGreaterThan(UInt64.zero);
    this.currentSlot.requireBetween(refundDeadlineSlot, UInt32.MAXINT());

    this.send({ to: creator, amount: stake });
    this.dataHash.set(refundedDataHash({ previousDataHash: currentDataHash, refundDeadlineSlot }));
    this.status.set(REFUNDED);
  }

  async cancelCreatedGame(creatorPseudoHash: Field, creatorCommitment: Field, refundDeadlineSlot: UInt32) {
    const status = this.status.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();
    const currentDataHash = createdDataHash({ creatorPseudoHash, creatorCommitment, refundDeadlineSlot });

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
    refundDeadlineSlot: UInt32
  ) {
    const status = this.status.getAndRequireEquals();
    const creator = this.creator.getAndRequireEquals();
    const joiner = this.joiner.getAndRequireEquals();
    const stake = this.stake.getAndRequireEquals();
    const dataHash = this.dataHash.getAndRequireEquals();
    const currentDataHash = joinedDataHash({
      creatorPseudoHash,
      creatorCommitment,
      joinerPseudoHash,
      joinerCommitment,
      refundDeadlineSlot
    });

    status.assertEquals(JOINED);
    dataHash.assertEquals(currentDataHash);
    stake.assertGreaterThan(UInt64.zero);
    this.currentSlot.requireBetween(refundDeadlineSlot, UInt32.MAXINT());

    this.send({ to: creator, amount: stake });
    this.send({ to: joiner, amount: stake });
    this.dataHash.set(refundedDataHash({ previousDataHash: currentDataHash, refundDeadlineSlot }));
    this.status.set(REFUNDED);
  }
}

declareState(NativeZkDiceGame, {
  gameId: Field,
  status: Field,
  creator: PublicKey,
  joiner: PublicKey,
  stake: UInt64,
  dataHash: Field
});

declareMethods(NativeZkDiceGame, {
  createGame: [Field, PublicKey, Field, UInt64, Field, UInt32] as any,
  joinGame: [PublicKey, Field, Field, UInt32, Field, Field, UInt32] as any,
  settle: [Field, Field, Field, Field, Field, Field, PublicKey, UInt32] as any,
  refundCreatedGame: [Field, Field, UInt32] as any,
  cancelCreatedGame: [Field, Field, UInt32] as any,
  refundJoinedGame: [Field, Field, Field, Field, UInt32] as any
});
