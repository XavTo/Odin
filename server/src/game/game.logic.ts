import { Card, CardColor, Player } from './game.types';

const COLORS: CardColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'orange',
  'black',
];

export const MAX_SCORE = 15;
export const HAND_SIZE = 9;
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;

export function createDeck(colorCount: number): Card[] {
  const deck: Card[] = [];
  const resolvedCount = Math.max(1, Math.min(COLORS.length, colorCount));
  const selectedColors = COLORS.slice(0, resolvedCount);
  for (const color of selectedColors) {
    for (let value = 1; value <= 9; value += 1) {
      deck.push({ id: `${color}-${value}`, color, value });
    }
  }
  return deck;
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function computePlayValue(cards: Card[]): number {
  const digits = cards
    .map((card) => card.value)
    .sort((a, b) => b - a)
    .join('');
  return Number(digits);
}

export function isSameColor(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  const color = cards[0].color;
  return cards.every((card) => card.color === color);
}

export function isSameValue(cards: Card[]): boolean {
  if (cards.length === 0) return false;
  const value = cards[0].value;
  return cards.every((card) => card.value === value);
}

export function isValidCombo(cards: Card[]): boolean {
  if (cards.length <= 1) return true;
  return isSameColor(cards) || isSameValue(cards);
}

export function hasMonoColorOrValue(hand: Card[]): boolean {
  if (hand.length === 0) return false;
  const first = hand[0];
  const sameColor = hand.every((card) => card.color === first.color);
  const sameValue = hand.every((card) => card.value === first.value);
  return sameColor || sameValue;
}

export function removeCardsFromHand(hand: Card[], cardIds: string[]): {
  nextHand: Card[];
  removed: Card[];
} {
  const remaining: Card[] = [];
  const removed: Card[] = [];
  const lookup = new Set(cardIds);

  for (const card of hand) {
    if (lookup.has(card.id)) {
      removed.push(card);
    } else {
      remaining.push(card);
    }
  }

  return { nextHand: remaining, removed };
}

export function getNextPlayerId(players: Player[], currentId: string): string {
  const index = players.findIndex((player) => player.id === currentId);
  if (index === -1) {
    return players[0]?.id ?? '';
  }
  const nextIndex = (index + 1) % players.length;
  return players[nextIndex].id;
}

export function dealHand(deck: Card[], count: number): { hand: Card[]; rest: Card[] } {
  const hand = deck.slice(0, count);
  const rest = deck.slice(count);
  return { hand, rest };
}

export function hasUniqueCardIds(cardIds: string[]): boolean {
  return new Set(cardIds).size === cardIds.length;
}
