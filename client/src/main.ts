import "./style.css";
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
let game: GameType = "odin";
let state: PublicGameState | null = null;
let connected = false,
  ready = false,
  busy = false,
  replaced = false;
let playerName = read("odin-name") || "";
let code = new URLSearchParams(location.search).get("room") || "";
let selected = new Set<string>(),
  take: string | null = null;
let draft: Card[][] | null = null;
let undoStack: Card[][][] = [];
let sort: "color" | "value" = "color";
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
  auth: (cb) => cb({ token: read("odin-token") }),
  reconnectionDelay: 700,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});
app.innerHTML = `<div class="app-shell"><header class="hero"><img src="/peru-anniversary-ornament.png" alt="" class="ornament"><div><p class="eyebrow">Notre petit rendez-vous</p><h1>À toi de jouer<span>♥</span></h1><p>Odin, Rummikub et des souvenirs à partager.</p></div><img src="/peru-anniversary-ornament.png" alt="" class="ornament right"></header><div id="connection" role="status" aria-live="polite"></div><main id="content"></main><footer>Je t’aime mon cœur · Encore une petite partie ?</footer></div><div id="toast" role="status" aria-live="polite"></div><dialog id="confirm-dialog"><h2>Juste pour être sûrs</h2><p id="confirm-text"></p><div class="actions"><button class="secondary" data-action="confirm-no">Rester à la table</button><button data-action="confirm-yes">Confirmer</button></div></dialog>`;
const content = document.querySelector<HTMLElement>("#content")!;
function notify(message: string) {
  const el = document.querySelector<HTMLElement>("#toast")!;
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 5500);
}
function connection() {
  document.querySelector("#connection")!.innerHTML =
    `<span class="dot ${ready ? "online" : ""}"></span>${ready ? "Connecté · Votre place est conservée après un refresh" : replaced ? "Votre profil est ouvert dans un autre onglet." : connected ? "Récupération de votre session…" : "Reconnexion en cours… Votre partie reste sauvegardée."}${replaced ? '<button class="text" data-action="reconnect">Reprendre ici</button>' : ""}`;
}
socket.on("connect", () => {
  connected = true;
  replaced = false;
  connection();
});
socket.on(
  "session",
  (session: { token?: string; name: string; reset: boolean }) => {
    if (session.token) save("odin-token", session.token);
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
  },
);
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
socket.on("connect_error", () => {
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
    const result = await socket
      .timeout(10000)
      .emitWithAck(event, {
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
      ? state?.settings.photos[tile.value] ||
        `/${((tile.value - 1) % 9) + 1}.png`
      : "";
  return `<button type="button" class="tile ${game === "odin" ? "odin-card" : ""} color-${tile.color} ${selected.has(tile.id) || (source === "take" && take === tile.id) ? "selected" : ""} ${photo ? "photo" : ""}" data-tile="${esc(tile.id)}" data-source="${source}" aria-label="${tile.joker ? "Joker" : `${tile.value} ${colors[tile.color]}`}" aria-pressed="${selected.has(tile.id) || (source === "take" && take === tile.id)}" ${disabled ? "disabled" : ""} draggable="${yourTurn() && game === "rummikub" && !disabled}">${photo ? `<img src="${esc(photo)}" alt="" draggable="false">` : ""}<span class="tile-number">${tile.joker ? "★" : tile.value}</span><span class="tile-color">${tile.joker ? "Joker" : colors[tile.color]}</span></button>`;
}
function players(): string {
  return `<div class="players">${state!.players.map((p) => `<article class="player ${p.isCurrent ? "current" : ""} ${p.forfeited ? "forfeited" : ""}"><span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span><div><strong>${esc(p.name)}${p.id === state!.you?.id ? " <small>(vous)</small>" : ""}</strong><p>${p.forfeited ? "A abandonné" : !p.connected ? "Reconnexion attendue" : p.isCurrent ? "À son tour" : p.isHost ? "Hôte de la salle" : "À la table"} · ${p.handCount} ${game === "odin" ? "cartes" : "tuiles"}</p><small>${p.score} points${game === "rummikub" ? (p.opened ? " · Première pose faite" : " · Première pose à faire") : p.passed ? " · A passé" : ""}</small></div>${host() && !p.connected && !p.forfeited ? `<button class="text danger" data-remove="${p.id}">Retirer</button>` : ""}</article>`).join("")}</div>`;
}
function gameChoices(): string {
  return `<div class="game-choices" role="group" aria-label="Choisir le jeu"><button class="game-choice ${game === "odin" ? "active" : ""}" data-game="odin" aria-pressed="${game === "odin"}"><div class="game-art odin-art"><span>8</span><span>9</span></div><div><span class="eyebrow">2 à 6 joueurs · Cartes</span><h2>Odin</h2><p>Jouez plus fort.<br>Gardez le moins de cartes.</p></div><span class="choose">${game === "odin" ? "Sélectionné ✓" : "Choisir Odin →"}</span></button><button class="game-choice ${game === "rummikub" ? "active" : ""}" data-game="rummikub" aria-pressed="${game === "rummikub"}"><div class="game-art rummi-art"><span>11</span><span>12</span><span>13</span></div><div><span class="eyebrow">2 à 4 joueurs · Tuiles</span><h2>Rummikub</h2><p>Des suites, des groupes.<br>La table est à réinventer.</p></div><span class="choose">${game === "rummikub" ? "Sélectionné ✓" : "Choisir Rummikub →"}</span></button></div>`;
}
function home(): string {
  return `<section class="intro"><span class="eyebrow">Les jeux sont meilleurs à deux</span><h2>On joue à quoi ?</h2><p>Choisissez votre jeu, invitez quelqu’un et retrouvez vos photos sur la table.</p></section>${gameChoices()}<section class="panel home-join"><div><span class="eyebrow">Votre prochaine partie</span><h2>Une place vous attend</h2><p>Une salle privée, un simple lien à partager.</p></div><div class="join-form"><label>Votre pseudo<input id="player-name" autocomplete="nickname" maxlength="24" placeholder="Votre petit nom" value="${esc(playerName)}"></label><button data-action="create" ${!ready || busy ? "disabled" : ""}>Créer une salle ${names[game]} <span>→</span></button><div class="join-code"><input id="room-code" aria-label="Code de la salle" placeholder="Code de la salle" maxlength="6" value="${esc(code)}"><button class="secondary" data-action="join" ${!ready || busy ? "disabled" : ""}>Rejoindre</button></div></div></section>`;
}
function settings(): string {
  const s = state!;
  const disabled = !host() || busy || !ready;
  return `<section class="panel"><h3>La partie, à votre façon</h3><div class="settings">${game === "odin" ? `<label>Score limite<input type="number" id="max-score" min="5" max="50" value="${s.settings.maxScore}" ${disabled ? "disabled" : ""}></label><label>Couleurs souhaitées<select id="color-count" ${disabled ? "disabled" : ""}>${[4, 5, 6].map((n) => `<option ${n === s.settings.colorCount ? "selected" : ""}>${n}</option>`).join("")}</select></label><p>${s.effectiveColorCount} couleurs actives pour garantir 9 cartes à chacun. Le plus petit score gagne.</p>` : `<label>Temps par tour<select id="turn-seconds" ${disabled ? "disabled" : ""}>${[60, 120, 0].map((n) => `<option value="${n}" ${n === s.settings.turnSeconds ? "selected" : ""}>${n ? `${n} secondes` : "Sans limite"}</option>`).join("")}</select></label><p>106 tuiles · 14 par joueur · Première pose de 30 points. À la fin du temps, une tuile est piochée et le tour passe.</p>`}</div><details class="photos"><summary>Nos photos sur les ${game === "odin" ? "cartes" : "tuiles"} <span>Personnaliser ↓</span></summary><p>Les photos sont partagées avec toute la salle. ${game === "rummikub" ? "Les valeurs 10 à 13 reprennent les photos 1 à 4 par défaut." : ""} ${host() ? "Choisissez une image pour chaque valeur." : "L’hôte peut choisir les photos."}</p><div class="photo-grid">${Array.from({ length: game === "odin" ? 9 : 13 }, (_, i) => `<label class="photo-picker"><img src="${esc(s.settings.photos[i + 1] || `/${(i % 9) + 1}.png`)}" alt="Photo ${i + 1}"><span>${i + 1} <small>Modifier</small></span><input type="file" data-photo="${i + 1}" accept="image/*" aria-label="Photo de la valeur ${i + 1}" ${disabled ? "disabled" : ""}></label>`).join("")}</div>${host() ? '<button class="text" data-action="reset-photos">Rétablir les photos d’origine</button>' : ""}</details></section>`;
}
function room(): string {
  const s = state!;
  return `<div class="room-bar"><div><span class="eyebrow">${names[game]} · Salle privée</span><h2>${s.roomId} <button class="secondary compact" data-action="invite">Copier l’invitation ↗</button></h2></div><button class="text" data-action="leave" ${!ready || busy ? "disabled" : ""}>${s.phase === "playing" || s.phase === "round_end" ? "Abandonner" : "Quitter la salle"}</button></div>${players()}${!host() && s.players.some((p) => p.isHost && !p.connected) ? '<p class="muted">L’hôte est déconnecté. Après 30 secondes, vous pouvez <button class="text" data-action="claim-host">reprendre le rôle d’hôte</button>.</p>' : ""}${s.phase === "lobby" ? `${settings()}<div class="start-row"><p>${s.players.length < 2 ? "Partagez le lien : il faut au moins deux joueurs." : !host() ? "La partie commence quand l’hôte est prêt." : "Tout le monde est là ? C’est parti."}</p><button data-action="start" ${!host() || !ready || busy || s.players.filter((p) => !p.forfeited).length < 2 || s.players.some((p) => !p.connected) ? "disabled" : ""}>Lancer la partie →</button></div>` : playArea()}`;
}
function result(): string {
  const s = state!;
  const r = s.roundResult;
  return `<section class="panel result"><span class="eyebrow">${s.phase === "game_end" ? "Fin de partie" : `Manche ${s.round} terminée`}</span><h2>${s.phase === "game_end" ? s.winners?.map((w) => esc(w.name)).join(" & ") : r?.winnerIds.map((id) => esc(s.players.find((p) => p.id === id)?.name)).join(" & ")} ${s.phase === "game_end" && (s.winners?.length ?? 0) > 1 ? "se partagent la victoire" : "remporte la " + (s.phase === "game_end" ? "partie" : "manche")} ♥</h2><p>${esc(r?.reason)}</p><div class="results">${s.players.map((p) => `<div><strong>${esc(p.name)}</strong><span>${r?.points[p.id] !== undefined ? `${r.points[p.id] > 0 ? "+" : ""}${r.points[p.id]} cette manche · ` : ""}${p.score} au total</span></div>`).join("")}</div>${s.phase === "game_end" ? '<p class="muted">Le classement est mis à jour à la fin des parties jouées.</p>' : ""}<button data-action="${s.phase === "game_end" ? "start" : "next-round"}" ${!host() || busy || !ready || s.players.filter((p) => !p.forfeited).length < 2 ? "disabled" : ""}>${s.phase === "game_end" ? "Rejouer ensemble" : "Manche suivante"} →</button>${!host() ? "<p>En attente de l’hôte…</p>" : ""}</section>`;
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
  return `<section class="table-panel ${me ? "my-turn" : ""}"><div class="table-heading"><div><span class="eyebrow">${game === "odin" ? `Manche ${s.round}` : `${s.deckCount} tuiles dans la pioche`}</span><h2>${me ? "À vous de jouer" : `Au tour de ${esc(current?.name)}`}</h2><p>${!current?.connected ? "Sa place est conservée pendant la reconnexion." : game === "rummikub" ? "Préparez votre table, puis validez le tour." : "Une bonne combinaison peut tout changer."}</p></div><span class="turn-clock" id="timer"></span></div>${
    game === "odin"
      ? `<div class="odin-table tile-row">${
          s.table.length
            ? sorted(s.table)
                .map((t) =>
                  card(t, "take", !me || busy || s.table.length === 1),
                )
                .join("")
            : '<div class="empty-table"><span>✧</span><p>Un nouveau pli à ouvrir</p></div>'
        }</div><p class="table-note">${s.table.length === 1 ? "Cette carte est récupérée automatiquement si votre main n’est pas vidée." : s.table.length > 1 ? "Choisissez ici la carte à récupérer. Aucune reprise si vous videz votre main." : "Une seule carte pour commencer. Une main de même couleur ou valeur gagne automatiquement à l’ouverture du pli."}</p>`
      : `<div class="rummi-board" data-drop-row="new"><div class="board-help">${s.players.find((p) => p.id === s.you?.id)?.opened ? "Sélectionnez des tuiles, puis une position + pour les déplacer. Le glisser-déposer fonctionne aussi." : "Première pose : au moins 30 points de votre chevalet. La table existante reste intacte."}</div>${b.map((m, row) => `<div class="meld ${validMeld(m) === null ? "invalid" : ""}" data-drop-row="${row}"><span class="meld-label">${row + 1}</span><div class="meld-tiles">${m.map((t, pos) => `${slot(row, pos)}${card(t, "board", !me || busy || !canTouch(t))}`).join("")}${slot(row, m.length)}</div>${me ? `<button class="text compact" data-reverse="${row}" ${busy ? "disabled" : ""} title="Inverser l’ordre">⇄</button>` : ""}<span class="meld-status">${validMeld(m) === null ? "À compléter" : `${validMeld(m)} pts ✓`}</span></div>`).join("") || '<div class="empty-table"><span>✧</span><p>La première combinaison ouvre le bal.</p></div>'}</div>`
  }</section><section class="panel rack-panel"><div class="rack-heading"><div><span class="eyebrow">À vous de composer</span><h2>${game === "odin" ? "Votre main" : "Votre chevalet"} <small>${game === "odin" ? s.hand.length : rack().length}</small></h2></div><div class="toolbar"><button class="text" data-action="sort">Trier par ${sort === "color" ? "valeur" : "couleur"}</button><button class="text" data-action="photos">${photosVisible ? "Masquer" : "Afficher"} les photos</button></div></div><div class="tile-row rack" data-drop-rack="true">${
    sorted(game === "odin" ? s.hand : rack())
      .map((t) => card(t, "hand", !me || busy))
      .join("") ||
    '<p class="muted">Chevalet vide. Validez votre tour pour gagner !</p>'
  }</div><div class="action-bar"><p id="selection-hint" aria-live="polite">${game === "odin" ? odinHint() : `${selected.size} tuile(s) sélectionnée(s) · ${draft ? "Modifications en cours" : "Rien n’est joué avant validation"}`}</p><div class="actions">${game === "odin" ? `<button class="secondary" data-action="suggest" ${!me || busy ? "disabled" : ""}>Une idée ?</button><button class="text" data-action="clear">Désélectionner</button><button class="secondary" data-action="pass" ${!me || busy || s.leaderRequired ? "disabled" : ""}>Passer</button><button data-action="play" ${!me || busy || !odinHint().startsWith("Prêt") ? "disabled" : ""}>Jouer ${selected.size || ""} →</button>` : `<button class="secondary" data-action="new-meld" ${!me || busy || !selected.size ? "disabled" : ""}>Nouvelle combinaison</button><button class="text" data-action="undo" ${!me || busy || !undoStack.length ? "disabled" : ""}>Annuler</button><button class="text" data-action="reset" ${!me || busy || !draft ? "disabled" : ""}>Tout rétablir</button><button class="secondary" data-action="draw" ${!me || busy ? "disabled" : ""}>${s.deckCount ? "Piocher et passer" : "Passer (pioche vide)"}</button><button data-action="validate" ${!me || busy || !draft ? "disabled" : ""}>Valider le tour →</button>`}</div></div></section>`;
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
  return `<section class="panel rules"><h3>Les règles, à portée de main</h3>${game === "odin" ? "<p>9 cartes par joueur. Ouvrez avec une carte, puis posez une combinaison de même couleur ou même valeur, de valeur supérieure : même nombre de cartes ou une de plus. Les chiffres forment le plus grand nombre possible (8 et 2 = 82).</p><p>Après une pose, récupérez une carte de la table précédente, sauf si vous videz votre main. Passer n’empêche pas de rejouer plus tard. Quand tous les autres passent, le dernier à jouer ouvre le pli suivant.</p><p>Une main vidée ou entièrement de même couleur/valeur à l’ouverture d’un pli termine la manche. Les autres marquent un point par carte. À la limite de score, le plus petit total gagne.</p>" : '<p>106 tuiles, dont 2 jokers. Chacun reçoit 14 tuiles. Posez des groupes de 3 ou 4 valeurs identiques de couleurs différentes, ou des suites d’au moins 3 valeurs consécutives de même couleur. Le 1 ne suit jamais le 13.</p><p>Votre première pose doit valoir au moins 30 points, uniquement avec votre chevalet. Vous pourrez réorganiser la table aux tours suivants. Un joker représente la tuile qu’il remplace ; il reste sur la table et peut être réutilisé dans une combinaison valide.</p><p>Chaque tour : posez au moins une tuile, ou piochez et passez. Toutes les combinaisons doivent être valides en fin de tour. Videz votre chevalet pour gagner. Un joker restant coûte 30 points. Si la pioche est vide et tout le monde passe, le plus petit chevalet gagne.</p><p>Pour déplacer : sélectionnez une ou plusieurs tuiles, puis cliquez sur + entre deux tuiles ou « Nouvelle combinaison ». Déplacez une tuile vers le chevalet pour reprendre une tuile posée pendant ce tour. « Annuler » revient d’un geste en arrière.</p><a href="https://rummikub.com/rules/" target="_blank" rel="noopener">Consulter les règles classiques officielles ↗</a>'}</section>`;
}
function ranking(): string {
  return `<section class="panel ranking"><div class="section-heading"><div><span class="eyebrow">Les petits défis entre nous</span><h2>Classement ${names[game]}</h2></div><button class="text" data-action="refresh-ranking">Actualiser ↻</button></div><p class="muted">1000 points Elo au départ · Classement séparé par jeu · Profil conservé dans ce navigateur.</p>${rankings.length ? `<div class="ranking-scroll"><table><thead><tr><th>Place</th><th>Joueur</th><th>Elo</th><th>Victoires</th><th>Parties</th></tr></thead><tbody>${rankings.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td><strong>${r.rating}</strong></td><td>${r.wins}${r.draws ? ` (+${r.draws} ex æquo)` : ""}</td><td>${r.played}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-ranking">Le premier chapitre reste à écrire.<br>Terminez une partie pour apparaître ici.</div>'}</section>`;
}
function render() {
  const focused = document.activeElement as HTMLInputElement | null;
  const id = focused?.id;
  const range =
    focused?.tagName === "INPUT" && focused.type === "text"
      ? focused.selectionStart
      : null;
  const focusedTile = focused?.dataset.tile;
  const focusedSource = focused?.dataset.source;
  const photoDetails =
    document.querySelector<HTMLDetailsElement>("details.photos")?.open;
  content.innerHTML = `${state ? room() : home()}<nav class="bottom-nav"><button class="text" data-action="rules" aria-expanded="${rulesOpen}">${rulesOpen ? "Fermer les" : "Voir les"} règles</button><button class="text" data-action="ranking" aria-expanded="${rankingsOpen}">${rankingsOpen ? "Masquer le" : "Voir le"} classement ↗</button></nav>${rulesOpen ? rules() : ""}${rankingsOpen ? ranking() : ""}`;
  if (photoDetails) {
    const details =
      document.querySelector<HTMLDetailsElement>("details.photos");
    if (details) details.open = true;
  }
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
async function photoUpload(file: File, value: string) {
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)
    return notify("Choisissez une image de moins de 20 Mo.");
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.7);
    if (url.length > 120000)
      return notify(
        "Cette photo reste trop lourde. Essayez une image plus simple.",
      );
    await command("updateSettings", {
      settings: { photos: { ...state?.settings.photos, [value]: url } },
    });
  } catch {
    notify("Impossible de lire cette image. Essayez un fichier JPEG ou PNG.");
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
      if (name === "join" && !/^[A-Z0-9]{4,6}$/i.test(code.trim()))
        return notify("Entrez le code de la salle.");
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
    case "reset-photos":
      await command("updateSettings", { settings: { photos: {} } });
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
        notify("Invitation copiée. Envoyez-la à votre partenaire !");
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
app.addEventListener("input", (event) => {
  const t = event.target as HTMLInputElement;
  if (t.id === "player-name") playerName = t.value;
  if (t.id === "room-code") {
    code = t.value.toUpperCase();
    t.value = code;
  }
});
app.addEventListener("change", (event) => {
  const t = event.target as HTMLInputElement;
  if (t.dataset.photo && t.files?.[0])
    void photoUpload(t.files[0], t.dataset.photo);
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
  const el = document.querySelector("#timer");
  if (!el || !state) return;
  const remaining = state.deadline
    ? Math.max(
        0,
        Math.ceil((state.deadline - (Date.now() + clockOffset)) / 1000),
      )
    : null;
  el.textContent = remaining === null ? "À votre rythme" : `${remaining}s`;
  el.classList.toggle("urgent", remaining !== null && remaining <= 10);
}
setInterval(updateClock, 500);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && socket.connected && ready) socket.emit("sync");
});
render();
