"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_PLAYERS = exports.MAX_PLAYERS = exports.HAND_SIZE = exports.MAX_SCORE = void 0;
exports.createDeck = createDeck;
exports.shuffle = shuffle;
exports.computePlayValue = computePlayValue;
exports.isSameColor = isSameColor;
exports.isSameValue = isSameValue;
exports.isValidCombo = isValidCombo;
exports.hasMonoColorOrValue = hasMonoColorOrValue;
exports.removeCardsFromHand = removeCardsFromHand;
exports.getNextPlayerId = getNextPlayerId;
exports.dealHand = dealHand;
exports.hasUniqueCardIds = hasUniqueCardIds;
const COLORS = [
    'red',
    'blue',
    'green',
    'yellow',
    'orange',
    'black',
];
exports.MAX_SCORE = 15;
exports.HAND_SIZE = 9;
exports.MAX_PLAYERS = 6;
exports.MIN_PLAYERS = 2;
function createDeck(colorCount) {
    const deck = [];
    const resolvedCount = Math.max(1, Math.min(COLORS.length, colorCount));
    const selectedColors = COLORS.slice(0, resolvedCount);
    for (const color of selectedColors) {
        for (let value = 1; value <= 9; value += 1) {
            deck.push({ id: `${color}-${value}`, color, value });
        }
    }
    return deck;
}
function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
function computePlayValue(cards) {
    const digits = cards
        .map((card) => card.value)
        .sort((a, b) => b - a)
        .join('');
    return Number(digits);
}
function isSameColor(cards) {
    if (cards.length === 0)
        return false;
    const color = cards[0].color;
    return cards.every((card) => card.color === color);
}
function isSameValue(cards) {
    if (cards.length === 0)
        return false;
    const value = cards[0].value;
    return cards.every((card) => card.value === value);
}
function isValidCombo(cards) {
    if (cards.length <= 1)
        return true;
    return isSameColor(cards) || isSameValue(cards);
}
function hasMonoColorOrValue(hand) {
    if (hand.length === 0)
        return false;
    const first = hand[0];
    const sameColor = hand.every((card) => card.color === first.color);
    const sameValue = hand.every((card) => card.value === first.value);
    return sameColor || sameValue;
}
function removeCardsFromHand(hand, cardIds) {
    const remaining = [];
    const removed = [];
    const lookup = new Set(cardIds);
    for (const card of hand) {
        if (lookup.has(card.id)) {
            removed.push(card);
        }
        else {
            remaining.push(card);
        }
    }
    return { nextHand: remaining, removed };
}
function getNextPlayerId(players, currentId) {
    const index = players.findIndex((player) => player.id === currentId);
    if (index === -1) {
        return players[0]?.id ?? '';
    }
    const nextIndex = (index + 1) % players.length;
    return players[nextIndex].id;
}
function dealHand(deck, count) {
    const hand = deck.slice(0, count);
    const rest = deck.slice(count);
    return { hand, rest };
}
function hasUniqueCardIds(cardIds) {
    return new Set(cardIds).size === cardIds.length;
}
//# sourceMappingURL=game.logic.js.map