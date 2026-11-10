import { Card, CardColor } from './game.types';
export const RUMMI_COLORS: CardColor[] = ['red', 'blue', 'orange', 'black'];
export function createTiles(): Card[] {
  const tiles: Card[] = [];
  for (let copy = 0; copy < 2; copy++)
    for (const color of RUMMI_COLORS) {
      for (let value = 1; value <= 13; value++)
        tiles.push({ id: `r-${copy}-${color}-${value}`, color, value });
    }
  return [
    ...tiles,
    ...[0, 1].map((i) => ({
      id: `joker-${i}`,
      color: 'black' as const,
      value: 0,
      joker: true,
    })),
  ];
}
// Order matters for runs, including the value represented by an end joker.
export function meldValue(tiles: Card[]): number | null {
  if (tiles.length < 3 || tiles.length > 13) return null;
  const normal = tiles.filter((t) => !t.joker);
  if (!normal.length) return null;
  if (
    tiles.length <= 4 &&
    normal.every((t) => t.value === normal[0].value) &&
    new Set(normal.map((t) => t.color)).size === normal.length
  ) {
    return normal[0].value * tiles.length;
  }
  if (!normal.every((t) => t.color === normal[0].color)) return null;
  const first = tiles.findIndex((t) => !t.joker);
  const start = tiles[first].value - first;
  if (start < 1 || start + tiles.length - 1 > 13) return null;
  if (!tiles.every((t, i) => t.joker || t.value === start + i)) return null;
  return tiles.reduce((sum, _, i) => sum + start + i, 0);
}
export function rackValue(hand: Card[]): number {
  return hand.reduce((sum, tile) => sum + (tile.joker ? 30 : tile.value), 0);
}
export function validateBoard(
  existing: Card[][],
  hand: Card[],
  proposed: unknown,
  opened: boolean,
): { melds: Card[][]; nextHand: Card[] } {
  if (!Array.isArray(proposed) || proposed.length > 36)
    throw new Error('Table invalide.');
  const previous = existing.flat();
  const lookup = new Map([...previous, ...hand].map((t) => [t.id, t]));
  const used = new Set<string>();
  const melds: Card[][] = proposed.map((ids: unknown) => {
    if (!Array.isArray(ids) || ids.length < 3 || ids.length > 13)
      throw new Error('Chaque combinaison doit contenir de 3 à 13 tuiles.');
    return ids.map((id: unknown) => {
      if (typeof id !== 'string' || !lookup.has(id) || used.has(id))
        throw new Error('Tuile inconnue ou utilisée plusieurs fois.');
      used.add(id);
      return lookup.get(id)!;
    });
  });
  if (previous.some((t) => !used.has(t.id)))
    throw new Error(
      'Toutes les tuiles déjà sur la table doivent y rester, jokers compris.',
    );
  const played = hand.filter((t) => used.has(t.id));
  if (!played.length)
    throw new Error('Posez au moins une tuile de votre chevalet, ou piochez.');
  for (const [i, meld] of melds.entries())
    if (meldValue(meld) === null)
      throw new Error(
        `Combinaison ${i + 1} invalide : suite de même couleur ou groupe de couleurs différentes.`,
      );
  if (!opened) {
    // Opening cannot extend, split or borrow any existing meld, even after reaching 30.
    for (const old of existing)
      if (
        !melds.some(
          (m) =>
            m.length === old.length && m.every((t, i) => t.id === old[i].id),
        )
      )
        throw new Error(
          'La première pose doit venir uniquement de votre chevalet.',
        );
    const oldIds = new Set(previous.map((t) => t.id));
    const added = melds.filter((m) => m.every((t) => !oldIds.has(t.id)));
    if (added.flat().length !== played.length)
      throw new Error(
        'Ouvrez avec des combinaisons indépendantes de la table.',
      );
    if (added.reduce((sum, m) => sum + (meldValue(m) ?? 0), 0) < 30)
      throw new Error('Votre première pose doit atteindre 30 points.');
  }
  return { melds, nextHand: hand.filter((t) => !used.has(t.id)) };
}
