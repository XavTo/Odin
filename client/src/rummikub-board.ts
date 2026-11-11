export type DropTarget =
  | { kind: "meld"; row: number; index: number }
  | { kind: "new"; index: number }
  | { kind: "rack"; before?: string };

export function targetAt(
  x: number,
  y: number,
): { element: HTMLElement; target: DropTarget } | null {
  const pointer = document.elementFromPoint(x, y);
  const hit = pointer?.closest<HTMLElement>(
    "[data-rm-gap], [data-rm-new], [data-rm-position], [data-rm-end], .rm-rack, .rm-table",
  );
  if (!hit) return null;
  if (hit.dataset.rmGap) {
    const [row, index] = hit.dataset.rmGap.split(":").map(Number);
    return { element: hit, target: { kind: "meld", row, index } };
  }
  if (hit.dataset.rmNew !== undefined)
    return {
      element: hit,
      target: { kind: "new", index: Number(hit.dataset.rmNew) },
    };
  if (hit.dataset.rmPosition) {
    const rect = hit.getBoundingClientRect();
    const after = x > rect.left + rect.width / 2;
    const [row, index] = hit.dataset.rmPosition.split(":").map(Number);
    return {
      element: hit,
      target: { kind: "meld", row, index: index + Number(after) },
    };
  }
  if (hit.dataset.rmEnd) {
    const [row, index] = hit.dataset.rmEnd.split(":").map(Number);
    return { element: hit, target: { kind: "meld", row, index } };
  }
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
      if (highlight?.matches(".rm-position, [data-tile]")) {
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

export function fitRummikub(stage: HTMLElement): () => void {
  const table = stage.querySelector<HTMLElement>(".rm-table")!;
  const rack = stage.querySelector<HTMLElement>(".rm-rack")!;
  const count = rack.querySelectorAll("[data-tile]").length;
  function fit() {
    const rows = stage.clientWidth < 570 ? 2 : count > 20 ? 2 : 1;
    const columns = Math.max(1, Math.ceil(count / rows));
    rack.style.setProperty(
      "--rack-tile",
      `${Math.min(54, Math.max(18, Math.floor((rack.clientWidth - 12 - (columns - 1) * 4) / columns)))}px`,
    );
    let size = stage.clientWidth < 570 ? 37 : 52;
    table.style.setProperty("--board-tile", `${size}px`);
    while (table.scrollHeight > table.clientHeight + 1 && size > 14) {
      size -= 2;
      table.style.setProperty("--board-tile", `${size}px`);
    }
  }
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(stage);
  return () => observer.disconnect();
}
