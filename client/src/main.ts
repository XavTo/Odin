import "./style.css";
import { PhotoEditor, photoFor } from "./photo-editor";
import type { Photos } from "./photo-editor";
import { io } from "socket.io-client";
import type {
  Card,
  CardColor,
  GameStats,
  GameType,
  PublicGameState,
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
let sort: "color" | "value" = "color";
let photoLibrary: Photos = {};
let isAdmin = false;
let adminPending = false;
let openPhotosAfterAdmin = false;
let photosVisible = read("odin-photos") !== "off";
let rulesOpen = false,
  rankingsOpen = false;
let rankings: Array<{ id: string; name: string } & GameStats> = [];
let toastTimer = 0;
let clockOffset = 0;
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
app.innerHTML = `<div class="app-shell"><header class="hero"><img src="/peru-anniversary-ornament.png" alt="" class="ornament"><div><h1>Odin &amp; Rummikub</h1></div><img src="/peru-anniversary-ornament.png" alt="" class="ornament right"></header><div id="connection" role="status" aria-live="polite"></div><main id="content"></main></div><div id="toast" role="status" aria-live="polite"></div><dialog id="confirm-dialog"><h2>Confirmer l’action</h2><p id="confirm-text"></p><div class="actions"><button class="secondary" data-action="confirm-no">Annuler</button><button data-action="confirm-yes">Confirmer</button></div></dialog><dialog id="admin-dialog"><form id="admin-form"><h2>Administration</h2><label>Mot de passe administrateur<input id="admin-password" type="password" autocomplete="current-password" required maxlength="1024"></label><p id="admin-error" role="alert"></p><div class="actions"><button type="button" class="secondary" data-action="admin-close">Annuler</button><button type="submit">Se connecter</button></div></form></dialog>`;
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
function applyBackground() {
  const url = photoLibrary.background || "/peru-anniversary-bg.png";
  document.documentElement.style.setProperty("--app-background", `url("${url}")`);
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
  const sameTurn =
    state?.roomId === next.roomId &&
    state.currentPlayerId === next.currentPlayerId &&
    state.round === next.round &&
    state.phase === next.phase &&
    JSON.stringify(state.melds) === JSON.stringify(next.melds) &&
    state.hand.map((t) => t.id).join() === next.hand.map((t) => t.id).join();
  if (!sameTurn) {
    selected.clear();
    take = null;
    draft = null;
    undoStack = [];
    clearDraft();
  }
  state = next;
  game = next.game;
  clockOffset = next.serverNow - Date.now();
  if (sameTurn && draft) persistDraft();
  if (!draft) restoreDraft();
  const handIds = new Set(next.hand.map((c) => c.id));
  if (next.game === "odin")
    selected = new Set([...selected].filter((id) => handIds.has(id)));
  if (take && !next.table.some((c) => c.id === take)) take = null;
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
    !tile.joker && photosVisible
      ? photoFor(state?.settings.photos ?? {}, tile.value, game)
      : "";
  return `<button type="button" class="tile ${game === "odin" ? "odin-card" : ""} color-${tile.color} ${selected.has(tile.id) || (source === "take" && take === tile.id) ? "selected" : ""} ${photo ? "photo" : ""}" data-tile="${esc(tile.id)}" data-source="${source}" aria-label="${tile.joker ? "Joker" : `${tile.value} ${colors[tile.color]}`}" aria-pressed="${selected.has(tile.id) || (source === "take" && take === tile.id)}" ${disabled ? "disabled" : ""} draggable="${yourTurn() && game === "rummikub" && !disabled}">${photo ? `<img src="${esc(photo)}" alt="" draggable="false">` : ""}<span class="tile-number">${tile.joker ? "★" : tile.value}</span><span class="tile-color">${tile.joker ? "Joker" : colors[tile.color]}</span></button>`;
}
function players(): string {
  return `<div class="players">${state!.players.map((p) => `<article class="player ${p.isCurrent ? "current" : ""} ${p.forfeited ? "forfeited" : ""}"><span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span><div><strong>${esc(p.name)}${p.id === state!.you?.id ? " <small>(vous)</small>" : ""}</strong><p>${p.forfeited ? "A abandonné" : !p.connected ? "Reconnexion attendue" : p.isCurrent ? "À son tour" : p.isHost ? "Hôte de la salle" : "À la table"} · ${p.handCount} ${game === "odin" ? "cartes" : "tuiles"}</p><small>${p.score} points${game === "rummikub" ? (p.opened ? " · Première pose faite" : " · Première pose à faire") : p.passed ? " · A passé" : ""}</small></div>${host() && !p.connected && !p.forfeited ? `<button class="text danger" data-remove="${p.id}">Retirer</button>` : ""}</article>`).join("")}</div>`;
}
function gameChoices(): string {
  return `<div class="game-choices" role="group" aria-label="Choisir le jeu"><button class="game-choice ${game === "odin" ? "active" : ""}" data-game="odin" aria-pressed="${game === "odin"}"><div class="game-art odin-art"><span>8</span><span>9</span></div><div><span class="eyebrow">2 à 6 joueurs · Cartes</span><h2>Odin</h2><p>9 cartes par joueur.<br>Le plus petit score gagne.</p></div><span class="choose">${game === "odin" ? "Sélectionné ✓" : "Choisir Odin →"}</span></button><button class="game-choice ${game === "rummikub" ? "active" : ""}" data-game="rummikub" aria-pressed="${game === "rummikub"}"><div class="game-art rummi-art"><span>11</span><span>12</span><span>13</span></div><div><span class="eyebrow">2 à 4 joueurs · Tuiles</span><h2>Rummikub</h2><p>14 tuiles par joueur.<br>Première pose de 30 points.</p></div><span class="choose">${game === "rummikub" ? "Sélectionné ✓" : "Choisir Rummikub →"}</span></button></div>`;
}
function home(): string {
  return `${gameChoices()}<section class="panel home-join"><div><h2>Salle</h2></div><div class="join-form"><label>Pseudo<input id="player-name" autocomplete="nickname" maxlength="24" placeholder="Pseudo" value="${esc(playerName)}"></label><button data-action="create" ${!ready || busy ? "disabled" : ""}>Créer une salle <span>→</span></button><div class="join-code"><input id="room-code" aria-label="Code de la salle" placeholder="0000" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" value="${esc(code)}"><button class="secondary" data-action="join" ${!ready || busy ? "disabled" : ""}>Rejoindre</button></div></div></section><button class="admin-entry" data-action="admin" aria-label="Administration" title="Administration" ${!ready ? "disabled" : ""}>⚙</button>`;
}
function settings(): string {
  const s = state!;
  const disabled = !host() || busy || !ready;
  return `<section class="panel"><h3>Options</h3><div class="settings">${game === "odin" ? `<label>Score limite<input type="number" id="max-score" min="5" max="50" value="${s.settings.maxScore}" ${disabled ? "disabled" : ""}></label><label>Couleurs<select id="color-count" ${disabled ? "disabled" : ""}>${[4, 5, 6].map((n) => `<option ${n === s.settings.colorCount ? "selected" : ""}>${n}</option>`).join("")}</select></label><p>${s.effectiveColorCount} couleurs · 9 cartes par joueur.</p>` : `<label>Temps par tour<select id="turn-seconds" ${disabled ? "disabled" : ""}>${[60, 120, 0].map((n) => `<option value="${n}" ${n === s.settings.turnSeconds ? "selected" : ""}>${n ? `${n} secondes` : "Sans limite"}</option>`).join("")}</select></label><p>À la fin du temps : pioche et fin du tour.</p>`}</div>${isAdmin ? `<button class="secondary" data-action="edit-photos" ${!ready || busy ? "disabled" : ""}>Modifier les photos</button>` : ""}</section>`;
}
function room(): string {
  const s = state!;
  return `<div class="room-bar"><div><span class="eyebrow">${names[game]}</span><h2>${s.roomId} <button class="secondary compact" data-action="invite">Copier le lien</button></h2></div><button class="text" data-action="leave" ${!ready || busy ? "disabled" : ""}>${s.phase === "playing" || s.phase === "round_end" ? "Abandonner" : "Quitter la salle"}</button></div>${players()}${!host() && s.players.some((p) => p.isHost && !p.connected) ? '<p class="muted">L’hôte est déconnecté. Après 30 secondes, vous pouvez <button class="text" data-action="claim-host">reprendre le rôle d’hôte</button>.</p>' : ""}${s.phase === "lobby" ? `${settings()}<div class="start-row">${s.players.length < 2 ? "<p>2 joueurs minimum.</p>" : !host() ? "<p>En attente de l’hôte.</p>" : ""}<button data-action="start" ${!host() || !ready || busy || s.players.filter((p) => !p.forfeited).length < 2 || s.players.some((p) => !p.connected) ? "disabled" : ""}>Lancer la partie →</button></div>` : playArea()}`;
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
  const b = board();
  return `<section class="table-panel ${me ? "my-turn" : ""}"><div class="table-heading"><div><span class="eyebrow">${game === "odin" ? `Manche ${s.round}` : `${s.deckCount} tuiles dans la pioche`}</span><h2>${me ? "À vous de jouer" : `Au tour de ${esc(current?.name)}`}</h2>${!current?.connected ? "<p>Joueur déconnecté.</p>" : ""}</div><span class="turn-clock" id="timer"></span></div>${
    game === "odin"
      ? `<div class="odin-table tile-row">${
          s.table.length
            ? sorted(s.table)
                .map((t) =>
                  card(t, "take", !me || busy || s.table.length === 1),
                )
                .join("")
            : '<div class="empty-table"><span aria-hidden="true">✧</span></div>'
        }</div><p class="table-note">${s.table.length === 1 ? "Cette carte est récupérée automatiquement si votre main n’est pas vidée." : s.table.length > 1 ? "Choisissez ici la carte à récupérer. Aucune reprise si vous videz votre main." : ""}</p>`
      : `<div class="rummi-board" data-drop-row="new"><div class="board-help">${s.players.find((p) => p.id === s.you?.id)?.opened ? "Sélectionnez des tuiles, puis une position + pour les déplacer. Le glisser-déposer fonctionne aussi." : "Première pose : au moins 30 points de votre chevalet. La table existante reste intacte."}</div>${b.map((m, row) => `<div class="meld ${validMeld(m) === null ? "invalid" : ""}" data-drop-row="${row}"><span class="meld-label">${row + 1}</span><div class="meld-tiles">${m.map((t, pos) => `${slot(row, pos)}${card(t, "board", !me || busy || !canTouch(t))}`).join("")}${slot(row, m.length)}</div>${me ? `<button class="text compact" data-reverse="${row}" ${busy ? "disabled" : ""} title="Inverser l’ordre">⇄</button>` : ""}<span class="meld-status">${validMeld(m) === null ? "À compléter" : `${validMeld(m)} pts ✓`}</span></div>`).join("") || '<div class="empty-table"><span>✧</span><p>Aucune combinaison sur la table.</p></div>'}</div>`
  }</section><section class="panel rack-panel"><div class="rack-heading"><div><h2>${game === "odin" ? "Votre main" : "Votre chevalet"} <small>${game === "odin" ? s.hand.length : rack().length}</small></h2></div><div class="toolbar">${isAdmin ? '<button class="text" data-action="edit-photos">Modifier les photos</button>' : ""}<button class="text" data-action="sort">Trier par ${sort === "color" ? "valeur" : "couleur"}</button><button class="text" data-action="photos">${photosVisible ? "Masquer" : "Afficher"} les photos</button></div></div><div class="tile-row rack" data-drop-rack="true">${
    sorted(game === "odin" ? s.hand : rack())
      .map((t) => card(t, "hand", !me || busy))
      .join("") || '<p class="muted">Chevalet vide. Validez le tour.</p>'
  }</div><div class="action-bar"><p id="selection-hint" aria-live="polite">${game === "odin" ? odinHint() : selected.size ? `${selected.size} sélectionnée(s)` : draft ? "Brouillon" : ""}</p><div class="actions">${game === "odin" ? `<button class="secondary" data-action="suggest" ${!me || busy ? "disabled" : ""}>Suggestion</button><button class="text" data-action="clear">Désélectionner</button><button class="secondary" data-action="pass" ${!me || busy || s.leaderRequired ? "disabled" : ""}>Passer</button><button data-action="play" ${!me || busy || !odinHint().startsWith("Prêt") ? "disabled" : ""}>Jouer ${selected.size || ""} →</button>` : `<button class="secondary" data-action="new-meld" ${!me || busy || !selected.size ? "disabled" : ""}>Nouvelle combinaison</button><button class="text" data-action="undo" ${!me || busy || !undoStack.length ? "disabled" : ""}>Annuler</button><button class="text" data-action="reset" ${!me || busy || !draft ? "disabled" : ""}>Tout rétablir</button><button class="secondary" data-action="draw" ${!me || busy ? "disabled" : ""}>${s.deckCount ? "Piocher et passer" : "Passer (pioche vide)"}</button><button data-action="validate" ${!me || busy || !draft ? "disabled" : ""}>Valider le tour →</button>`}</div></div></section>`;
}
function slot(row: number, pos: number): string {
  return `<button class="slot" data-place="${row}:${pos}" data-drop-row="${row}" data-drop-pos="${pos}" aria-label="Insérer à la position ${pos + 1} de la combinaison ${row + 1}" ${!yourTurn() || busy || !selected.size ? "disabled" : ""}>+</button>`;
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
function rules(): string {
  return `<section class="panel rules"><h3>Règles</h3>${game === "odin" ? "<p>9 cartes par joueur. Ouvrez avec une carte, puis posez une combinaison de même couleur ou même valeur, de valeur supérieure : même nombre de cartes ou une de plus. Les chiffres forment le plus grand nombre possible (8 et 2 = 82).</p><p>Après une pose, récupérez une carte de la table précédente, sauf si vous videz votre main. Passer n’empêche pas de rejouer plus tard. Quand tous les autres passent, le dernier à jouer ouvre le pli suivant.</p><p>Une main vidée ou entièrement de même couleur/valeur à l’ouverture d’un pli termine la manche. Les autres marquent un point par carte. À la limite de score, le plus petit total gagne.</p>" : '<p>106 tuiles, dont 2 jokers. Chacun reçoit 14 tuiles. Posez des groupes de 3 ou 4 valeurs identiques de couleurs différentes, ou des suites d’au moins 3 valeurs consécutives de même couleur. Le 1 ne suit jamais le 13.</p><p>Votre première pose doit valoir au moins 30 points, uniquement avec votre chevalet. Vous pourrez réorganiser la table aux tours suivants. Un joker représente la tuile qu’il remplace ; il reste sur la table et peut être réutilisé dans une combinaison valide.</p><p>Chaque tour : posez au moins une tuile, ou piochez et passez. Toutes les combinaisons doivent être valides en fin de tour. Videz votre chevalet pour gagner. Un joker restant coûte 30 points. Si la pioche est vide et tout le monde passe, le plus petit chevalet gagne.</p><p>Pour déplacer : sélectionnez une ou plusieurs tuiles, puis cliquez sur + entre deux tuiles ou « Nouvelle combinaison ». Déplacez une tuile vers le chevalet pour reprendre une tuile posée pendant ce tour. « Annuler » revient d’un geste en arrière.</p><a href="https://rummikub.com/rules/" target="_blank" rel="noopener">Consulter les règles classiques officielles ↗</a>'}</section>`;
}
function ranking(): string {
  return `<section class="panel ranking"><div class="section-heading"><div><h2>Classement ${names[game]}</h2></div><button class="text" data-action="refresh-ranking">Actualiser ↻</button></div><p class="muted">Profil enregistré dans ce navigateur.</p>${rankings.length ? `<div class="ranking-scroll"><table><thead><tr><th>Place</th><th>Joueur</th><th>Elo</th><th>Victoires</th><th>Parties</th></tr></thead><tbody>${rankings.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td><strong>${r.rating}</strong></td><td>${r.wins}${r.draws ? ` (+${r.draws} ex æquo)` : ""}</td><td>${r.played}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-ranking">Aucune partie terminée.</div>'}</section>`;
}
function render() {
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
  const focusedTile = focused?.dataset.tile;
  const focusedSource = focused?.dataset.source;
  content.innerHTML = `${state ? room() : home()}<nav class="bottom-nav"><button class="text" data-action="rules" aria-expanded="${rulesOpen}">${rulesOpen ? "Fermer les" : "Voir les"} règles</button><button class="text" data-action="ranking" aria-expanded="${rankingsOpen}">${rankingsOpen ? "Masquer le" : "Voir le"} classement ↗</button></nav>${rulesOpen ? rules() : ""}${rankingsOpen ? ranking() : ""}`;
  if (id) {
    const next = document.getElementById(id) as HTMLInputElement;
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
}
function pushUndo() {
  undoStack.push(board().map((m) => [...m]));
  if (undoStack.length > 50) undoStack.shift();
}
function moveSelected(row: number | "new" | "rack", pos?: number) {
  if (!yourTurn() || busy || !selected.size) return;
  const all = new Map(
    [...(state?.hand ?? []), ...board().flat()].map((t) => [t.id, t]),
  );
  const moving = [...selected]
    .map((id) => all.get(id))
    .filter((t): t is Card => !!t);
  if (moving.some((t) => !canTouch(t)))
    return notify(
      "La table ne peut être réorganisée qu’après la première pose.",
    );
  if (
    row === "rack" &&
    moving.some((t) => !state?.hand.some((h) => h.id === t.id))
  )
    return notify(
      "Les tuiles des tours précédents doivent rester sur la table.",
    );
  pushUndo();
  const before = board();
  let insertion =
    typeof row === "number"
      ? (pos ?? before[row].length) -
        before[row]
          .slice(0, pos ?? before[row].length)
          .filter((t) => selected.has(t.id)).length
      : 0;
  const next = before.map((m) => m.filter((t) => !selected.has(t.id)));
  if (row === "new") next.push(moving);
  else if (typeof row === "number")
    next[row].splice(Math.max(0, insertion), 0, ...moving);
  draft = next.filter((m) => m.length);
  selected.clear();
  persistDraft();
  render();
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
    )
      draft = data.draft.map((m: string[]) => m.map((id) => all.get(id)!));
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
  if (!ready) return;
  try {
    const result = await socket
      .timeout(10000)
      .emitWithAck("getLeaderboard", { game });
    if (result.ok) {
      rankings = result.rows;
      render();
    } else notify(result.message);
  } catch {
    notify("Le classement est momentanément indisponible.");
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
    case "draw":
      if (
        draft &&
        !(await askConfirmation(
          "Rétablir la table, puis piocher et terminer votre tour ?",
        ))
      )
        return;
      await command("drawTile");
      return;
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
    case "new-meld":
      moveSelected("new");
      return;
    case "undo":
      draft = undoStack.pop() ?? null;
      selected.clear();
      persistDraft();
      render();
      return;
    case "reset":
      draft = null;
      undoStack = [];
      selected.clear();
      clearDraft();
      render();
      return;
    case "clear":
      selected.clear();
      take = null;
      render();
      return;
    case "sort":
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
      rulesOpen = !rulesOpen;
      render();
      return;
    case "ranking":
      rankingsOpen = !rankingsOpen;
      render();
      if (rankingsOpen) await loadRankings();
      return;
    case "refresh-ranking":
      await loadRankings();
      return;
    case "edit-photos":
      if (ready && isAdmin)
        photoEditor.open(
          state?.settings.photos ?? photoLibrary,
          state && game === "odin" ? 9 : 13,
        );
      return;
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
  const keys: Record<string, string> = {
    "max-score": "maxScore",
    "color-count": "colorCount",
    "turn-seconds": "turnSeconds",
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
app.addEventListener("click", (event) => {
  const t = (event.target as HTMLElement).closest<HTMLElement>(
    "button, [data-drop-rack]",
  );
  if (!t || (t as HTMLButtonElement).disabled) return;
  if (t.dataset.action) {
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
    if (t.dataset.source === "take")
      take = take === t.dataset.tile ? null : t.dataset.tile;
    else {
      if (selected.has(t.dataset.tile)) selected.delete(t.dataset.tile);
      else if (game === "odin" && state?.leaderRequired)
        selected = new Set([t.dataset.tile]);
      else selected.add(t.dataset.tile);
    }
    render();
    return;
  }
  if (t.dataset.place) {
    const [row, pos] = t.dataset.place.split(":").map(Number);
    moveSelected(row, pos);
    return;
  }
  if (t.dataset.reverse !== undefined && yourTurn() && !busy) {
    const row = Number(t.dataset.reverse);
    if (!board()[row].every(canTouch))
      return notify("La table reste intacte pendant votre première pose.");
    pushUndo();
    draft = board().map((m, i) => (i === row ? [...m].reverse() : [...m]));
    persistDraft();
    render();
    return;
  }
  if (t.dataset.remove)
    void askConfirmation(
      "Retirer ce joueur déconnecté ? Il abandonnera la partie en cours.",
    ).then((ok) => {
      if (ok) void command("removeOffline", { playerId: t.dataset.remove });
    });
  if (t.dataset.dropRack && selected.size) moveSelected("rack");
});
app.addEventListener("dragstart", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-tile]");
  if (!el?.dataset.tile || !yourTurn()) return;
  if (!selected.has(el.dataset.tile)) selected = new Set([el.dataset.tile]);
  event.dataTransfer?.setData("text/plain", el.dataset.tile); // Do not rerender while the browser owns a drag.
});
app.addEventListener("dragover", (event) => {
  if (
    (event.target as HTMLElement).closest("[data-drop-row], [data-drop-rack]")
  )
    event.preventDefault();
});
app.addEventListener("drop", (event) => {
  event.preventDefault();
  const el = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-drop-rack], [data-drop-row]",
  );
  if (!el) return;
  const row = el.dataset.dropRow;
  if (el.dataset.dropRack) moveSelected("rack");
  else if (row === "new") moveSelected("new");
  else if (row !== undefined)
    moveSelected(
      Number(row),
      el.dataset.dropPos === undefined ? undefined : Number(el.dataset.dropPos),
    );
});
document.querySelector("#confirm-dialog")!.addEventListener("cancel", () => {
  confirmResolve?.(false);
  confirmResolve = null;
});
function updateClock() {
  const el = document.querySelector<HTMLElement>("#timer");
  if (!el || !state) return;
  const remaining = state.deadline
    ? Math.max(
        0,
        Math.ceil((state.deadline - (Date.now() + clockOffset)) / 1000),
      )
    : null;
  el.hidden = remaining === null;
  el.textContent = remaining === null ? "" : `${remaining}s`;
  el.classList.toggle("urgent", remaining !== null && remaining <= 10);
}
setInterval(updateClock, 500);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && socket.connected && ready) socket.emit("sync");
});
render();
void bootstrapAccess();
