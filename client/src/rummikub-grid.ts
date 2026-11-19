import type { Card } from "./types";

export const GRID_COLUMNS = 16;
export const GRID_ROWS = 12;
const capacity = GRID_COLUMNS * GRID_ROWS;

export function boardView(groups: Card[][], cells: number[], selectionSize = 0) {
  const usedColumns = Math.max(0, ...cells.map((cell, index) => cell % GRID_COLUMNS + groups[index].length));
  const usedRows = Math.max(0, ...cells.map((cell) => Math.floor(cell / GRID_COLUMNS) + 1));
  const occupied = groups.reduce((total, group) => total + group.length + 1, 0);
  const columns = Math.min(GRID_COLUMNS, Math.max(10, usedColumns, selectionSize, Math.ceil(occupied / 7)));
  return {
    columns,
    rows: Math.min(GRID_ROWS, Math.max(5, usedRows, Math.ceil((occupied + 10) / columns))),
  };
}

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
  view?: { columns: number; rows: number },
): number[] {
  const cells = Array<number>(groups.length).fill(-1);
  const occupied = new Set<number>();
  const cellByTile = new Map(before.flatMap((group, index) =>
    group.map((tile, offset) => [tile.id, previous[index] + offset] as const)
  ));

  function reserve(index: number, cell: number): boolean {
    const length = groups[index].length;
    if (!fits(cell, length, occupied) || (view &&
        (cell % GRID_COLUMNS + length > view.columns || Math.floor(cell / GRID_COLUMNS) >= view.rows))) return false;
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

  if (!fill() && !view) {
    // Compact only if the gaps left by past turns no longer fit a changed group.
    cells.fill(-1);
    occupied.clear();
    fill();
  }
  return cells;
}

export function gridDropSpace(groups: Card[][], cells: number[], moving: Card[], cell: number, columns: number) {
  const ids = new Set(moving.map((tile) => tile.id));
  const occupied = new Set<number>();
  groups.forEach((group, index) => {
    const length = group.filter((tile) => !ids.has(tile.id)).length;
    for (let offset = 0; offset < length; offset++) occupied.add(cells[index] + offset);
  });
  const first = cell - cell % GRID_COLUMNS;
  const last = first + columns - moving.length;
  const start = Math.min(cell, last);
  if (start < first || !fits(start, moving.length, occupied)) return;

  const separated = (start: number) =>
    (start === first || !occupied.has(start - 1)) &&
    (start % GRID_COLUMNS + moving.length === GRID_COLUMNS || !occupied.has(start + moving.length));
  if (separated(start)) return { start, separateCell: start };

  // Give incompatible combinations a gap, without crossing into another row.
  const away = start > first && occupied.has(start - 1) ? 1 : -1;
  for (let distance = 1; distance < columns; distance++) {
    for (const candidate of [start + distance * away, start - distance * away]) {
      if (candidate >= first && candidate <= last && separated(candidate)) {
        // A nearby combination should never cause the tile to jump across it.
        const from = Math.min(start, candidate);
        const count = Math.abs(start - candidate) + moving.length;
        if (fits(from, count, occupied)) return { start, separateCell: candidate };
      }
    }
  }
  return { start, separateCell: undefined };
}
