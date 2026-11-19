import { GRID_COLUMNS } from "./rummikub-grid";

export type DropTarget =
  | { kind: "meld"; row: number; index: number; tileId?: string }
  | { kind: "new"; index: number; cell?: number }
  | { kind: "rack"; before?: string };

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
    "[data-rm-gap], [data-rm-new], [data-rm-cell], [data-rm-position], [data-rm-end], .rm-rack, .rm-table",
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
  return {
    element: hit,
    target: { kind: "new", index: Number(hit.dataset.rmCount) },
  };
}

export function enableTileDragging(
  root: HTMLElement,
  pick: (element: HTMLElement) => string[],
  drop: (ids: string[], target: DropTarget) => void,
  canDrop: (ids: string[], target: DropTarget) => boolean,
  pickOnHold: (element: HTMLElement) => string[],
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
  let suppressClick = false;
  function clearHighlights() {
    for (const tile of highlights)
      tile.classList.remove("rm-drop-target", "rm-drop-invalid", "rm-drop-after", "rm-drop-before");
    highlights = [];
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
      if (!pending || pending.id !== event.pointerId) return;
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
      const hit = targetAt(event.clientX, event.clientY);
      clearHighlights();
      if (!hit) return;
      const { element, target } = hit;
      highlights = [element];
      if (target.kind === "new" && target.cell !== undefined) {
        let cell = element.nextElementSibling;
        const length = Math.min(pending.tiles.length, GRID_COLUMNS - target.cell % GRID_COLUMNS);
        while (cell instanceof HTMLElement && highlights.length < length) {
          highlights.push(cell);
          cell = cell.nextElementSibling;
        }
      }
      const invalid = !canDrop(pending.tiles, target);
      for (const highlighted of highlights) {
        highlighted.classList.add("rm-drop-target");
        highlighted.classList.toggle("rm-drop-invalid", invalid);
      }
      if (target.kind === "rack" && element.matches("[data-tile]")) {
        const rect = element.getBoundingClientRect();
        const after = event.clientX >= rect.left + rect.width / 2;
        element.classList.add(after ? "rm-drop-after" : "rm-drop-before");
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

export function fitRummikub(stage: HTMLElement): () => void {
  const rack = stage.querySelector<HTMLElement>(".rm-rack")!;
  const count = rack.querySelectorAll("[data-tile]").length;

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
  }

  fitRack();
  const observer = new ResizeObserver(fitRack);
  observer.observe(stage);
  return () => observer.disconnect();
}
