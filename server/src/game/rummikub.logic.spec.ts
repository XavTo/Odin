import {
  createTiles,
  meldValue,
  rackValue,
  validateBoard,
} from './rummikub.logic';
import { Card, CardColor } from './game.types';
const tile = (value: number, color: CardColor = 'red', copy = 0): Card => ({
  id: `${color}-${value}-${copy}`,
  value,
  color,
});
const joker: Card = { id: 'joker', value: 0, color: 'black', joker: true };
describe('Rummikub rules', () => {
  it('has 106 unique tiles, two of each number/color and two jokers', () => {
    const deck = createTiles();
    expect(deck).toHaveLength(106);
    expect(new Set(deck.map((t) => t.id)).size).toBe(106);
    expect(deck.filter((t) => t.joker)).toHaveLength(2);
    expect(
      deck.filter((t) => t.value === 13 && t.color === 'red'),
    ).toHaveLength(2);
  });
  it('validates groups without duplicate colors and runs without wrap', () => {
    expect(meldValue([tile(8), tile(8, 'blue'), tile(8, 'black')])).toBe(24);
    expect(meldValue([tile(8), tile(8, 'blue'), tile(8, 'red', 1)])).toBeNull();
    expect(meldValue([tile(11), tile(12), tile(13)])).toBe(36);
    expect(meldValue([tile(12), tile(13), tile(1)])).toBeNull();
    expect(meldValue([tile(4), tile(5, 'blue'), tile(6)])).toBeNull();
  });
  it('uses joker position for points and prevents a joker beyond 13 or below 1', () => {
    expect(meldValue([tile(10), joker, tile(12)])).toBe(33);
    expect(meldValue([joker, tile(11), tile(12)])).toBe(33);
    expect(meldValue([tile(12), tile(13), joker])).toBeNull();
    expect(meldValue([joker, tile(1), tile(2)])).toBeNull();
    expect(rackValue([joker, tile(5)])).toBe(35);
  });
  it('requires 30 rack points for opening and leaves inputs untouched on rejection', () => {
    const hand = [tile(8), tile(8, 'blue'), tile(8, 'black')];
    expect(() =>
      validateBoard([], hand, [hand.map((t) => t.id)], false),
    ).toThrow('30');
    expect(hand).toHaveLength(3);
    const opening = [tile(10), tile(11), tile(12)];
    expect(
      validateBoard([], opening, [opening.map((t) => t.id)], false).nextHand,
    ).toEqual([]);
  });
  it('does not allow borrowing or extending table tiles on the opening turn', () => {
    const existing = [[tile(3), tile(4), tile(5)]];
    const hand = [tile(6), tile(10), tile(11), tile(12)];
    expect(() =>
      validateBoard(
        existing,
        hand,
        [
          [...existing[0], hand[0]].map((t) => t.id),
          hand.slice(1).map((t) => t.id),
        ],
        false,
      ),
    ).toThrow('première pose');
    expect(
      validateBoard(
        existing,
        hand,
        [existing[0].map((t) => t.id), hand.slice(1).map((t) => t.id)],
        false,
      ).nextHand,
    ).toEqual([hand[0]]);
  });
  it('permits splitting a run and reusing a released joker after opening', () => {
    const existing = [[tile(3), tile(4), tile(5), joker, tile(7), tile(8)]];
    const hand = [tile(6), tile(8, 'blue'), tile(8, 'black')];
    const rows = [
      [tile(3), tile(4), tile(5)],
      [tile(6), tile(7), joker],
      [tile(8), tile(8, 'blue'), tile(8, 'black')],
    ];
    expect(
      validateBoard(
        existing,
        hand,
        rows.map((m) => m.map((t) => t.id)),
        true,
      ).nextHand,
    ).toEqual([]);
  });
  it('rejects missing, duplicated and unknown tiles, including reclaimed jokers', () => {
    const row = [tile(3), tile(4), joker],
      hand = [tile(5)];
    expect(() =>
      validateBoard([row], hand, [[tile(3).id, tile(4).id, tile(5).id]], true),
    ).toThrow('doivent y rester');
    expect(() =>
      validateBoard(
        [],
        [tile(3), tile(4), tile(5)],
        [[tile(3).id, tile(3).id, tile(5).id]],
        true,
      ),
    ).toThrow('plusieurs');
    expect(() =>
      validateBoard([], hand, [['fake', 'fake2', 'fake3']], true),
    ).toThrow('inconnue');
  });
});
