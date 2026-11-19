import { Card, GameState, Player } from './game.types';
import { GRID_COLUMNS, GRID_ROWS, meldValue, RUMMI_COLORS } from './rummikub.logic';

function rackMelds(hand: Card[]): Card[][] {
  const candidates: Card[][] = [];
  for (let value = 1; value <= 13; value++) {
    const group = RUMMI_COLORS.flatMap((color) => {
      const tile = hand.find((t) => t.value === value && t.color === color);
      return tile ? [tile] : [];
    });
    if (group.length >= 3) candidates.push(group);
  }
  for (const color of RUMMI_COLORS) {
    let run: Card[] = [];
    for (let value = 1; value <= 14; value++) {
      const tile = hand.find((t) => t.value === value && t.color === color);
      if (tile) run.push(tile);
      else {
        if (run.length >= 3) candidates.push(run);
        run = [];
      }
    }
  }
  return candidates.sort((a, b) => meldValue(b)! - meldValue(a)!);
}

function firstFreeCell(length: number, groups: Card[][], cells: number[]): number {
  const occupied = new Set<number>();
  groups.forEach((group, index) => {
    if (cells[index] < 0) return;
    for (let offset = 0; offset < group.length; offset++) {
      occupied.add(cells[index] + offset);
    }
  });
  for (let cell = 0; cell < GRID_COLUMNS * GRID_ROWS; cell++) {
    if (cell % GRID_COLUMNS + length > GRID_COLUMNS) continue;
    let offset = 0;
    while (offset < length && !occupied.has(cell + offset)) offset++;
    if (offset === length) return cell;
  }
  return -1;
}

export function planBotMove(
  state: GameState,
  player: Player,
): { melds: string[][]; cells: number[] } | undefined {
  const groups = [...state.melds];
  const cells = state.meldCells ? [...state.meldCells] : groups.map(() => -1);
  if (!state.meldCells) {
    // Match the client's default layout for boards saved without positions.
    const order = groups.map((group, index) => ({ index, length: group.length }));
    order.sort((a, b) => b.length - a.length);
    for (const { index, length } of order) {
      cells[index] = firstFreeCell(length, groups, cells);
    }
    if (cells.includes(-1)) return;
  }

  let remaining = player.hand;
  let points = 0;
  while (remaining.length >= 3) {
    const candidate = rackMelds(remaining)[0];
    if (!candidate) break;
    const cell = firstFreeCell(candidate.length, groups, cells);
    if (cell < 0) break;
    groups.push(candidate);
    cells.push(cell);
    points += meldValue(candidate)!;
    remaining = remaining.filter((tile) => !candidate.includes(tile));
  }

  if (player.opened && !points) {
    for (const [index, group] of groups.entries()) {
      const start = cells[index];
      for (const tile of remaining) {
        for (const prepend of [false, true]) {
          const extended = prepend ? [tile, ...group] : [...group, tile];
          if (meldValue(extended) === null) continue;
          const edge = prepend ? start - 1 : start + group.length;
          if (edge < 0 || Math.floor(edge / GRID_COLUMNS) !== Math.floor(start / GRID_COLUMNS)) continue;
          const blocked = groups.some((other, i) =>
            i !== index && edge >= cells[i] && edge < cells[i] + other.length,
          );
          if (blocked) continue;
          groups[index] = extended;
          if (prepend) cells[index] = edge;
          return { melds: groups.map((meld) => meld.map((t) => t.id)), cells };
        }
      }
    }
  }
  if (points < (player.opened ? 1 : 30)) return;
  return { melds: groups.map((meld) => meld.map((t) => t.id)), cells };
}
