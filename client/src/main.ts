import "./style.css";
import "./rummikub-board.css";
import { enableTileDragging, fitRummikub, meldTarget } from "./rummikub-board";
import type { DropTarget } from "./rummikub-board";
import { playSound, prepareSound, soundEnabled, toggleSound } from "./sounds";
import { PhotoEditor, photoFor } from "./photo-editor";
import type { Photos } from "./photo-editor";
import { io } from "socket.io-client";
import type {
  Card,
  CardColor,
  GameStats,
  GameType,
  PublicGameState,
  RummikubDraw,
} from "./types";
const app = document.querySelector<HTMLDivElement>("#app")!;
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    notify(
      "Le stockage du navigateur est indisponible. La reprise après fermeture ne pourra pas être conservée.",
    );
  }
};
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let accessChecking = true,
  siteUnlocked = false,
  accessPending = false;
let accessError = "";
let accessUnavailable = false;
let game: GameType = "odin";
let state: PublicGameState | null = null;
let connected = false,
  ready = false,
  busy = false,
  replaced = false;
let playerName = read("odin-name") || "";
const invitedCode = new URLSearchParams(location.search).get("room") || "";
let code = /^\d{4}$/.test(invitedCode) ? invitedCode : "";
let selected = new Set<string>(),
  take: string | null = null;
let draft: Card[][] | null = null;
let undoStack: Card[][][] = [];
let rackOrder: string[] = [];
let boardFit: ReturnType<typeof fitRummikub> | undefined;
let renderedBoard: Card[][] | undefined;
let cancelRummikubDrag: (() => void) | undefined;
let drawNotice = "";
let drawNoticeTimer = 0;
let flyingTile: HTMLElement | null = null;
const tileImages = new Map<string, string>();
let sort: "color" | "value" = "color";
let photoLibrary: Photos = {};
let backgroundSynced = false;
let isAdmin = false;
let adminPending = false;
let openPhotosAfterAdmin = false;
let photosVisible = read("odin-photos") !== "off";
let customTurnSelected = false;
const turnPresets = [15, 30, 60, 120, 0];
let rulesOpen = false,
  rankingsOpen = false;
let rankings: Array<{ id: string; name: string } & GameStats> = [];
let rankingLoading = false;
let rankingError = "";
let toastTimer = 0;
let clockOffset = 0;
let warnedTurn = "";
let lastTick = 0;
let confirmResolve: ((value: boolean) => void) | null = null;
const colors: Record<CardColor, string> = {
  red: "Rouge",
  blue: "Bleu",
  orange: "Orange",
  black: "Noir",
  green: "Vert",
  yellow: "Jaune",
};
const names = { odin: "Odin", rummikub: "Rummikub" };
const serverUrl =
  import.meta.env.VITE_SERVER_URL ||
  (location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : location.origin);
const socket = io(serverUrl, {
  autoConnect: false,
  auth: (cb) =>
    cb({
      token: read("odin-token"),
      accessToken: read("odin-site-access"),
      adminToken: read("odin-admin-access"),
    }),
  reconnectionDelay: 700,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});
app.innerHTML = `<div class="app-shell"><header class="hero"><img src="/peru-anniversary-ornament.png" alt="" class="ornament"><div><h1>Odin &amp; Rummikub</h1></div><img src="/peru-anniversary-ornament.png" alt="" class="ornament right"></header><div id="connection" role="status" aria-live="polite"></div><main id="content"></main></div><div id="toast" role="status" aria-live="polite"></div><dialog id="confirm-dialog"><h2>Confirmer l’action</h2><p id="confirm-text"></p><div class="actions"><button class="secondary" data-action="confirm-no">Annuler</button><button data-action="confirm-yes">Confirmer</button></div></dialog><dialog id="admin-dialog"><form id="admin-form"><h2>Administration</h2><label>Mot de passe administrateur<input id="admin-password" type="password" autocomplete="current-password" required maxlength="1024"></label><p id="admin-error" role="alert"></p><div class="actions"><button type="button" class="secondary" data-action="admin-close">Annuler</button><button type="submit">Se connecter</button></div></form></dialog><dialog id="info-dialog" class="info-dialog" aria-labelledby="info-title"><div class="info-header"><h2 id="info-title"></h2><button type="button" class="info-close" data-action="close-info" aria-label="Fermer">✕</button></div><div id="info-body"></div></dialog>`;
const content = document.querySelector<HTMLElement>("#content")!;
const photoEditor = new PhotoEditor(async (photos) => {
  if (!ready || !socket.connected || !isAdmin)
    throw new Error("Accès administrateur requis.");
  let result;
  try {
    result = await socket.timeout(15000).emitWithAck("savePhotos", {
      photos,
    });
  } catch {
    throw new Error("Enregistrement non confirmé. Réessayez.");
  }
  if (!result.ok) {
    if (result.message === "Accès administrateur requis.") {
      isAdmin = false;
      render();
    }
    throw new Error(result.message || "Enregistrement impossible.");
  }
  photoLibrary = { ...photos };
  applyBackground();
  render();
  notify("Photos enregistrées.");
});
function showBackground(background?: string | null) {
  const url = background || "/peru-anniversary-bg.png";
  document.documentElement.style.setProperty("--app-background", `url("${url}")`);
}
function applyBackground() {
  backgroundSynced = true;
  showBackground(photoLibrary.background);
}
async function loadBackground() {
  try {
    const response = await fetch(`${serverUrl}/background`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return;
    const data: { background?: string | null } = await response.json();
    if (!backgroundSynced) showBackground(data.background);
  } catch {
    // Keep the neutral background if the server is unavailable.
  }
}
function notify(message: string) {
  const el = document.querySelector<HTMLElement>("#toast")!;
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 5500);
}
function connection() {
  const el = document.querySelector<HTMLElement>("#connection")!;
  const message =
    !siteUnlocked || ready
      ? ""
      : replaced
        ? "Session ouverte dans un autre onglet."
        : connected
          ? "Synchronisation…"
          : "Reconnexion…";
  el.hidden = !message;
  el.innerHTML = message
    ? `<span class="dot"></span>${message}${replaced ? '<button class="text" data-action="reconnect">Reprendre ici</button>' : ""}`
    : "";
}
socket.on("connect", () => {
  connected = true;
  replaced = false;
  connection();
});
socket.on(
  "session",
  (session: {
    token?: string;
    name: string;
    reset: boolean;
    photos?: Photos;
    isAdmin?: boolean;
  }) => {
    if (session.token) save("odin-token", session.token);
    photoLibrary = session.photos ?? {};
    applyBackground();
    isAdmin = session.isAdmin === true;
    if (!playerName && session.name !== "Joueur") playerName = session.name;
    ready = true;
    busy = false;
    state = null;
    draft = null;
    if (session.reset)
      notify(
        "Votre ancienne session n’existe plus sur le serveur. Un nouveau profil a été créé.",
      );
    connection();
    render();
    if (rankingsOpen) void loadRankings();
    if (openPhotosAfterAdmin && isAdmin) {
      openPhotosAfterAdmin = false;
      photoEditor.open(photoLibrary, 13);
    }
  },
);
socket.on("photosUpdated", (update: { photos: Photos }) => {
  photoLibrary = update.photos;
  applyBackground();
  render();
});
socket.on("disconnect", () => {
  connected = false;
  ready = false;
  busy = false;
  connection();
  render();
});
socket.on("sessionReplaced", () => {
  replaced = true;
  ready = false;
  connection();
});
socket.on("connect_error", (error) => {
  if (error.message === "SITE_AUTH_REQUIRED") {
    siteUnlocked = false;
    accessError = "Saisissez le mot de passe pour vous reconnecter.";
    render();
  }
  connected = false;
  ready = false;
  connection();
});
socket.on("roomLeft", () => {
  customTurnSelected = false;
  rackOrder = [];
  drawNotice = "";
  state = null;
  selected.clear();
  draft = null;
  undoStack = [];
  take = null;
  history.replaceState({}, "", location.pathname);
  code = "";
  render();
});
socket.on("state", (next: PublicGameState) => {
  if (state && state.roomId === next.roomId && state.phase === "playing" && next.phase === "playing" && state.currentPlayerId !== next.currentPlayerId && next.currentPlayerId === next.you?.id) playSound("turn");
  const sameRound = state?.roomId === next.roomId && state.round === next.round;
  const draw = sameRound && next.lastDraw && next.lastDraw.revision > (state?.revision ?? 0)
    ? next.lastDraw : undefined;
  if (state?.roomId !== next.roomId) customTurnSelected = false;
  if (!sameRound) {
    rackOrder = [];
    drawNotice = "";
    window.clearTimeout(drawNoticeTimer);
  }
  const sameTurn =
    state?.roomId === next.roomId &&
    state.currentPlayerId === next.currentPlayerId &&
    state.round === next.round &&
    state.phase === next.phase &&
    JSON.stringify(state.melds) === JSON.stringify(next.melds) &&
    state.hand.map((t) => t.id).join() === next.hand.map((t) => t.id).join();
  if (!sameTurn) {
    cancelRummikubDrag?.();
    selected.clear();
    take = null;
    draft = null;
    undoStack = [];
    clearDraft();
  }
  const revisionChanged = next.revision !== state?.revision;
  state = next;
  game = next.game;
  clockOffset = next.serverNow - Date.now();
  if (sameTurn && draft) persistDraft();
  if (!draft) restoreDraft();
  const handIds = new Set(next.hand.map((c) => c.id));
  if (next.game === "odin")
    selected = new Set([...selected].filter((id) => handIds.has(id)));
  if (take && !next.table.some((c) => c.id === take)) take = null;
  if (draw) markDraw(draw);
  render();
  if (draw?.drewTile) animateDraw(draw.playerId);
  if (draft && revisionChanged) publishDraft();
});
socket.on("meldPreview", (event: { roomId: string; revision: number; playerId: string; melds: Card[][] | null }) => {
  if (!state || state.game !== "rummikub" || state.phase !== "playing" ||
    state.roomId !== event.roomId || state.revision !== event.revision ||
    state.currentPlayerId !== event.playerId || state.you?.id === event.playerId) return;
  state.preview = event.melds;
  render();
});
async function command(
  event: string,
  payload: Record<string, unknown> = {},
): Promise<boolean> {
  if (!ready || !socket.connected || busy) return false;
  busy = true;
  render();
  try {
    const result = await socket.timeout(10000).emitWithAck(event, {
      roomId: state?.roomId,
      revision: state?.revision,
      ...payload,
    });
    if (!result.ok) {
      notify(result.message || "Action refusée.");
      return false;
    }
    return true;
  } catch {
    notify("Confirmation non reçue. Synchronisation de la partie…");
    if (socket.connected) socket.emit("sync");
    return false;
  } finally {
    busy = false;
    render();
  }
}
const yourTurn = () =>
  ready &&
  state?.phase === "playing" &&
  state.currentPlayerId === state.you?.id;
const host = () =>
  state?.players.some((p) => p.id === state?.you?.id && p.isHost) ?? false;
const board = () => draft ?? state?.melds ?? [];
const tileIds = (melds: Card[][]) => melds.map((group) => group.map((tile) => tile.id));
const sameBoard = (a: Card[][], b: Card[][]) => JSON.stringify(tileIds(a)) === JSON.stringify(tileIds(b));
function rackTiles(): Card[] {
  const hand = rack();
  if (!rackOrder.length) return sorted(hand);
  const byId = new Map(hand.map((tile) => [tile.id, tile]));
  const ordered: Card[] = [];
  for (const id of rackOrder) {
    const tile = byId.get(id);
    if (tile) { ordered.push(tile); byId.delete(id); }
  }
  return [...ordered, ...byId.values()];
}
function rackRun(firstId: string): string[] {
  const tiles = rackTiles();
  const first = tiles.find((tile) => tile.id === firstId);
  if (!first || first.joker) return [];
  const byValue = new Map<number, Card>();
  for (const tile of tiles) {
    if (!tile.joker && tile.color === first.color && !byValue.has(tile.value))
      byValue.set(tile.value, tile);
  }
  if (byValue.get(first.value)?.id !== first.id || byValue.has(first.value - 1)) return [];
  const run: string[] = [];
  for (let value = first.value; byValue.has(value); value++)
    run.push(byValue.get(value)!.id);
  return run.length >= 3 ? run : [];
}
function tileImage(url: string): string {
  if (!url.startsWith("data:")) return url;
  const cached = tileImages.get(url);
  if (cached) return cached;
  const match = /^data:(image\/(?:png|webp|jpeg));base64,(.+)$/.exec(url);
  if (!match) return url;
  const bytes = Uint8Array.from(atob(match[2]), (byte) => byte.charCodeAt(0));
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: match[1] }));
  tileImages.set(url, objectUrl);
  if (tileImages.size > 60) {
    const oldest = tileImages.keys().next().value!;
    URL.revokeObjectURL(tileImages.get(oldest)!);
    tileImages.delete(oldest);
  }
  return objectUrl;
}
function rack(): Card[] {
  const used = new Set(
    board()
      .flat()
      .map((t) => t.id),
  );
  return (state?.hand ?? []).filter((t) => !used.has(t.id));
}
function sorted(cards: Card[]): Card[] {
  return [...cards].sort((a, b) =>
    a.joker
      ? b.joker
        ? 0
        : 1
      : b.joker
        ? -1
        : sort === "value"
          ? a.value - b.value || a.color.localeCompare(b.color)
          : a.color.localeCompare(b.color) || a.value - b.value,
  );
}
function card(tile: Card, source: string, disabled = false): string {
  const photo =
    game === "rummikub" || (!tile.joker && photosVisible)
      ? photoFor(state?.settings.photos ?? {}, tile.joker ? 0 : tile.value, game)
      : "";
  return `<button type="button" class="tile ${game === "odin" ? "odin-card" : "rummi-tile"} color-${tile.color} ${selected.has(tile.id) || (source === "take" && take === tile.id) ? "selected" : ""} ${photo ? "photo" : ""}" data-tile="${esc(tile.id)}" data-source="${source}" aria-label="${tile.joker ? "Joker" : `${tile.value} ${colors[tile.color]}`}" aria-pressed="${selected.has(tile.id) || (source === "take" && take === tile.id)}" ${disabled ? "disabled" : ""} draggable="false">${photo ? `<img src="${esc(game === "rummikub" ? tileImage(photo) : photo)}" alt="" draggable="false">` : ""}<span class="tile-number">${tile.joker ? "★" : tile.value}</span>${game === "odin" ? `<span class="tile-color">${colors[tile.color]}</span>` : ""}</button>`;
}
function players(): string {
  return `<div class="players">${state!.players.map((p) => `<article class="player ${p.isCurrent ? "current" : ""} ${p.forfeited ? "forfeited" : ""}"><span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span><div><strong>${esc(p.name)}${p.id === state!.you?.id ? " <small>(vous)</small>" : ""}</strong><p>${p.forfeited ? "A abandonné" : !p.connected ? "Reconnexion attendue" : p.isCurrent ? "À son tour" : p.isHost ? "Hôte de la salle" : "À la table"} · ${p.handCount} ${game === "odin" ? "cartes" : "tuiles"}</p><small>${p.score} points${game === "rummikub" ? (p.opened ? " · Première pose faite" : " · Première pose à faire") : p.passed ? " · A passé" : ""}</small></div>${host() && !p.connected && !p.forfeited ? `<button class="text danger" data-remove="${p.id}">Retirer</button>` : ""}</article>`).join("")}</div>`;
}
function gameChoices(): string {
  return `<div class="game-choices" role="group" aria-label="Choisir le jeu"><button class="game-choice ${game === "odin" ? "active" : ""}" data-game="odin" aria-pressed="${game === "odin"}"><div class="game-art odin-art"><span style="background-image:url(&quot;${esc(photoFor(photoLibrary, 8, "odin"))}&quot;)">8</span><span style="background-image:url(&quot;${esc(photoFor(photoLibrary, 9, "odin"))}&quot;)">9</span></div><div><span class="eyebrow">2 à 6 joueurs · Cartes</span><h2>Odin</h2><p>9 cartes par joueur.<br>Le plus petit score gagne.</p></div><span class="choose">${game === "odin" ? "Sélectionné ✓" : "Choisir Odin →"}</span></button><button class="game-choice ${game === "rummikub" ? "active" : ""}" data-game="rummikub" aria-pressed="${game === "rummikub"}"><div class="game-art rummi-art">${[11, 12, 13].map(n => `<span><img src="${esc(photoFor(photoLibrary, n, "rummikub"))}" alt=""><b>${n}</b></span>`).join("")}</div><div><span class="eyebrow">2 à 4 joueurs · Tuiles</span><h2>Rummikub</h2><p>14 tuiles par joueur.<br>Première pose de 30 points.</p></div><span class="choose">${game === "rummikub" ? "Sélectionné ✓" : "Choisir Rummikub →"}</span></button></div>`;
}
function home(): string {
  return `${gameChoices()}<section class="panel home-join"><div><h2>Salle</h2></div><div class="join-form"><label>Pseudo<input id="player-name" autocomplete="nickname" maxlength="24" placeholder="Pseudo" value="${esc(playerName)}"></label><button data-action="create" ${!ready || busy ? "disabled" : ""}>Créer une salle <span>→</span></button><div class="join-code"><input id="room-code" aria-label="Code de la salle" placeholder="0000" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" value="${esc(code)}"><button class="secondary" data-action="join" ${!ready || busy ? "disabled" : ""}>Rejoindre</button></div></div></section><button class="admin-entry" data-action="admin" aria-label="Administration" title="Administration" ${!ready ? "disabled" : ""}>⚙</button>`;
}
function settings(): string {
  const s = state!;
  const disabled = !host() || busy || !ready;
  const customTurn = customTurnSelected || !turnPresets.includes(s.settings.turnSeconds);
  return `<section class="panel"><h3>Options</h3><div class="settings">${game === "odin" ? `<label>Score limite<input type="number" id="max-score" min="5" max="50" value="${s.settings.maxScore}" ${disabled ? "disabled" : ""}></label><label>Couleurs<select id="color-count" ${disabled ? "disabled" : ""}>${[4, 5, 6].map((n) => `<option ${n === s.settings.colorCount ? "selected" : ""}>${n}</option>`).join("")}</select></label><p>${s.effectiveColorCount} couleurs · 9 cartes par joueur.</p>` : `<label>Temps par tour<select id="turn-seconds" ${disabled ? "disabled" : ""}>${turnPresets.map((n) => `<option value="${n}" ${!customTurn && n === s.settings.turnSeconds ? "selected" : ""}>${n ? `${n} secondes` : "Sans limite"}</option>`).join("")}<option value="custom" ${customTurn ? "selected" : ""}>Personnalisé</option></select></label>${customTurn ? `<label>Secondes (1 à 3600)<input type="number" id="custom-turn-seconds" min="1" max="3600" step="1" value="${s.settings.turnSeconds || 60}" ${disabled ? "disabled" : ""}></label>${!disabled ? `<button class="secondary" data-action="apply-custom-turn">Appliquer</button>` : ""}` : ""}<p>À la fin du temps : pioche et fin du tour.</p>`}</div></section>`;
}
function room(): string {
  const s = state!;
  if (s.game === "rummikub" && s.phase === "playing") return rummikubStage(s);
  return `<div class="room-bar"><div><span class="eyebrow">${names[game]}</span><h2>${s.roomId} <button class="secondary compact" data-action="invite">Copier le lien</button></h2></div><div class="room-actions"><button class="secondary compact room-control sound-toggle" data-action="sound" aria-pressed="${soundEnabled()}">${soundEnabled() ? "Son activé" : "Son coupé"}</button><button class="secondary compact room-control" data-action="leave" ${!ready || busy ? "disabled" : ""}>${s.phase === "playing" || s.phase === "round_end" ? "Abandonner" : "Quitter la salle"}</button></div></div>${players()}${!host() && s.players.some((p) => p.isHost && !p.connected) ? '<p class="muted">L’hôte est déconnecté. Après 30 secondes, vous pouvez <button class="text" data-action="claim-host">reprendre le rôle d’hôte</button>.</p>' : ""}${s.phase === "lobby" ? `${settings()}<div class="start-row">${s.players.length < 2 ? "<p>2 joueurs minimum.</p>" : !host() ? "<p>En attente de l’hôte.</p>" : ""}<button data-action="start" ${!host() || !ready || busy || s.players.filter((p) => !p.forfeited).length < 2 || s.players.some((p) => !p.connected) ? "disabled" : ""}>Lancer la partie →</button></div>` : playArea()}`;
}
function result(): string {
  const s = state!;
  const r = s.roundResult;
  return `<section class="panel result"><span class="eyebrow">${s.phase === "game_end" ? "Fin de partie" : `Manche ${s.round} terminée`}</span><h2>${s.phase === "game_end" ? s.winners?.map((w) => esc(w.name)).join(" & ") : r?.winnerIds.map((id) => esc(s.players.find((p) => p.id === id)?.name)).join(" & ")} ${s.phase === "game_end" && (s.winners?.length ?? 0) > 1 ? "se partagent la victoire" : "remporte la " + (s.phase === "game_end" ? "partie" : "manche")}</h2><p>${esc(r?.reason)}</p><div class="results">${s.players.map((p) => `<div><strong>${esc(p.name)}</strong><span>${r?.points[p.id] !== undefined ? `${r.points[p.id] > 0 ? "+" : ""}${r.points[p.id]} cette manche · ` : ""}${p.score} au total</span></div>`).join("")}</div><button data-action="${s.phase === "game_end" ? "start" : "next-round"}" ${!host() || busy || !ready || s.players.filter((p) => !p.forfeited).length < 2 ? "disabled" : ""}>${s.phase === "game_end" ? "Rejouer" : "Manche suivante"} →</button>${!host() ? "<p>En attente de l’hôte…</p>" : ""}</section>`;
}
function odinHint(): string {
  if (!state || !selected.size)
    return state?.leaderRequired
      ? "Ouvrez le pli avec une carte."
      : `Posez ${state?.lastPlay?.count} ou ${(state?.lastPlay?.count ?? 0) + 1} cartes, plus fortes que ${state?.lastPlay?.value}.`;
  const cards = state.hand.filter((c) => selected.has(c.id));
  const value = Number(
    cards
      .map((c) => c.value)
      .sort((a, b) => b - a)
      .join(""),
  );
  if (
    !cards.every((c) => c.color === cards[0].color) &&
    !cards.every((c) => c.value === cards[0].value)
  )
    return "Ces cartes n’ont ni la même couleur, ni la même valeur.";
  if (
    state.leaderRequired &&
    cards.length !== 1 &&
    !(cards.length === state.hand.length)
  )
    return "Ouvrez le pli avec une seule carte.";
  if (
    !state.leaderRequired &&
    state.lastPlay &&
    (![state.lastPlay.count, state.lastPlay.count + 1].includes(cards.length) ||
      value <= state.lastPlay.value)
  )
    return `Valeur ${value} : il faut ${state.lastPlay.count} ou ${state.lastPlay.count + 1} cartes et dépasser ${state.lastPlay.value}.`;
  if (cards.length < state.hand.length && state.table.length > 1 && !take)
    return `Valeur ${value} · Choisissez la carte de la table à récupérer.`;
  return `Prêt à jouer · Valeur ${value}${cards.length === state.hand.length ? " · Main vidée !" : ""}`;
}
function playArea(): string {
  const s = state!;
  if (s.phase !== "playing") return result();
  const me = yourTurn();
  const current = s.players.find((p) => p.id === s.currentPlayerId);
  const hint = odinHint();
  return `<section class="table-panel ${me ? "my-turn" : ""}">
    <div class="table-heading"><div><span class="eyebrow">Manche ${s.round}</span><h2>${me ? "À vous de jouer" : `Au tour de ${esc(current?.name)}`}</h2>${!current?.connected ? "<p>Joueur déconnecté.</p>" : ""}</div></div>
    <div class="odin-table tile-row">${s.table.length ? sorted(s.table).map((tile) => card(tile, "take", !me || busy || s.table.length === 1)).join("") : '<div class="empty-table"><span aria-hidden="true">✧</span></div>'}</div>
    <p class="table-note">${s.table.length === 1 ? "Cette carte est récupérée automatiquement si votre main n’est pas vidée." : s.table.length > 1 ? "Choisissez ici la carte à récupérer. Aucune reprise si vous videz votre main." : ""}</p>
    <div class="action-bar"><p id="selection-hint" aria-live="polite">${hint}</p><div class="actions">
      <button class="secondary" data-action="suggest" ${!me || busy ? "disabled" : ""}>Suggestion</button>
      <button class="text" data-action="clear">Désélectionner</button>
      <button class="secondary" data-action="pass" ${!me || busy || s.leaderRequired ? "disabled" : ""}>Passer</button>
      <button data-action="play" ${!me || busy || !hint.startsWith("Prêt") ? "disabled" : ""}>Jouer ${selected.size || ""} →</button>
    </div></div>
    </section><section class="panel rack-panel"><div class="rack-heading"><h2>Votre main <small>${s.hand.length}</small></h2><div class="toolbar">
      <button class="text" data-action="sort">Trier par ${sort === "color" ? "valeur" : "couleur"}</button>
      <button class="text" data-action="photos">${photosVisible ? "Masquer" : "Afficher"} les photos</button>
    </div></div><div class="tile-row rack">${sorted(s.hand).map((tile) => card(tile, "hand", !me || busy)).join("")}</div></section>`;
}

function rummikubStage(s: PublicGameState): string {
  const me = s.currentPlayerId === s.you?.id;
  const editable = yourTurn() && !busy;
  const current = s.players.find((player) => player.id === s.currentPlayerId);
  const opened = s.players.find((player) => player.id === s.you?.id)?.opened;
  const groups = s.preview ?? board();
  const hasInvalid = groups.some((group) => validMeld(group) === null);
  const placed = s.hand.length - rack().length;
  const openingPoints = opened ? 0 : groups
    .filter((group) => group.every((tile) => s.hand.some((handTile) => handTile.id === tile.id)))
    .reduce((sum, group) => sum + (validMeld(group) ?? 0), 0);
  const canValidate = editable && draft && placed > 0 && !hasInvalid && (opened || openingPoints >= 30);
  const turn = s.paused ? "Partie en pause" : me ? "À vous de jouer" : `Au tour de ${current?.name ?? "l’adversaire"}`;
  const hint = s.preview ? `${current?.name ?? "Le joueur"} prépare son coup` :
    (me && !opened ? `Première pose · ${openingPoints}/30 points` :
      me && hasInvalid ? "Complétez les groupes en orange" : "");
  const newTarget = (index: number, last = false) => `<button type="button" class="rm-new ${last ? "rm-new-end" : ""}" data-rm-new="${index}" ${editable && selected.size ? "" : "disabled"} aria-label="Créer un groupe ici">${last ? "+ Groupe" : "+"}</button>`;
  return `<section class="rm-stage" aria-label="Partie de Rummikub">
    <header class="rm-hud">
      <div class="rm-turn ${me ? "my-turn" : ""}">
        <strong role="status">${esc(turn)}</strong><span class="rm-clock" id="timer" aria-label="Temps restant"></span>
        <div class="rm-progress" aria-hidden="true"><i></i></div>
      </div>
      <div class="rm-menu">
        <button class="secondary compact" data-action="sound" aria-pressed="${soundEnabled()}" aria-label="${soundEnabled() ? "Couper le son" : "Activer le son"}" title="${soundEnabled() ? "Son activé" : "Son coupé"}">${soundEnabled() ? "♫" : "♪̸"}</button>
        <button class="secondary compact" data-action="rules" aria-haspopup="dialog" aria-label="Règles du Rummikub">?</button>
        <button class="secondary compact" data-action="ranking" aria-haspopup="dialog" aria-label="Classement">🏆</button>
        <button class="secondary compact" data-action="leave" ${!ready || busy ? "disabled" : ""}>Quitter</button>
      </div>
      <div class="rm-players"><button class="secondary compact rm-invite" data-action="invite" aria-label="Copier le lien de la salle ${s.roomId}">${s.roomId}</button>${s.players.map((player) => `<div class="rm-player ${player.isCurrent ? "active" : ""} ${!player.connected ? "offline" : ""}" data-rm-player="${esc(player.id)}" title="${esc(player.name)} · ${player.handCount} tuiles${!player.connected ? " · Déconnecté" : ""}"><strong>${player.id === s.you?.id ? "Vous" : esc(player.name)}</strong><span>${player.handCount} ▥</span>${host() && !player.connected && !player.forfeited ? `<button class="secondary compact" data-remove="${esc(player.id)}" aria-label="Retirer ${esc(player.name)}">×</button>` : ""}</div>`).join("")}${!host() && s.players.some((p) => p.isHost && !p.connected) ? '<button class="secondary compact" data-action="claim-host">Devenir hôte</button>' : ""}</div>
    </header>
    <div class="rm-table" data-rm-count="${groups.length}" aria-label="Table de jeu">
      <div class="rm-table-status">
        ${drawNotice ? `<p class="rm-message rm-draw-notice" role="status">${esc(drawNotice)}</p>` : ""}
        ${hint ? `<p class="rm-message ${s.preview ? "rm-preview" : ""}" role="status">${esc(hint)}</p>` : ""}
      </div>
      ${editable && groups.length === 0 ? '<p class="rm-empty">Glissez vos tuiles ici</p>' : ""}
      <div class="rm-groups">
      ${groups.map((group, row) => {
        const unlocked = editable && group.every(canTouch);
        const gap = (index: number) => `<button type="button" class="rm-gap" data-rm-gap="${row}:${index}" aria-label="${selected.size ? "Insérer" : "Scinder"} au rang ${index + 1} du groupe ${row + 1}" ${unlocked && (selected.size || (index > 0 && index < group.length)) ? "" : "disabled"}>${selected.size ? "+" : "·"}</button>`;
        return `<div class="rm-group-slot">${newTarget(row)}<div data-rm-end="${row}:${group.length}" class="rm-meld ${unlocked && selected.size ? "can-insert" : ""} ${validMeld(group) === null ? "invalid" : ""} ${s.preview ? "is-preview" : ""}">
          <button type="button" class="rm-group" data-rm-group="${row}" aria-label="Déplacer le groupe ${row + 1}" ${unlocked ? "" : "disabled"}>⠿</button>
          ${group.map((tile, index) => `<span class="rm-position" data-rm-position="${row}:${index}">${gap(index)}${card(tile, "board", !unlocked)}</span>`).join("")}${gap(group.length)}
        </div></div>`;
      }).join("")}
      ${newTarget(groups.length, true)}
      </div>
    </div>
    <div class="rm-dock">
      <div class="rm-toolbar">
        <button class="secondary compact rm-deck" data-action="draw" ${editable ? "" : "disabled"} aria-label="${s.deckCount ? `Piocher et passer · ${s.deckCount} tuiles restantes` : "Passer · pioche vide"}">
          <span aria-hidden="true">▥</span><strong>${s.deckCount}</strong> ${editable ? s.deckCount ? "Piocher" : "Passer" : "Pioche"}
        </button>
        <button class="secondary compact" data-action="undo" ${editable && undoStack.length ? "" : "disabled"}>Annuler</button>
        <button class="secondary compact" data-action="reset" ${editable && draft ? "" : "disabled"}>Rétablir</button>
        <button class="secondary compact" data-action="sort" aria-label="Trier le chevalet par ${sort === "color" ? "valeur" : "couleur"}">Trier</button>
        <button class="compact" data-action="validate" ${canValidate ? "" : "disabled"}>Valider</button>
      </div>
      <div class="rm-rack" aria-label="Votre chevalet">${rackTiles().map((tile) => card(tile, "hand", !ready || busy)).join("")}</div>
    </div>
  </section>`;
}
function markDraw(draw: RummikubDraw) {
  const name = state!.players.find((player) => player.id === draw.playerId)?.name ?? "Un joueur";
  const mine = draw.playerId === state!.you?.id;
  drawNotice = `${draw.timedOut ? "Temps écoulé · " : ""}${mine
    ? draw.drewTile ? "Vous avez pioché." : "Vous avez passé."
    : `${name} ${draw.drewTile ? "a pioché." : "a passé."}`}`;
  window.clearTimeout(drawNoticeTimer);
  drawNoticeTimer = window.setTimeout(() => {
    drawNotice = "";
    document.querySelector(".rm-draw-notice")?.remove();
  }, 3600);
}
function animateDraw(playerId: string) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const deck = document.querySelector(".rm-deck");
  const recipient = playerId === state?.you?.id ? document.querySelector(".rm-rack")
    : document.querySelector(`[data-rm-player="${CSS.escape(playerId)}"]`);
  if (!deck || !recipient) return;
  const from = deck.getBoundingClientRect();
  const to = recipient.getBoundingClientRect();
  flyingTile?.remove();
  const tile = document.createElement("div");
  flyingTile = tile;
  tile.className = "rm-flying-tile";
  tile.textContent = "▥";
  tile.setAttribute("aria-hidden", "true");
  document.body.append(tile);
  const animation = tile.animate([
    { transform: `translate(${from.x + from.width / 2}px, ${from.y}px) scale(.7)` },
    { transform: `translate(${to.x + to.width / 2}px, ${to.y}px) scale(1.05)`, offset: .8 },
    { transform: `translate(${to.x + to.width / 2}px, ${to.y}px) scale(.8)`, opacity: 0 },
  ], { duration: 550, easing: "ease-in-out" });
  animation.onfinish = () => { tile.remove(); if (flyingTile === tile) flyingTile = null; };
}
function canTouch(tile: Card): boolean {
  return (
    !!state?.players.find((p) => p.id === state?.you?.id)?.opened ||
    !!state?.hand.some((t) => t.id === tile.id)
  );
}
function validMeld(m: Card[]): number | null {
  if (m.length < 3 || m.length > 13) return null;
  const normal = m.filter((t) => !t.joker);
  if (!normal.length) return null;
  if (
    m.length <= 4 &&
    normal.every((t) => t.value === normal[0].value) &&
    new Set(normal.map((t) => t.color)).size === normal.length
  )
    return normal[0].value * m.length;
  const index = m.findIndex((t) => !t.joker),
    start = m[index].value - index;
  if (
    start < 1 ||
    start + m.length - 1 > 13 ||
    !normal.every((t) => t.color === normal[0].color) ||
    !m.every((t, i) => t.joker || t.value === start + i)
  )
    return null;
  return m.reduce((sum, _, i) => sum + start + i, 0);
}
function canPlaceGroup(tiles: Card[]): boolean {
  if (tiles.length >= 3) return validMeld(tiles) !== null;
  const [first, second] = tiles;
  if (!second || first.joker || second.joker) return true;
  if (first.value === second.value) return first.color !== second.color;
  return first.color === second.color && second.value - first.value >= 1 && second.value - first.value <= 2;
}
function rules(): string {
  return `<section class="rules">${game === "odin" ? "<p>9 cartes par joueur. Ouvrez avec une carte, puis posez une combinaison de même couleur ou même valeur, de valeur supérieure : même nombre de cartes ou une de plus. Les chiffres forment le plus grand nombre possible (8 et 2 = 82).</p><p>Après une pose, récupérez une carte de la table précédente, sauf si vous videz votre main. Passer n’empêche pas de rejouer plus tard. Quand tous les autres passent, le dernier à jouer ouvre le pli suivant.</p><p>Une main vidée ou entièrement de même couleur/valeur à l’ouverture d’un pli termine la manche. Les autres marquent un point par carte. À la limite de score, le plus petit total gagne.</p>" : '<p>106 tuiles, dont 2 jokers. Chacun reçoit 14 tuiles. Posez des groupes de 3 ou 4 valeurs identiques de couleurs différentes, ou des suites d’au moins 3 valeurs consécutives de même couleur. Le 1 ne suit jamais le 13.</p><p>Votre première pose doit valoir au moins 30 points, uniquement avec votre chevalet. Vous pourrez réorganiser la table aux tours suivants. Un joker représente la tuile qu’il remplace ; il reste sur la table et peut être réutilisé dans une combinaison valide.</p><p>Chaque tour : posez au moins une tuile, ou piochez et passez. Toutes les combinaisons doivent être valides en fin de tour. Videz votre chevalet pour gagner. Un joker restant coûte 30 points. Si la pioche est vide et tout le monde passe, le plus petit chevalet gagne.</p><p>Glissez une tuile sur un groupe pour l’ajouter ou sur la table pour créer un groupe. Vous pouvez aussi sélectionner des tuiles puis cliquer sur le groupe. Cliquez sur la première tuile d’une suite du chevalet pour sélectionner la suite entière. Maj + clic permet de sélectionner les tuiles une à une. Le bouton + crée un groupe avec la sélection. La poignée déplace un groupe entier et le point entre deux tuiles le scinde. Les autres joueurs voient vos poses provisoires. « Annuler » revient d’un geste en arrière et « Valider » termine le tour.</p><a href="https://rummikub.com/rules/" target="_blank" rel="noopener">Consulter les règles classiques officielles ↗</a>'}</section>`;
}
function ranking(): string {
  return `<section class="ranking"><div class="section-heading"><span></span><button class="text" data-action="refresh-ranking">Actualiser ↻</button></div><p class="muted">Profil enregistré dans ce navigateur.</p>${rankingLoading ? '<p role="status">Chargement…</p>' : rankingError ? `<p role="alert">${esc(rankingError)}</p>` : rankings.length ? `<div class="ranking-scroll"><table><thead><tr><th>Place</th><th>Joueur</th><th>Elo</th><th>Victoires</th><th>Parties</th></tr></thead><tbody>${rankings.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td><strong>${r.rating}</strong></td><td>${r.wins}${r.draws ? ` (+${r.draws} ex æquo)` : ""}</td><td>${r.played}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-ranking">Aucune partie terminée.</div>'}</section>`;
}
function render() {
  const rummikubPlaying = siteUnlocked && state?.game === "rummikub" && state.phase === "playing";
  const currentBoard = rummikubPlaying ? state!.preview ?? board() : undefined;
  const boardUnchanged = !!currentBoard && !!renderedBoard && sameBoard(currentBoard, renderedBoard);
  const previousLayout = boardUnchanged ? boardFit?.layout() : undefined;
  renderedBoard = currentBoard;
  boardFit?.disconnect();
  boardFit = undefined;
  const oldStage = content.querySelector(".rm-stage");
  const previousTiles = new Map<string, DOMRect>();
  if (oldStage && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    for (const tile of oldStage.querySelectorAll<HTMLElement>("[data-tile]")) {
      if (boardUnchanged && tile.dataset.source === "board") continue;
      previousTiles.set(tile.dataset.tile!, tile.getBoundingClientRect());
    }
  if (!rummikubPlaying) cancelRummikubDrag?.();
  document.body.classList.toggle("rummikub-playing", rummikubPlaying);
  document.body.classList.toggle("in-game", !!state && state.phase === "playing" && siteUnlocked);
  if (!siteUnlocked) {
    content.innerHTML = accessChecking
      ? '<section class="panel access-panel"><p role="status">Chargement…</p></section>'
      : accessUnavailable
        ? `<section class="panel access-panel"><h2>Serveur indisponible</h2><p>${esc(accessError)}</p><button data-action="retry-access">Réessayer</button></section>`
        : `<section class="panel access-panel"><form id="access-form"><label>Mot de passe<input id="site-password" type="password" autocomplete="current-password" required maxlength="1024" ${accessPending ? "disabled" : ""}></label>${accessError ? `<p class="access-error" role="alert">${esc(accessError)}</p>` : ""}<button type="submit" ${accessPending ? "disabled" : ""}>${accessPending ? "Connexion…" : "Se connecter"}</button></form></section>`;
    connection();
    return;
  }
  const focused = document.activeElement as HTMLInputElement | null;
  const id = focused?.id;
  const range =
    focused?.tagName === "INPUT" && focused.type === "text"
      ? focused.selectionStart
      : null;
  const customValue = id === "custom-turn-seconds" ? focused?.value : undefined;
  const focusedTile = focused?.dataset.tile;
  const focusedSource = focused?.dataset.source;
  content.innerHTML = `${state ? room() : home()}${rummikubPlaying ? "" : `<nav class="bottom-nav" aria-label="Informations"><button class="text" data-action="rules" aria-haspopup="dialog">Règles</button><button class="text" data-action="ranking" aria-haspopup="dialog">Classement</button>${!state ? `<button class="text" data-action="sound" aria-pressed="${soundEnabled()}">${soundEnabled() ? "Son activé" : "Son coupé"}</button>` : ""}</nav>`}`;
  if (rulesOpen || rankingsOpen) {
    const infoBody = document.querySelector<HTMLElement>("#info-body")!;
    const html = rulesOpen ? rules() : ranking();
    if (infoBody.innerHTML !== html) infoBody.innerHTML = html;
    document.querySelector<HTMLElement>("#info-title")!.textContent = rulesOpen ? `Règles · ${names[game]}` : `Classement · ${names[game]}`;
  }
  if (id) {
    const next = document.getElementById(id) as HTMLInputElement;
    if (next && customValue !== undefined) next.value = customValue;
    next?.focus({ preventScroll: true });
    if (range !== null) next?.setSelectionRange(range, range);
  }
  if (!id && focusedTile && focusedSource)
    document
      .querySelector<HTMLElement>(
        `[data-tile="${CSS.escape(focusedTile)}"][data-source="${CSS.escape(focusedSource)}"]`,
      )
      ?.focus({ preventScroll: true });
  connection();
  updateClock();
  const stage = content.querySelector<HTMLElement>(".rm-stage");
  if (stage) {
    boardFit = fitRummikub(stage, previousLayout);
    for (const tile of stage.querySelectorAll<HTMLElement>("[data-tile]")) {
      const from = previousTiles.get(tile.dataset.tile!);
      if (!from) continue;
      const to = tile.getBoundingClientRect();
      const dx = from.x - to.x, dy = from.y - to.y;
      if (Math.hypot(dx, dy) > 3)
        tile.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 160, easing: "ease-out" });
    }
  }
}
function pushUndo() {
  undoStack.push(board().map((m) => [...m]));
  if (undoStack.length > 50) undoStack.shift();
}
function publishDraft() {
  if (!state || state.game !== "rummikub" || !yourTurn() || !socket.connected) return;
  socket.emit("previewMelds", {
    roomId: state.roomId,
    revision: state.revision,
    melds: draft ? tileIds(draft) : null,
  });
}
function applyDraft(next: Card[][]) {
  if (!state || sameBoard(next, board())) return;
  pushUndo();
  draft = sameBoard(next, state.melds) ? null : next;
  selected.clear();
  if (draft) persistDraft(); else clearDraft();
  publishDraft();
  render();
}
function insertInGroup(group: Card[], moving: Card[], preferred: number, autoPlace: boolean): Card[] | undefined {
  const at = (index: number) => [...group.slice(0, index), ...moving, ...group.slice(index)];
  const preferredGroup = at(preferred);
  if (canPlaceGroup(preferredGroup)) return preferredGroup;
  if (!autoPlace) return;

  for (let distance = 1; distance <= group.length; distance++) {
    for (const index of [preferred - distance, preferred + distance]) {
      if (index < 0 || index > group.length) continue;
      const candidate = at(index);
      if (canPlaceGroup(candidate)) return candidate;
    }
  }
}
function placeTiles(ids: string[], target: DropTarget) {
  if (!ready || busy || !state || state.phase !== "playing" || !ids.length) return;
  if (target.kind !== "rack" && !yourTurn()) return;
  const before = board();
  const hand = new Set(state.hand.map((tile) => tile.id));
  const lookup = new Map([...state.hand, ...before.flat()].map((tile) => [tile.id, tile]));
  const moving = ids.map((id) => lookup.get(id)).filter((tile): tile is Card => !!tile);
  const movingIds = new Set(moving.map((tile) => tile.id));
  if (!moving.length || moving.some((tile) => !canTouch(tile))) return;
  if (target.kind === "meld" && !before[target.row]?.every(canTouch)) {
    notify("Posez d’abord 30 points dans un nouveau groupe.");
    return;
  }
  if (target.kind === "rack" && moving.some((tile) => !hand.has(tile.id))) {
    notify("Les tuiles des tours précédents restent sur la table.");
    return;
  }
  const next = before.map((group) => group.filter((tile) => !movingIds.has(tile.id)));
  if (target.kind === "meld") {
    const insertAt = before[target.row].slice(0, target.index).filter((tile) => !movingIds.has(tile.id)).length;
    const group = next[target.row];
    const inserted = insertInGroup(group, moving, insertAt, group.length + moving.length > before[target.row].length);
    if (!inserted) {
      notify("Cette pose ne forme pas une combinaison valide.");
      return;
    }
    next[target.row] = inserted;
  } else if (target.kind === "new") {
    const fromRack = moving.every((tile) => !before.some((group) => group.some((item) => item.id === tile.id)));
    const ordered = fromRack ? orderNewGroup(moving) : moving;
    if (!canPlaceGroup(ordered)) {
      notify("Cette pose ne forme pas une combinaison valide.");
      return;
    }
    next.splice(target.index, 0, ordered);
  } else {
    const currentRack = rackTiles();
    const index = target.before ? currentRack.findIndex((tile) => tile.id === target.before) : currentRack.length;
    const insertion = currentRack.slice(0, index < 0 ? currentRack.length : index).filter((tile) => !movingIds.has(tile.id)).length;
    const remaining = currentRack.filter((tile) => !movingIds.has(tile.id));
    remaining.splice(insertion, 0, ...moving);
    rackOrder = remaining.map((tile) => tile.id);
    selected.clear();
    if (sameBoard(next.filter((group) => group.length), before)) { render(); return; }
  }
  applyDraft(next.filter((group) => group.length));
}
function orderNewGroup(tiles: Card[]): Card[] {
  if (validMeld(tiles) !== null) return tiles;
  const normal = tiles.filter((tile) => !tile.joker).sort((a, b) => a.value - b.value);
  if (!normal.length || !normal.every((tile) => tile.color === normal[0].color) ||
    new Set(normal.map((tile) => tile.value)).size !== normal.length) return tiles;
  const last = normal[normal.length - 1].value;
  const start = Math.max(1, last - tiles.length + 1);
  if (start > normal[0].value || start + tiles.length - 1 > 13) return tiles;
  const jokers = tiles.filter((tile) => tile.joker);
  return Array.from({ length: tiles.length }, (_, i) =>
    normal.find((tile) => tile.value === start + i) ?? jokers.shift()!,
  );
}
function draftKey() {
  return state ? `odin-draft-${state.roomId}` : "";
}
function clearDraft() {
  if (state)
    try {
      sessionStorage.removeItem(draftKey());
    } catch {
      /* optional */
    }
}
function persistDraft() {
  if (state && draft)
    try {
      sessionStorage.setItem(
        draftKey(),
        JSON.stringify({
          current: state.currentPlayerId,
          round: state.round,
          table: state.melds.map((m) => m.map((t) => t.id)),
          hand: state.hand.map((t) => t.id),
          draft: draft.map((m) => m.map((t) => t.id)),
        }),
      );
    } catch {
      /* live draft remains usable */
    }
}
function restoreDraft() {
  if (game !== "rummikub" || !yourTurn() || !state) return;
  try {
    const data = JSON.parse(sessionStorage.getItem(draftKey()) || "null");
    if (
      !data ||
      data.current !== state.currentPlayerId ||
      data.round !== state.round ||
      JSON.stringify(data.table) !==
        JSON.stringify(state.melds.map((m) => m.map((t) => t.id))) ||
      JSON.stringify(data.hand) !== JSON.stringify(state.hand.map((t) => t.id))
    )
      return;
    const all = new Map(
      [...state.hand, ...state.melds.flat()].map((t) => [t.id, t]),
    );
    if (
      Array.isArray(data.draft) &&
      data.draft.flat().every((id: string) => all.has(id))
    ) {
      if (JSON.stringify(data.draft) === JSON.stringify(data.table)) clearDraft();
      else draft = data.draft.map((m: string[]) => m.map((id) => all.get(id)!));
    }
  } catch {
    /* ignore a stale draft */
  }
}
function suggest() {
  if (!state || !yourTurn()) return;
  const hand = sorted(state.hand);
  let found: Card[] | null = null;
  for (let mask = 1; mask < 2 ** hand.length; mask++) {
    const c = hand.filter((_, i) => mask & (1 << i));
    const last = state.lastPlay;
    if (
      !c.every((t) => t.color === c[0].color) &&
      !c.every((t) => t.value === c[0].value)
    )
      continue;
    if (
      state.leaderRequired
        ? c.length !== 1
        : !last ||
          ![last.count, last.count + 1].includes(c.length) ||
          Number(
            c
              .map((t) => t.value)
              .sort((a, b) => b - a)
              .join(""),
          ) <= last.value
    )
      continue;
    if (!found || c.length > found.length) found = c;
  }
  if (!found) return notify("Pas de combinaison jouable : vous pouvez passer.");
  selected = new Set(found.map((t) => t.id));
  render();
}
async function loadRankings() {
  if (!ready || rankingLoading) return;
  const requestedGame = game;
  rankingLoading = true;
  rankingError = "";
  render();
  try {
    const result = await socket.timeout(10000).emitWithAck("getLeaderboard", { game: requestedGame });
    if (requestedGame !== game) return;
    if (result.ok) rankings = result.rows;
    else rankingError = result.message || "Classement indisponible.";
  } catch {
    rankingError = "Classement indisponible. Réessayez.";
  } finally {
    rankingLoading = false;
    render();
  }
}
async function unlockAdmin() {
  if (adminPending || !ready) return;
  const password =
    document.querySelector<HTMLInputElement>("#admin-password")!.value;
  const error = document.querySelector<HTMLElement>("#admin-error")!;
  const button = document.querySelector<HTMLButtonElement>(
    '#admin-form button[type="submit"]',
  )!;
  adminPending = true;
  button.disabled = true;
  error.textContent = "";
  try {
    const response = await fetch(`${serverUrl}/auth/admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${read("odin-site-access") || ""}`,
      },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) {
      error.textContent = result.message || "Accès refusé.";
      return;
    }
    save("odin-admin-access", result.accessToken);
    document.querySelector<HTMLDialogElement>("#admin-dialog")!.close();
    document.querySelector<HTMLInputElement>("#admin-password")!.value = "";
    openPhotosAfterAdmin = true;
    socket.disconnect();
    socket.connect();
  } catch {
    error.textContent = "Connexion impossible.";
  } finally {
    adminPending = false;
    button.disabled = false;
  }
}
async function bootstrapAccess() {
  accessChecking = true;
  accessUnavailable = false;
  render();
  try {
    const token = read("odin-site-access");
    const response = await fetch(`${serverUrl}/auth`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Le serveur ne répond pas.");
    const status = await response.json();
    siteUnlocked = !status.required || status.authorized;
    if (siteUnlocked) socket.connect();
  } catch {
    accessUnavailable = true;
    accessError =
      "Impossible de joindre le serveur. Réessayez dans quelques secondes.";
  } finally {
    accessChecking = false;
    render();
  }
}
async function unlockSite() {
  if (accessPending) return;
  const password =
    document.querySelector<HTMLInputElement>("#site-password")?.value;
  if (!password) return;
  accessPending = true;
  accessError = "";
  render();
  try {
    const response = await fetch(`${serverUrl}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) {
      accessError = result.message || "Connexion refusée.";
      return;
    }
    if (result.accessToken) save("odin-site-access", result.accessToken);
    siteUnlocked = true;
    socket.connect();
  } catch {
    accessError = "Impossible de joindre le serveur. Réessayez.";
  } finally {
    accessPending = false;
    render();
  }
}
async function askConfirmation(message: string): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>("#confirm-dialog")!;
  document.querySelector("#confirm-text")!.textContent = message;
  return new Promise((resolve) => {
    confirmResolve = resolve;
    dialog.showModal();
  });
}
function finishConfirmation(value: boolean) {
  document.querySelector<HTMLDialogElement>("#confirm-dialog")!.close();
  confirmResolve?.(value);
  confirmResolve = null;
}
async function action(name: string) {
  switch (name) {
    case "sound":
      toggleSound();
      render();
      return;
    case "admin":
      if (!ready) return;
      if (isAdmin) {
        photoEditor.open(photoLibrary, 13);
        return;
      }
      document.querySelector<HTMLElement>("#admin-error")!.textContent = "";
      document.querySelector<HTMLDialogElement>("#admin-dialog")!.showModal();
      return;
    case "admin-close":
      document.querySelector<HTMLDialogElement>("#admin-dialog")!.close();
      return;
    case "retry-access":
      await bootstrapAccess();
      return;
    case "confirm-yes":
      finishConfirmation(true);
      return;
    case "confirm-no":
      finishConfirmation(false);
      return;
    case "create":
    case "join":
      if (!playerName.trim()) return notify("Choisissez votre pseudo.");
      save("odin-name", playerName.trim());
      if (name === "join" && !/^\d{4}$/.test(code.trim()))
        return notify("Entrez le code à 4 chiffres.");
      await command(name === "create" ? "createRoom" : "joinRoom", {
        name: playerName.trim(),
        game,
        roomId: code.trim().toUpperCase(),
      });
      return;
    case "start":
      await command("startGame");
      if (rankingsOpen) await loadRankings();
      return;
    case "claim-host":
      await command("claimHost");
      return;
    case "next-round":
      await command("nextRound");
      return;
    case "play":
      if (
        await command("playCards", {
          cardIds: [...selected],
          takeCardId: take ?? undefined,
        })
      ) {
        selected.clear();
        take = null;
        render();
      }
      return;
    case "pass":
      await command("pass");
      return;
    case "draw": {
      const turnRevision = state?.revision;
      if (
        draft &&
        !(await askConfirmation(
          "Rétablir la table, puis piocher et terminer votre tour ?",
        ))
      )
        return;
      if (yourTurn() && state?.revision === turnRevision) await command("drawTile");
      return;
    }
    case "validate":
      if (
        await command("submitMelds", {
          melds: board().map((m) => m.map((t) => t.id)),
        })
      ) {
        draft = null;
        undoStack = [];
        clearDraft();
      }
      return;
    case "undo": {
      const previous = undoStack.pop() ?? null;
      draft = previous && state && sameBoard(previous, state.melds) ? null : previous;
      selected.clear();
      if (draft) persistDraft(); else clearDraft();
      publishDraft();
      render();
      return;
    }
    case "reset":
      draft = null;
      undoStack = [];
      selected.clear();
      clearDraft();
      publishDraft();
      render();
      return;
    case "clear":
      selected.clear();
      take = null;
      render();
      return;
    case "sort":
      rackOrder = [];
      sort = sort === "color" ? "value" : "color";
      render();
      return;
    case "photos":
      photosVisible = !photosVisible;
      save("odin-photos", photosVisible ? "on" : "off");
      render();
      return;
    case "suggest":
      suggest();
      return;
    case "rules":
    case "ranking": {
      rulesOpen = name === "rules";
      rankingsOpen = name === "ranking";
      if (rankingsOpen) { rankings = []; rankingError = ""; }
      render();
      const dialog = document.querySelector<HTMLDialogElement>("#info-dialog")!;
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLButtonElement>(".info-close")?.focus();
      if (rankingsOpen) await loadRankings();
      return;
    }
    case "close-info":
      document.querySelector<HTMLDialogElement>("#info-dialog")!.close();
      return;
    case "refresh-ranking":
      await loadRankings();
      return;
    case "apply-custom-turn": {
      const input = document.querySelector<HTMLInputElement>("#custom-turn-seconds");
      const value = input?.valueAsNumber;
      if (value === undefined || !Number.isInteger(value) || value < 1 || value > 3600) {
        notify("Choisissez une durée entre 1 et 3600 secondes.");
        input?.focus();
        return;
      }
      await command("updateSettings", { settings: { turnSeconds: value } });
      return;
    }
    case "leave":
      if (
        (state?.phase === "playing" || state?.phase === "round_end") &&
        !(await askConfirmation(
          "Abandonner cette partie ? Pour faire une pause, vous pouvez simplement fermer la page et revenir.",
        ))
      )
        return;
      await command("leaveRoom");
      return;
    case "invite": {
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set("room", state!.roomId);
      try {
        await navigator.clipboard.writeText(url.toString());
        notify("Lien d’invitation copié.");
      } catch {
        notify(
          `Copie indisponible. Partagez le code ${state!.roomId} avec votre partenaire.`,
        );
      }
      return;
    }
    case "reconnect":
      replaced = false;
      socket.connect();
      return;
  }
}
app.addEventListener("submit", (event) => {
  if ((event.target as HTMLElement).id === "admin-form") {
    event.preventDefault();
    void unlockAdmin();
    return;
  }
  if ((event.target as HTMLElement).id === "access-form") {
    event.preventDefault();
    void unlockSite();
  }
});
app.addEventListener("input", (event) => {
  const t = event.target as HTMLInputElement;
  if (t.id === "player-name") playerName = t.value;
  if (t.id === "room-code") {
    code = t.value.replace(/\D/g, "").slice(0, 4);
    t.value = code;
  }
});
app.addEventListener("change", (event) => {
  const t = event.target as HTMLInputElement;
  if (t.id === "turn-seconds") {
    customTurnSelected = t.value === "custom";
    if (customTurnSelected) {
      render();
      document.querySelector<HTMLInputElement>("#custom-turn-seconds")?.focus();
    } else {
      void command("updateSettings", { settings: { turnSeconds: Number(t.value) } });
    }
    return;
  }
  const keys: Record<string, string> = {
    "max-score": "maxScore",
    "color-count": "colorCount",
  };
  if (keys[t.id])
    void command("updateSettings", {
      settings: { [keys[t.id]]: Number(t.value) },
    });
});
app.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.target as HTMLElement).id === "room-code")
    void action("join");
});
app.addEventListener("click", prepareSound, { once: true });
app.addEventListener("click", (event) => {
  const clicked = event.target as HTMLElement;
  const t = clicked.closest<HTMLElement>("button, .rm-rack, .rm-meld");
  if (!t || (t as HTMLButtonElement).disabled) return;
  if (game === "rummikub" && yourTurn() && !busy && selected.size && !event.shiftKey) {
    const target = meldTarget(clicked, event.detail ? event.clientX : undefined);
    if (target) {
      const group = board()[target.row];
      const addsTiles = group && [...selected].some((id) => !group.some((tile) => tile.id === id));
      if (addsTiles && (!t.dataset.tile || !selected.has(t.dataset.tile))) {
        playSound("select", true);
        placeTiles([...selected], target);
        return;
      }
    }
  }
  if (t.dataset.action) {
    if (["create", "join", "start"].includes(t.dataset.action)) playSound("select", true);
    if (["play", "pass", "draw", "validate", "undo", "reset"].includes(t.dataset.action)) playSound("action", true);
    void action(t.dataset.action);
    return;
  }
  if (t.dataset.game && !state) {
    game = t.dataset.game as GameType;
    rankings = [];
    render();
    if (rankingsOpen) void loadRankings();
    return;
  }
  if (t.dataset.tile && yourTurn() && !busy) {
    playSound("select", true);
    if (t.dataset.source === "take")
      take = take === t.dataset.tile ? null : t.dataset.tile;
    else if (game === "rummikub" && t.dataset.source === "hand") {
      const run = event.shiftKey ? [] : rackRun(t.dataset.tile);
      if (run.length) {
        const alreadySelected = run.every((id) => selected.has(id));
        for (const id of run) {
          if (alreadySelected) selected.delete(id);
          else selected.add(id);
        }
      }
      else if (selected.has(t.dataset.tile)) selected.delete(t.dataset.tile);
      else selected.add(t.dataset.tile);
    } else {
      if (selected.has(t.dataset.tile)) selected.delete(t.dataset.tile);
      else if (game === "odin" && state?.leaderRequired)
        selected = new Set([t.dataset.tile]);
      else selected.add(t.dataset.tile);
    }
    render();
    return;
  }
  if (t.dataset.rmGap) {
    const [row, index] = t.dataset.rmGap.split(":").map(Number);
    const group = board()[row];
    if (selected.size) placeTiles([...selected], { kind: "meld", row, index });
    else if (yourTurn() && !busy && group?.every(canTouch) && index > 0 && index < group.length) {
      const next = [...board()];
      next.splice(row, 1, group.slice(0, index), group.slice(index));
      applyDraft(next);
    }
    return;
  }
  if (t.dataset.rmNew !== undefined) {
    placeTiles([...selected], { kind: "new", index: Number(t.dataset.rmNew) });
    return;
  }
  if (t.dataset.rmGroup !== undefined && yourTurn()) {
    const group = board()[Number(t.dataset.rmGroup)];
    if (group?.every(canTouch)) {
      selected = group.every((tile) => selected.has(tile.id)) ? new Set() : new Set(group.map((tile) => tile.id));
      render();
    }
    return;
  }
  if (t.dataset.remove)
    void askConfirmation(
      "Retirer ce joueur déconnecté ? Il abandonnera la partie en cours.",
    ).then((ok) => {
      if (ok) void command("removeOffline", { playerId: t.dataset.remove });
    });
  if (t.classList.contains("rm-rack") && selected.size)
    placeTiles([...selected], { kind: "rack" });
});
cancelRummikubDrag = enableTileDragging(app, (element) => {
  if (!ready || busy || game !== "rummikub") return [];
  const id = element.dataset.tile;
  if (!yourTurn()) return id && element.dataset.source === "hand" ? [id] : [];
  if (id) return selected.has(id) ? [...selected] : [id];
  return board()[Number(element.dataset.rmGroup)]?.map((tile) => tile.id) ?? [];
}, (ids, target) => {
  playSound("select", true);
  placeTiles(ids, target);
});
document.querySelector("#info-dialog")!.addEventListener("close", () => {
  const previous = rulesOpen ? "rules" : "ranking";
  rulesOpen = false;
  rankingsOpen = false;
  document.querySelector<HTMLButtonElement>(`[data-action="${previous}"]`)?.focus({ preventScroll: true });
});
document.querySelector("#confirm-dialog")!.addEventListener("cancel", () => {
  confirmResolve?.(false);
  confirmResolve = null;
});
function updateClock() {
  const el = document.querySelector<HTMLElement>("#timer");
  if (!el || !state) return;
  const duration = state.settings.turnSeconds;
  const remainingMs = state.deadline === null ? null : Math.max(0, state.deadline - (Date.now() + clockOffset));
  const remaining = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const turn = el.closest<HTMLElement>(".rm-turn")!;
  const urgent = remaining !== null && remaining > 0 && remaining <= 10 && !state.paused;
  const text = state.paused ? "Pause" : remaining === null ? "Sans limite" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  if (el.textContent !== text) el.textContent = text;
  turn.classList.toggle("urgent", urgent);
  turn.style.setProperty("--remaining", String(remainingMs !== null && duration > 0 ? Math.min(1, remainingMs / (duration * 1000)) : 1));
  if (!urgent || !yourTurn() || document.hidden) return;
  const turnKey = `${state.roomId}:${state.round}:${state.currentPlayerId}:${state.deadline}`;
  if (warnedTurn !== turnKey) {
    warnedTurn = turnKey;
    lastTick = 0;
    navigator.vibrate?.([80, 60, 80]);
  }
  if (lastTick !== remaining) {
    lastTick = remaining;
    playSound("tick");
  }
}
setInterval(updateClock, 150);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && socket.connected && ready) socket.emit("sync");
});
render();
void loadBackground();
void bootstrapAccess();
