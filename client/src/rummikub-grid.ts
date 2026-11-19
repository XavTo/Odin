import type { Card } from "./types";

export const GRID_COLUMNS = 16;
export const GRID_ROWS = 12;
const capacity = GRID_COLUMNS * GRID_ROWS;

function fits(cell: number, length: number, occupied: Set<number>): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= capacity ||
      cell % GRID_COLUMNS + length > GRID_COLUMNS) return false;
  for (let index = 0; index < length; index++)
    if (occupied.has(cell + index)) return false;
  return true;
}

export function layoutBoard(
  groups: Card[][],
  before: Card[][] = [],
  previous: number[] = [],
  drop?: { group: Card[]; cell: number },
): number[] {
  const cells = Array<number>(groups.length).fill(-1);
  const occupied = new Set<number>();
  const cellByTile = new Map(before.flatMap((group, index) =>
    group.map((tile, offset) => [tile.id, previous[index] + offset] as const)
  ));

  function reserve(index: number, cell: number): boolean {
    if (!fits(cell, groups[index].length, occupied)) return false;
    cells[index] = cell;
    for (let offset = 0; offset < groups[index].length; offset++) occupied.add(cell + offset);
    return true;
  }

  // Fixed combinations take precedence over ones the player has changed.
  groups.forEach((group, index) => {
    const same = before.findIndex((old) =>
      old.length === group.length && old.every((tile, offset) => tile.id === group[offset].id));
    if (same >= 0 && group !== drop?.group) reserve(index, previous[same]);
  });
  const droppedIndex = drop ? groups.indexOf(drop.group) : -1;
  if (drop && droppedIndex >= 0) reserve(droppedIndex, drop.cell);

  groups.forEach((group, index) => {
    if (cells[index] >= 0) return;
    for (const [offset, tile] of group.entries()) {
      const oldCell = cellByTile.get(tile.id);
      if (oldCell !== undefined && reserve(index, oldCell - offset)) break;
    }
  });

  const fill = () => groups.map((group, index) => ({ index, length: group.length }))
    .filter(({ index }) => cells[index] < 0)
    .sort((a, b) => b.length - a.length)
    .every(({ index }) => {
      for (let cell = 0; cell < capacity; cell++)
        if (reserve(index, cell)) return true;
      return false;
    });

  if (!fill()) {
    // Compact only if the gaps left by past turns no longer fit a changed group.
    cells.fill(-1);
    occupied.clear();
    fill();
  }
  return cells;
}

export function clearGridDrop(
  groups: Card[][], cells: number[], moving: Card[], cell: number,
): boolean {
  const ids = new Set(moving.map((tile) => tile.id));
  const occupied = new Set<number>();
  groups.forEach((group, index) => {
    const length = group.filter((tile) => !ids.has(tile.id)).length;
    for (let offset = 0; offset < length; offset++) occupied.add(cells[index] + offset);
  });
  return fits(cell, moving.length, occupied);
}
