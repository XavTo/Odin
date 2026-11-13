export type DropTarget =
  | { kind: "meld"; row: number; index: number }
  | { kind: "new"; index: number }
  | { kind: "rack"; before?: string };

export function meldTarget(element: HTMLElement, x?: number): Extract<DropTarget, { kind: "meld" }> | null {
  const hit = element.closest<HTMLElement>("[data-rm-gap], [data-rm-position], [data-rm-end]");
  const position = hit?.dataset.rmGap ?? hit?.dataset.rmPosition ?? hit?.dataset.rmEnd;
  if (!hit || !position) return null;
  const [row, index] = position.split(":").map(Number);
  if (hit.dataset.rmPosition && x !== undefined) {
    const { left, width } = hit.getBoundingClientRect();
    return { kind: "meld", row, index: index + Number(x >= left + width / 2) };
  }
  return { kind: "meld", row, index };
}

export function targetAt(
  x: number,
  y: number,
): { element: HTMLElement; target: DropTarget } | null {
  const pointer = document.elementFromPoint(x, y);
  const hit = pointer?.closest<HTMLElement>(
    "[data-rm-gap], [data-rm-new], [data-rm-position], [data-rm-end], .rm-rack, .rm-table",
  );
  if (!hit) return null;
  const meld = meldTarget(hit, x);
  if (meld) return { element: hit.closest<HTMLElement>("[data-rm-end]")!, target: meld };
  if (hit.dataset.rmNew !== undefined)
    return {
      element: hit,
      target: { kind: "new", index: Number(hit.dataset.rmNew) },
    };
  if (hit.classList.contains("rm-rack")) {
    const tile = pointer?.closest<HTMLElement>("[data-tile]");
    if (!tile) return { element: hit, target: { kind: "rack" } };
    const rect = tile.getBoundingClientRect();
    const before =
      x > rect.left + rect.width / 2
        ? (tile.nextElementSibling as HTMLElement | null)?.dataset.tile
        : tile.dataset.tile;
    return { element: tile, target: { kind: "rack", before } };
  }
  for (const meld of hit.querySelectorAll<HTMLElement>("[data-rm-end]")) {
    const bounds = meld.getBoundingClientRect();
    if (y < bounds.top || y > bounds.bottom || x <= bounds.right || x - bounds.right > 12) continue;
    return { element: meld, target: meldTarget(meld)! };
  }
  return {
    element: hit,
    target: { kind: "new", index: Number(hit.dataset.rmCount) },
  };
}

export function enableTileDragging(
  root: HTMLElement,
  pick: (element: HTMLElement) => string[],
  drop: (ids: string[], target: DropTarget) => void,
) {
  let pending: {
    id: number;
    x: number;
    y: number;
    element: HTMLElement;
    tiles: string[];
    ghost?: HTMLElement;
  } | null = null;
  let highlight: HTMLElement | null = null;
  let suppressClick = false;
  function clear() {
    highlight?.classList.remove(
      "rm-drop-target",
      "rm-drop-after",
      "rm-drop-before",
    );
    highlight = null;
    root.classList.remove("rm-dragging");
    pending?.ghost?.remove();
    if (pending && root.hasPointerCapture(pending.id))
      root.releasePointerCapture(pending.id);
    pending = null;
  }
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>(
      ".rm-stage button[data-tile]:not(:disabled), .rm-stage button[data-rm-group]:not(:disabled)",
    );
    if (!element) return;
    const tiles = pick(element);
    if (tiles.length)
      pending = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        element,
        tiles,
      };
  });
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!pending || pending.id !== event.pointerId) return;
      if (
        !pending.ghost &&
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6
      )
        return;
      if (!pending.ghost) {
        if (!pending.element.isConnected) {
          clear();
          return;
        }
        root.setPointerCapture(event.pointerId);
        const ghost = document.createElement("div");
        ghost.className = "rm-drag-ghost";
        const tile = pending.element.matches("[data-tile]")
          ? pending.element
          : pending.element.parentElement?.querySelector<HTMLElement>(
              "[data-tile]",
            );
        if (tile) {
          const clone = tile.cloneNode(true) as HTMLElement;
          clone.style.width = `${tile.offsetWidth}px`;
          clone.style.height = `${tile.offsetHeight}px`;
          ghost.append(clone);
        }
        if (pending.tiles.length > 1) {
          const badge = document.createElement("b");
          badge.textContent = String(pending.tiles.length);
          ghost.append(badge);
        }
        document.body.append(ghost);
        root.classList.add("rm-dragging");
        pending.ghost = ghost;
      }
      event.preventDefault();
      pending.ghost.style.translate = `${event.clientX + 9}px ${event.clientY + 9}px`;
      const target = targetAt(event.clientX, event.clientY);
      if (highlight !== target?.element) {
        highlight?.classList.remove(
          "rm-drop-target",
          "rm-drop-after",
          "rm-drop-before",
        );
        highlight = target?.element ?? null;
        highlight?.classList.add("rm-drop-target");
      }
      if (highlight?.matches("[data-tile]")) {
        const rect = highlight.getBoundingClientRect();
        const after = event.clientX >= rect.left + rect.width / 2;
        highlight.classList.toggle("rm-drop-after", after);
        highlight.classList.toggle("rm-drop-before", !after);
      }
    },
    { passive: false },
  );
  window.addEventListener("pointerup", (event) => {
    if (!pending || event.pointerId !== pending.id) return;
    const tiles = pending.tiles;
    const target = pending.ghost
      ? targetAt(event.clientX, event.clientY)
      : null;
    if (pending.ghost) {
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
    clear();
    if (target) drop(tiles, target.target);
  });
  window.addEventListener("pointercancel", clear);
  window.addEventListener("blur", clear);
  root.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  return clear;
}

interface BoardLayout {
  width: number;
  height: number;
  size: number;
  rows: number[];
  scrollTop: number;
}

export function fitRummikub(stage: HTMLElement, previous?: BoardLayout) {
  const table = stage.querySelector<HTMLElement>(".rm-table")!;
  const rack = stage.querySelector<HTMLElement>(".rm-rack")!;
  const groups = table.querySelector<HTMLElement>(".rm-groups")!;
  const slots = Array.from(groups.children) as HTMLElement[];
  const rowGap = 8;
  const minBoardTile = 14;
  const tileHeightRatio = 1.24;

  const availableHeight = () =>
    table.clientHeight - groups.offsetTop - parseFloat(getComputedStyle(table).paddingBottom);

  function setRows(rows: HTMLElement[][]) {
    groups.classList.add("rm-spread");
    groups.replaceChildren(...rows.map((items) => {
      const row = document.createElement("div");
      row.className = "rm-board-row";
      row.append(...items);
      return row;
    }));
  }

  function clearRows() {
    if (!groups.classList.contains("rm-spread")) return;
    groups.classList.remove("rm-spread");
    groups.replaceChildren(...slots);
  }

  function spreadGroups() {
    const width = groups.clientWidth;
    const height = availableHeight();
    const sizes = slots.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { element, width: Math.ceil(bounds.width), height: bounds.height };
    });
    type Row = typeof sizes;
    const rowWidth = (row: Row) =>
      row.reduce((sum, slot) => sum + slot.width, (row.length - 1) * rowGap);
    const rowHeight = (row: Row) => Math.max(...row.map((slot) => slot.height));

    const packed: Row[] = [[]];
    for (const slot of sizes) {
      const row = packed[packed.length - 1];
      if (row.length && rowWidth(row) + rowGap + slot.width > width) packed.push([slot]);
      else row.push(slot);
    }

    // Split the widest rows as space allows so groups also use the height of the table.
    let spareHeight = height - packed.reduce((sum, row) => sum + rowHeight(row), (packed.length - 1) * rowGap);
    while (spareHeight > 0) {
      let best: { index: number; left: Row; right: Row; cost: number; improvement: number } | undefined;
      packed.forEach((row, index) => {
        for (let split = 1; split < row.length; split++) {
          const left = row.slice(0, split);
          const right = row.slice(split);
          if (right.length === 1 && right[0].element.classList.contains("rm-new-end")) continue;
          const cost = rowHeight(left) + rowHeight(right) + rowGap - rowHeight(row);
          const improvement = Math.min(rowWidth(left), rowWidth(right));
          if (cost <= spareHeight && (!best || improvement > best.improvement)) {
            best = { index, left, right, cost, improvement };
          }
        }
      });
      if (!best) break;
      packed.splice(best.index, 1, best.left, best.right);
      spareHeight -= best.cost;
    }

    setRows(packed.map((row) => row.map((item) => item.element)));
    if (groups.offsetHeight > availableHeight() + 1) clearRows();
  }

  const count = rack.querySelectorAll("[data-tile]").length;

  const setBoardSize = (size: number) => table.style.setProperty("--board-tile", `${size}px`);

  function fitRack(maxHeight?: number) {
    const narrow = stage.clientWidth < 570;
    const style = getComputedStyle(rack);
    const width = rack.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap);
    const height = maxHeight ?? stage.clientHeight * (narrow ? 0.34 : 0.25);
    const maxRows = Math.min(count, narrow ? 3 : count > 20 ? 2 : 1);
    let size = 16;
    for (let rows = 1; rows <= maxRows; rows++) {
      const columns = Math.ceil(count / rows);
      const byWidth = (width - (columns - 1) * gap) / columns;
      const byHeight = (height - (rows - 1) * gap) / rows / tileHeightRatio;
      size = Math.max(size, Math.min(narrow ? 72 : 88, Math.floor(byWidth), Math.floor(byHeight)));
    }
    rack.style.setProperty("--rack-tile", `${size}px`);
  }

  function fitBoardTiles() {
    const height = availableHeight();
    let min = minBoardTile;
    let max = Math.max(min, Math.floor(Math.min(120, groups.clientWidth / 5.2, height / tileHeightRatio)));

    // Measure the wrapped groups because long runs and group controls take different amounts of space.
    while (min < max) {
      const size = Math.ceil((min + max) / 2);
      setBoardSize(size);
      if (groups.offsetHeight <= height + 1) min = size;
      else max = size - 1;
    }
    setBoardSize(min);
  }

  function fit() {
    const focused = document.activeElement;
    fitRack();
    clearRows();

    // Keep the existing positions through turn changes and draws if the viewport still fits them.
    const saved = previous?.width === stage.clientWidth && previous.height === stage.clientHeight
      ? previous
      : undefined;
    setBoardSize(saved?.size ?? minBoardTile);
    if (saved?.rows.length) {
      let first = 0;
      setRows(saved.rows.map((count) => {
        const row = slots.slice(first, first + count);
        first += count;
        return row;
      }));
    }
    const missingHeight = groups.offsetHeight - availableHeight();
    if (missingHeight > 1) {
      const style = getComputedStyle(rack);
      const rackHeight = rack.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      fitRack(rackHeight - missingHeight);
    }
    if (saved && groups.offsetHeight <= availableHeight() + 1) {
      table.scrollTop = saved.scrollTop;
    } else {
      clearRows();
      fitBoardTiles();
      if (stage.clientWidth >= 720 && slots.length > 2) spreadGroups();
    }
    if (focused instanceof HTMLElement && groups.contains(focused) && focused !== document.activeElement)
      focused.focus({ preventScroll: true });
  }

  const layout = (): BoardLayout => ({
    width: stage.clientWidth,
    height: stage.clientHeight,
    size: parseInt(table.style.getPropertyValue("--board-tile"), 10),
    rows: groups.classList.contains("rm-spread")
      ? Array.from(groups.children, (row) => row.childElementCount)
      : [],
    scrollTop: table.scrollTop,
  });

  fit();
  previous = layout();
  const observer = new ResizeObserver(() => {
    fit();
    previous = layout();
  });
  observer.observe(stage);
  observer.observe(table);
  return { layout, disconnect: () => observer.disconnect() };
}
