import { Card, Player } from './game.types';
export declare const MAX_SCORE = 15;
export declare const HAND_SIZE = 9;
export declare const MAX_PLAYERS = 6;
export declare const MIN_PLAYERS = 2;
export declare function createDeck(colorCount: number): Card[];
export declare function shuffle<T>(items: T[]): T[];
export declare function computePlayValue(cards: Card[]): number;
export declare function isSameColor(cards: Card[]): boolean;
export declare function isSameValue(cards: Card[]): boolean;
export declare function isValidCombo(cards: Card[]): boolean;
export declare function hasMonoColorOrValue(hand: Card[]): boolean;
export declare function removeCardsFromHand(hand: Card[], cardIds: string[]): {
    nextHand: Card[];
    removed: Card[];
};
export declare function getNextPlayerId(players: Player[], currentId: string): string;
export declare function dealHand(deck: Card[], count: number): {
    hand: Card[];
    rest: Card[];
};
export declare function hasUniqueCardIds(cardIds: string[]): boolean;
