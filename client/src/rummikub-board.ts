import { GRID_COLUMNS } from "./rummikub-grid";

export type DropTarget =
  | { kind: "meld"; row: number; index: number; tileId?: string }
  | { kind: "new"; index: number; cell?: number }
  | { kind: "rack"; before?: string };
type PreviewTile = { cell: number; html: string };

export function meldTarget(element: HTMLElement, x?: number): Extract<DropTarget, { kind: "meld" }> | null {
  const hit = element.closest<HTMLElement>("[data-rm-gap], [data-rm-position], [data-rm-end]");
  const position = hit?.dataset.rmGap ?? hit?.dataset.rmPosition ?? hit?.dataset.rmEnd;
  if (!hit || !position) return null;
  const tileId = hit.dataset.rmPosition ? hit.querySelector<HTMLElement>("[data-tile]")?.dataset.tile : undefined;
  const [row, index] = position.split(":").map(Number);
  if (hit.dataset.rmPosition && x !== undefined) {
    const { left, width } = hit.getBoundingClientRect();
    return { kind: "meld", row, index: index + Number(x >= left + width / 2), tileId };
  }
  return { kind: "meld", row, index, tileId };
}

export function targetAt(
  x: number,
  y: number,
): { element: HTMLElement; target: DropTarget } | null {
  const pointer = document.elementFromPoint(x, y);
  const hit = pointer?.closest<HTMLElement>(
    "[data-rm-gap], [data-rm-cell], [data-rm-position], [data-rm-end], .rm-rack, .rm-grid-area",
  );
  if (!hit) return null;
  const meld = meldTarget(hit, x);
  if (meld) return { element: hit.closest<HTMLElement>("[data-rm-end]")!, target: meld };
  if (hit.dataset.rmCell !== undefined) {
    return {
      element: hit,
      target: {
        kind: "new",
        index: Number(hit.closest<HTMLElement>(".rm-table")!.dataset.rmCount),
        cell: Number(hit.dataset.rmCell),
      },
    };
  }
  if (hit.classList.contains("rm-rack")) {
    const slot = pointer?.closest<HTMLElement>("[data-rm-rack-slot]");
    if (!slot) return { element: hit, target: { kind: "rack" } };
    const { left, width } = slot.getBoundingClientRect();
    let next = x > left + width / 2 ? slot.nextElementSibling : slot;
    let before: string | undefined;
    while (next && !before) {
      before = next.querySelector<HTMLElement>("[data-tile]")?.dataset.tile;
      next = next.nextElementSibling;
    }
    return { element: slot.querySelector<HTMLElement>("[data-tile]") ?? slot, target: { kind: "rack", before } };
  }
  const grid = hit.querySelector<HTMLElement>(".rm-grid")!;
  const { left, top, width, height } = grid.getBoundingClientRect();
  const columns = Number(grid.dataset.rmColumns), rows = Number(grid.dataset.rmRows);
  const column = Math.max(0, Math.min(columns - 1, Math.floor((x - left) / width * columns)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor((y - top) / height * rows)));
  const cell = row * GRID_COLUMNS + column;
  return { element: grid.querySelector<HTMLElement>(`[data-rm-cell="${cell}"]`)!,
    target: { kind: "new", index: Number(hit.closest<HTMLElement>(".rm-table")!.dataset.rmCount), cell } };
}

export function enableTileDragging(
  root: HTMLElement,
  pick: (element: HTMLElement) => string[],
  drop: (ids: string[], target: DropTarget) => void,
  previewDrop: (ids: string[], target: DropTarget) => boolean | PreviewTile[],
  pickOnHold: (element: HTMLElement) => string[],
  selection: () => string[],
) {
  let pending: {
    id: number;
    x: number;
    y: number;
    element: HTMLElement;
    tiles: string[];
    ghost?: HTMLElement;
    holdTimer?: number;
  } | null = null;
  let highlights: HTMLElement[] = [];
  let nearbyCells: HTMLElement[] = [];
  let overlay: HTMLElement | undefined;
  let previousPreview: { element: HTMLElement; key: string } | undefined;
  let suppressClick = false;
  function clearHighlights() {
    for (const tile of highlights)
      tile.classList.remove("rm-drop-target", "rm-drop-invalid", "rm-drop-after", "rm-drop-before");
    highlights = [];
    for (const cell of nearbyCells) cell.classList.remove("rm-drop-nearby");
    nearbyCells = [];
    overlay?.remove();
    overlay = undefined;
    previousPreview = undefined;
    if (pending?.ghost) pending.ghost.hidden = false;
  }
  function showDrop(ids: string[], x: number, y: number, dragging: boolean) {
    const hit = ids.length ? targetAt(x, y) : null;
    if (!hit || (!dragging && hit.target.kind === "rack")) return clearHighlights();
    const { element, target } = hit;
    const key = JSON.stringify([target, ids]);
    if (previousPreview?.element === element && previousPreview.key === key) return;
    clearHighlights();
    previousPreview = { element, key };
    const preview = previewDrop(ids, target);
    const grid = element.closest<HTMLElement>(".rm-grid");
    if (Array.isArray(preview) && grid && preview.length) {
      overlay = document.createElement("div");
      overlay.className = "rm-placement-preview";
      overlay.setAttribute("aria-hidden", "true");
      overlay.innerHTML = preview.map(({ cell, html }) =>
        `<div class="rm-ghost-slot" style="--column:${cell % GRID_COLUMNS};--row:${Math.floor(cell / GRID_COLUMNS)}">${html}</div>`).join("");
      grid.append(overlay);
      if (pending?.ghost) pending.ghost.hidden = true;
      const footprint = new Set(preview.map(({ cell }) => cell));
      const vicinity = new Set<number>();
      const columns = Number(grid.dataset.rmColumns);
      for (const cell of footprint) {
        const column = cell % GRID_COLUMNS;
        if (column > 0) vicinity.add(cell - 1);
        if (column < columns - 1) vicinity.add(cell + 1);
        vicinity.add(cell - GRID_COLUMNS);
        vicinity.add(cell + GRID_COLUMNS);
        const marker = grid.querySelector<HTMLElement>(`[data-rm-cell="${cell}"]`);
        if (marker) highlights.push(marker);
      }
      for (const cell of vicinity) {
        if (footprint.has(cell)) continue;
        const marker = grid.querySelector<HTMLElement>(`[data-rm-cell="${cell}"]`);
        if (!marker) continue;
        marker.classList.add("rm-drop-nearby");
        nearbyCells.push(marker);
      }
    } else highlights = [element];
    for (const highlight of highlights) {
      highlight.classList.add("rm-drop-target");
      highlight.classList.toggle("rm-drop-invalid", preview === false);
    }
    if (target.kind === "rack" && element.matches("[data-tile]")) {
      const rect = element.getBoundingClientRect();
      element.classList.add(x >= rect.left + rect.width / 2 ? "rm-drop-after" : "rm-drop-before");
    }
  }
  function clear() {
    clearHighlights();
    root.classList.remove("rm-dragging");
    pending?.ghost?.remove();
    if (pending) {
      window.clearTimeout(pending.holdTimer);
      pending.element.classList.remove("rm-drag-source", "rm-hold-ready");
    }
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
    if (!tiles.length) return;
    const gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, element, tiles };
    pending = gesture;
    const group = tiles.length === 1 && !event.shiftKey ? pickOnHold(element) : [];
    if (group.length > 1) {
      pending.holdTimer = window.setTimeout(() => {
        if (pending !== gesture || !element.isConnected) return;
        pending.tiles = group;
        element.classList.add("rm-hold-ready");
      }, 360);
    }
  });
  root.addEventListener("contextmenu", (event) => {
    if ((event.target as HTMLElement).closest(".rm-stage [data-tile]"))
      event.preventDefault();
  });
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!pending || pending.id !== event.pointerId) {
        if (event.pointerType === "mouse") showDrop(selection(), event.clientX, event.clientY, false);
        return;
      }
      if (
        !pending.ghost &&
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6
      )
        return;
      if (!pending.ghost) {
        window.clearTimeout(pending.holdTimer);
        if (!pending.element.isConnected) {
          clear();
          return;
        }
        root.setPointerCapture(event.pointerId);
        const ghost = document.createElement("div");
        ghost.className = "rm-drag-ghost";
        ghost.setAttribute("aria-hidden", "true");
        pending.element.classList.remove("rm-hold-ready");
        pending.element.classList.add("rm-drag-source");
        const tile = pending.element.matches("[data-tile]")
          ? pending.element
          : pending.element.parentElement?.querySelector<HTMLElement>(
              "[data-tile]",
            );
        if (tile) {
          const clone = tile.cloneNode(true) as HTMLElement;
          clone.style.width = `${tile.offsetWidth}px`;
          clone.style.height = `${tile.offsetHeight}px`;
          clone.tabIndex = -1;
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
      showDrop(pending.tiles, event.clientX, event.clientY, true);
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
  document.documentElement.addEventListener("pointerleave", clearHighlights);
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

export function fitRummikub(stage: HTMLElement): () => void {
  const rack = stage.querySelector<HTMLElement>(".rm-rack")!;
  const count = Number(rack.dataset.rmRackCount);

  function fitRack() {
    const style = getComputedStyle(rack);
    const width = rack.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap);
    const narrow = stage.clientWidth < 570;
    const maxRows = Math.min(count, narrow ? 3 : 2);
    const height = stage.clientHeight * (narrow ? 0.30 : 0.28);
    let size = 16;
    for (let rows = 1; rows <= maxRows; rows++) {
      const columns = Math.ceil(count / rows);
      const byWidth = (width - (columns - 1) * gap) / columns;
      const byHeight = (height - (rows - 1) * gap) / rows / 1.24;
      size = Math.max(size, Math.min(narrow ? 72 : 88, Math.floor(byWidth), Math.floor(byHeight)));
    }
    rack.style.setProperty("--rack-tile", `${size}px`);
    const columns = Math.max(1, Math.floor((width + gap) / (size + gap)));
    const rows = Math.ceil(count / columns);
    const verticalInsets = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    rack.style.minHeight = `${Math.ceil(rows * size * 1.24 + Math.max(0, rows - 1) * gap + verticalInsets)}px`;
  }

  fitRack();
  const observer = new ResizeObserver(fitRack);
  observer.observe(stage);
  return () => observer.disconnect();
}
