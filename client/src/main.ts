import "./style.css";
import { io, Socket } from "socket.io-client";

type CardColor = "red" | "blue" | "green" | "yellow" | "orange" | "black";

interface Card {
  id: string;
  color: CardColor;
  value: number;
}

interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  handCount: number;
  isHost: boolean;
  isCurrent: boolean;
  passed: boolean;
}

interface PublicGameState {
  roomId: string;
  phase: "lobby" | "playing" | "game_end";
  players: PublicPlayer[];
  you: { id: string; name: string } | null;
  hand: Card[];
  table: Card[];
  lastPlay: {
    playerId: string;
    cards: Card[];
    value: number;
    count: number;
  } | null;
  currentPlayerId: string | null;
  leaderRequired: boolean;
  round: number;
  roundStarterId: string | null;
  deckCount: number;
  discardCount: number;
  settings: {
    maxScore: number;
    colorCount: number;
  };
  effectiveColorCount: number;
  winners: { id: string; name: string }[] | null;
  canStart: boolean;
}

interface RoomJoinedPayload {
  roomId: string;
  playerId: string;
  hostId: string;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App container missing");
}

let socket: Socket | null = null;
let connected = false;
let roomId: string | null = null;
let playerId: string | null = null;
let gameState: PublicGameState | null = null;
let toastMessage: string | null = null;
let toastTimeout: number | null = null;
let roundSummary: {
  pointsLost: number;
  round: number;
  didWin: boolean;
} | null = null;
let selectedCardIds = new Set<string>();
let selectedTakeCardId: string | null = null;
let lastRound = 0;
let lastPlayerScore = 0;
let lastPhase: PublicGameState["phase"] | null = null;
let lastSummaryRound = 0;
let lastPlayersMarkup = "";
let lastLobbyPlayersMarkup = "";

const defaultServerUrl =
  import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";
let currentServerUrl = defaultServerUrl;

app.innerHTML = `
  <div class="app-shell">
    <header class="hero">
      <img src="/fleurs.png" class="hero-logo" alt="Fleurs">
      <div class="hero-content">
        <p class="eyebrow">Noémie = gros caca</p>
        <h1>Odin</h1>
      </div>
      <img src="/fleurs.png" class="hero-logo hero-logo--right" alt="Logo droite">
    </header>

    <section class="status" id="status"></section>
    <div class="stack-info">
    </div>

    <section class="panel" id="lobby">
      <h2>Connexion</h2>
      <div class="field-grid">
        <label class="field">
          <span>Pseudo</span>
          <input id="player-name" type="text" placeholder="Votre nom" />
        </label>
      </div>
      <div class="action-row">
        <button id="create-room">Creer une salle</button>
      </div>
      <div class="divider"></div>
      <div class="field-grid">
        <label class="field">
          <span>Code salle</span>
          <input id="room-code" type="text" placeholder="ABCD" maxlength="6" />
        </label>
      </div>
      <div class="action-row">
        <button class="ghost" id="join-room">Rejoindre</button>
      </div>
    </section>

    <section class="panel" id="room">
      <div class="panel-header">
        <div>
          <h2>Salle <span id="room-id"></span></h2>
          <p class="subtitle">En attente des joueurs...</p>
        </div>
        <div class="action-row">
          <button id="start-game">Demarrer</button>
          <button class="ghost" id="leave-room">Quitter</button>
        </div>
      </div>
      <div class="players" id="players"></div>
      <div class="divider"></div>
      <div class="room-options" id="room-options">
        <h3>Options de partie</h3>
        <div class="field-grid">
          <label class="field">
            <span>Score limite</span>
            <input id="setting-score" type="number" min="5" max="50" step="1" />
          </label>
          <label class="field">
            <span>Nombre de couleurs</span>
            <select id="setting-colors">
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="6">6</option>
            </select>
          </label>
        </div>
        <p class="subtitle" id="settings-note"></p>
      </div>
    </section>

    <section class="panel" id="game">
      <div class="players" id="players-game"></div>
      <div class="game-grid">
        <div class="table-zone" id="table-zone">
          <div class="table-header">
            <div>
              <h2 id="turn-title">Tour de ...</h2>
              <p class="subtitle" id="turn-indicator"></p>
            </div>
            <div class="table-meta" id="table-meta"></div>
          </div>
          <div class="card-row" id="table-cards"></div>
          <p class="hint" id="take-hint"></p>
        </div>
        <div class="sidebar">
          <div class="panel soft">
            <h3>Vos actions</h3>
            <div class="action-row">
              <button id="play-cards">Jouer</button>
              <button class="ghost" id="pass-turn">Passer</button>
            </div>
            <button class="link" id="clear-selection">Effacer sélection</button>
          </div>
          <div class="panel soft" id="round-info"></div>
          <div class="panel soft" id="rules-mini"></div>
        </div>
      </div>
      <div class="panel hand-panel">
        <div class="hand-header">
          <h2>Votre main</h2>
          <p class="subtitle" id="hand-info"></p>
        </div>
        <div class="card-row" id="hand-cards"></div>
      </div>
    </section>
    <div class="toast" id="toast"></div>
    <div class="round-overlay" id="round-overlay">
      <div class="round-card">
        <p class="eyebrow">Je t'aime</p>
        <h2 id="round-title"></h2>
        <p class="subtitle" id="round-points"></p>
        <button id="round-close">Continuer</button>
      </div>
    </div>
  </div>
`;

const statusEl = document.querySelector<HTMLDivElement>("#status");
const lobbyEl = document.querySelector<HTMLDivElement>("#lobby");
const roomEl = document.querySelector<HTMLDivElement>("#room");
const gameEl = document.querySelector<HTMLDivElement>("#game");
const playersEl = document.querySelector<HTMLDivElement>("#players");
const playersGameEl = document.querySelector<HTMLDivElement>("#players-game");
const roomIdEl = document.querySelector<HTMLSpanElement>("#room-id");
const tableCardsEl = document.querySelector<HTMLDivElement>("#table-cards");
const handCardsEl = document.querySelector<HTMLDivElement>("#hand-cards");
const turnTitleEl = document.querySelector<HTMLHeadingElement>("#turn-title");
const takeHintEl = document.querySelector<HTMLParagraphElement>("#take-hint");
const roundInfoEl = document.querySelector<HTMLDivElement>("#round-info");
const handInfoEl = document.querySelector<HTMLParagraphElement>("#hand-info");
const rulesMiniEl = document.querySelector<HTMLDivElement>("#rules-mini");
const settingsScoreInput =
  document.querySelector<HTMLInputElement>("#setting-score");
const settingsColorsSelect =
  document.querySelector<HTMLSelectElement>("#setting-colors");
const settingsNoteEl =
  document.querySelector<HTMLParagraphElement>("#settings-note");
const toastEl = document.querySelector<HTMLDivElement>("#toast");
const roundOverlayEl = document.querySelector<HTMLDivElement>("#round-overlay");
const roundTitleEl = document.querySelector<HTMLHeadingElement>("#round-title");
const roundPointsEl =
  document.querySelector<HTMLParagraphElement>("#round-points");
const roundCloseButton =
  document.querySelector<HTMLButtonElement>("#round-close");
const tableZoneEl = document.querySelector<HTMLDivElement>("#table-zone");

const playerNameInput =
  document.querySelector<HTMLInputElement>("#player-name");
const roomCodeInput = document.querySelector<HTMLInputElement>("#room-code");
const createRoomButton =
  document.querySelector<HTMLButtonElement>("#create-room");
const joinRoomButton = document.querySelector<HTMLButtonElement>("#join-room");
const startGameButton =
  document.querySelector<HTMLButtonElement>("#start-game");
const leaveRoomButton =
  document.querySelector<HTMLButtonElement>("#leave-room");
const playButton = document.querySelector<HTMLButtonElement>("#play-cards");
const passButton = document.querySelector<HTMLButtonElement>("#pass-turn");
const clearSelectionButton =
  document.querySelector<HTMLButtonElement>("#clear-selection");

function connectToServer(url: string) {
  currentServerUrl = url;
  if (socket) {
    socket.disconnect();
  }
  socket = io(url, { autoConnect: true });

  socket.on("connect", () => {
    connected = true;
    toastMessage = null;
    render();
  });

  socket.on("disconnect", () => {
    connected = false;
    roomId = null;
    playerId = null;
    gameState = null;
    selectedCardIds.clear();
    selectedTakeCardId = null;
    lastRound = 0;
    lastPlayerScore = 0;
    roundSummary = null;
    lastPhase = null;
    lastSummaryRound = 0;
    lastPlayersMarkup = "";
    lastLobbyPlayersMarkup = "";
    render();
  });

  socket.on("connect_error", (err) => {
    showToast(err.message);
  });

  socket.on("roomJoined", (payload: RoomJoinedPayload) => {
    roomId = payload.roomId;
    playerId = payload.playerId;
    render();
  });

  socket.on("roomLeft", () => {
    roomId = null;
    playerId = null;
    gameState = null;
    selectedCardIds.clear();
    selectedTakeCardId = null;
    lastRound = 0;
    lastPlayerScore = 0;
    roundSummary = null;
    lastPhase = null;
    lastSummaryRound = 0;
    lastPlayersMarkup = "";
    lastLobbyPlayersMarkup = "";
    render();
  });

  socket.on("state", (state: PublicGameState) => {
    const currentPlayer = playerId
      ? state.players.find((player) => player.id === playerId)
      : null;
    const currentScore = currentPlayer?.score ?? lastPlayerScore;
    const roundChanged = state.round !== lastRound;
    const phaseEnded =
      lastPhase === "playing" && state.phase === "game_end" && !roundChanged;
    const endedRound = roundChanged
      ? lastRound
      : phaseEnded
        ? state.round
        : null;

    if (playerId && endedRound && endedRound !== lastSummaryRound) {
      const pointsLost = Math.max(0, currentScore - lastPlayerScore);
      roundSummary = {
        pointsLost,
        round: endedRound,
        didWin: pointsLost === 0,
      };
      lastSummaryRound = endedRound;
      selectedCardIds.clear();
      selectedTakeCardId = null;
    }
    lastRound = state.round;
    lastPlayerScore = currentScore;
    lastPhase = state.phase;
    gameState = state;
    syncSelections();
    render();
  });

  socket.on("serverError", (payload: { message: string }) => {
    showToast(payload.message);
  });
}

function showToast(message: string) {
  toastMessage = message;
  if (toastTimeout) {
    window.clearTimeout(toastTimeout);
  }
  toastTimeout = window.setTimeout(() => {
    toastMessage = null;
    render();
  }, 3600);
  render();
}

function syncSelections() {
  if (!gameState) return;
  const handIds = new Set(gameState.hand.map((card) => card.id));
  selectedCardIds = new Set(
    [...selectedCardIds].filter((id) => handIds.has(id)),
  );
  const tableIds = new Set(gameState.table.map((card) => card.id));
  if (selectedTakeCardId && !tableIds.has(selectedTakeCardId)) {
    selectedTakeCardId = null;
  }
}

function getDisplayName(playerId: string | null | undefined): string {
  if (!playerId || !gameState) return "";
  return gameState.players.find((p) => p.id === playerId)?.name ?? "";
}

function getColorLabel(color: CardColor): string {
  switch (color) {
    case "red":
      return "Rouge";
    case "blue":
      return "Bleu";
    case "green":
      return "Vert";
    case "yellow":
      return "Jaune";
    case "orange":
      return "Orange";
    case "black":
      return "Noir";
    default:
      return color;
  }
}

function canEditSettings(): boolean {
  if (!gameState || gameState.phase !== "lobby") return false;
  return gameState.players.some(
    (player) => player.id === playerId && player.isHost,
  );
}

function emitSettingsUpdate(payload: {
  maxScore?: number;
  colorCount?: number;
}) {
  if (!socket || !roomId) return;
  socket.emit("updateSettings", { roomId, ...payload });
}

function updateSettingsUI() {
  if (
    !gameState ||
    !settingsScoreInput ||
    !settingsColorsSelect ||
    !settingsNoteEl
  ) {
    return;
  }

  settingsScoreInput.value = String(gameState.settings.maxScore);
  settingsColorsSelect.value = String(gameState.settings.colorCount);

  const editable = canEditSettings();
  settingsScoreInput.disabled = !editable;
  settingsColorsSelect.disabled = !editable;

  const noteParts: string[] = [];
  if (!editable) {
    noteParts.push("Seul l'hôte peut modifier les options.");
  }
  if (gameState.players.length === 2) {
    noteParts.push(
      `Avec 2 joueurs, 2 couleurs sont retirées (effectif: ${gameState.effectiveColorCount}).`,
    );
  } else {
    noteParts.push(`Couleurs actives: ${gameState.effectiveColorCount}.`);
  }
  noteParts.push(`Score limite: ${gameState.settings.maxScore}.`);
  settingsNoteEl.textContent = noteParts.join(" ");
}

function sortedHand(hand: Card[]): Card[] {
  const colorOrder: CardColor[] = [
    "red",
    "orange",
    "yellow",
    "green",
    "blue",
    "black",
  ];
  return [...hand].sort((a, b) => {
    if (a.color === b.color) return b.value - a.value;
    return colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color);
  });
}

function isMonoHand(hand: Card[]): boolean {
  if (hand.length === 0) return false;
  const first = hand[0];
  const sameColor = hand.every((card) => card.color === first.color);
  const sameValue = hand.every((card) => card.value === first.value);
  return sameColor || sameValue;
}

function toggleCardSelection(cardId: string) {
  if (!gameState) return;
  const alreadySelected = selectedCardIds.has(cardId);
  if (alreadySelected) {
    selectedCardIds.delete(cardId);
  } else {
    const allowMultiLead =
      gameState.leaderRequired && isMonoHand(gameState.hand);
    if (gameState.leaderRequired && !allowMultiLead) {
      selectedCardIds = new Set([cardId]);
    } else {
      selectedCardIds.add(cardId);
    }
  }
  render();
}

function toggleTakeSelection(cardId: string) {
  selectedTakeCardId = selectedTakeCardId === cardId ? null : cardId;
  render();
}

function render() {
  if (!statusEl || !lobbyEl || !roomEl || !gameEl) return;

  statusEl.innerHTML = `
    <div class="status-line">
      <span class="dot ${connected ? "online" : "offline"}"></span>
      <span>${connected ? "En ligne" : "Déconnecté"}</span>
    </div>`;

  if (toastEl) {
    if (toastMessage) {
      toastEl.textContent = toastMessage;
      toastEl.classList.add("show");
    } else {
      toastEl.textContent = "";
      toastEl.classList.remove("show");
    }
  }

  if (roundOverlayEl && roundTitleEl && roundPointsEl) {
    if (roundSummary) {
      roundTitleEl.textContent = roundSummary.didWin ? "Victoire" : "Defaite";
      roundPointsEl.textContent = `Manche ${roundSummary.round} - Points perdus: ${roundSummary.pointsLost}`;
      roundOverlayEl.classList.add("show");
    } else {
      roundOverlayEl.classList.remove("show");
    }
  }

  const inRoom = Boolean(roomId);
  lobbyEl.style.display = inRoom ? "none" : "block";
  const phase = gameState?.phase ?? "lobby";
  roomEl.style.display = inRoom && phase === "lobby" ? "block" : "none";
  gameEl.style.display = inRoom && phase !== "lobby" ? "block" : "none";

  if (!inRoom) {
    return;
  }

  if (roomIdEl) roomIdEl.textContent = roomId ?? "";

  if (gameState?.phase === "lobby" || !gameState) {
    renderLobbyRoom();
  } else if (gameState) {
    renderGame();
  }
}

function renderLobbyRoom() {
  if (!gameState || !playersEl || !startGameButton) return;
  const lobbyMarkup = gameState.players
    .map(
      (player) => `
      <div class="player-card ${player.isHost ? "host" : ""}">
        <div>
          <h3>${player.name}</h3>
          <p class="subtitle">Score: ${player.score}</p>
        </div>
        ${player.isHost ? '<span class="badge">Hote</span>' : ""}
      </div>
    `,
    )
    .join("");
  if (lobbyMarkup !== lastLobbyPlayersMarkup) {
    playersEl.innerHTML = lobbyMarkup;
    lastLobbyPlayersMarkup = lobbyMarkup;
  }

  startGameButton.disabled =
    !gameState.canStart || gameState.players.length < 2;
  updateSettingsUI();
}

function renderGame() {
  if (!gameState || !handCardsEl || !tableCardsEl) return;

  const playersMarkup = gameState.players
    .map((player) => {
      const classes = [
        "player-card",
        player.isCurrent ? "current" : "",
        player.passed ? "passed" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <div class="${classes}">
          <div>
            <h3>${player.name}</h3>
            <p class="subtitle">Main: ${player.handCount} cartes · Score: ${player.score}</p>
          </div>
          ${player.isHost ? '<span class="badge">Hote</span>' : ""}
        </div>
      `;
    })
    .join("");

  if (playersGameEl && playersMarkup !== lastPlayersMarkup) {
    playersGameEl.innerHTML = playersMarkup;
    lastPlayersMarkup = playersMarkup;
  }

  const currentName = getDisplayName(gameState.currentPlayerId);
  if (turnTitleEl) {
    turnTitleEl.textContent =
      gameState.phase === "game_end"
        ? "Partie terminée"
        : `Tour de ${currentName || "..."}`;
  }

  const sortedTable = sortedHand(gameState.table);
  tableCardsEl.innerHTML = sortedTable.length
    ? sortedTable
        .map((card) => renderCard(card, selectedTakeCardId === card.id, true))
        .join("")
    : '<p class="empty">Aucune carte sur la table.</p>';

  if (takeHintEl) {
    if (gameState.table.length > 1 && gameState.phase === "playing") {
      takeHintEl.textContent = "Choisissez une carte à récupérer en jouant.";
    } else if (gameState.table.length === 1 && gameState.phase === "playing") {
      takeHintEl.textContent =
        "La carte au centre sera récupérée automatiquement.";
    } else {
      takeHintEl.textContent = "";
    }
  }

  const hand = sortedHand(gameState.hand);
  handCardsEl.innerHTML = hand
    .map((card) => renderCard(card, selectedCardIds.has(card.id), false))
    .join("");

  if (handInfoEl) {
    const ruleHint = gameState.leaderRequired
      ? isMonoHand(gameState.hand)
        ? "Jouez 1 carte, ou toute votre main si possible."
        : "Jouez 1 carte."
      : gameState.lastPlay
        ? `Jouez ${gameState.lastPlay.count} ou ${gameState.lastPlay.count + 1} cartes.`
        : "";
    handInfoEl.textContent = ruleHint;
  }

  if (roundInfoEl) {
    const statusLine =
      gameState.phase === "game_end"
        ? `Gagnant(s): ${gameState.winners?.map((w) => w.name).join(", ") ?? ""}`
        : gameState.leaderRequired
          ? isMonoHand(gameState.hand)
            ? "La première personne doit jouer 1 carte (ou toute sa main si possible)."
            : "La première personne doit jouer 1 carte."
          : gameState.lastPlay
            ? `Dernière combinaison: ${getDisplayName(gameState.lastPlay.playerId)} (${gameState.lastPlay.value})`
            : "";
    roundInfoEl.innerHTML = `
      <h3>Etat</h3>
      <p class="subtitle">${statusLine}</p>
    `;
  }

  if (rulesMiniEl) {
    rulesMiniEl.innerHTML = `
      <h3>Règles express</h3>
      <p class="subtitle">Plus fort que la combinaison précédente. Même couleur ou même valeur. Même nombre de cartes ou +1.</p>
      <p class="subtitle">Après avoir joué, récupérer 1 carte de la table précédente.</p>
      <p class="subtitle">En début de tour, vous pouvez poser toute votre main si vous pouvez.</p>
    `;
  }

  const yourTurn = gameState.currentPlayerId === playerId;
  if (tableZoneEl) {
    tableZoneEl.classList.toggle(
      "is-turn",
      yourTurn && gameState.phase === "playing",
    );
  }
  if (playButton) {
    playButton.disabled =
      !yourTurn || selectedCardIds.size === 0 || gameState.phase !== "playing";
  }
  if (passButton) {
    passButton.disabled =
      !yourTurn || gameState.leaderRequired || gameState.phase !== "playing";
  }
}

function renderCard(card: Card, selected: boolean, isTable: boolean) {
  const classes = [
    "card",
    `card-${card.color}`,
    `value-${card.value}`,
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const buttonType = isTable ? "button" : "button";
  return `
    <${buttonType} class="${classes}" data-id="${card.id}" data-source="${
      isTable ? "table" : "hand"
    }">
      <span class="card-value">${card.value}</span>
      <span class="card-color">${getColorLabel(card.color)}</span>
    </${buttonType}>
  `;
}

function attachListeners() {
  createRoomButton?.addEventListener("click", () => {
    const name = playerNameInput?.value?.trim() ?? "";
    if (!name) {
      showToast("Entrez un pseudo.");
      return;
    }
    if (!socket || defaultServerUrl !== currentServerUrl) {
      connectToServer(defaultServerUrl);
    }
    socket?.emit("createRoom", { name });
  });

  joinRoomButton?.addEventListener("click", () => {
    const name = playerNameInput?.value?.trim() ?? "";
    const roomCode = roomCodeInput?.value?.trim().toUpperCase() ?? "";
    if (!name) {
      showToast("Entrez un pseudo.");
      return;
    }
    if (!roomCode) {
      showToast("Entrez un code salle.");
      return;
    }
    if (!socket || defaultServerUrl !== currentServerUrl) {
      connectToServer(defaultServerUrl);
    }
    socket?.emit("joinRoom", { roomId: roomCode, name });
  });

  settingsScoreInput?.addEventListener("change", () => {
    if (!settingsScoreInput || !canEditSettings()) return;
    const value = Number(settingsScoreInput.value);
    if (Number.isNaN(value)) return;
    emitSettingsUpdate({ maxScore: value });
  });

  settingsColorsSelect?.addEventListener("change", () => {
    if (!settingsColorsSelect || !canEditSettings()) return;
    const value = Number(settingsColorsSelect.value);
    if (Number.isNaN(value)) return;
    emitSettingsUpdate({ colorCount: value });
  });

  startGameButton?.addEventListener("click", () => {
    if (!socket || !roomId) return;
    socket.emit("startGame", { roomId });
  });

  leaveRoomButton?.addEventListener("click", () => {
    if (!socket) return;
    socket.emit("leaveRoom");
  });

  playButton?.addEventListener("click", () => {
    if (!socket || !roomId || !gameState) return;
    const cardIds = [...selectedCardIds];
    if (
      gameState.leaderRequired &&
      cardIds.length > 1 &&
      cardIds.length !== gameState.hand.length
    ) {
      showToast(
        "En début de tour, vous pouvez jouer plusieurs cartes uniquement si vous posez toute votre main.",
      );
      return;
    }
    if (
      gameState.leaderRequired &&
      cardIds.length === gameState.hand.length &&
      !isMonoHand(gameState.hand)
    ) {
      showToast("Toute la main doit être de la même couleur ou valeur.");
      return;
    }
    if (gameState.table.length > 1 && !gameState.leaderRequired) {
      if (!selectedTakeCardId) {
        showToast("Sélectionnez une carte à récupérer.");
        return;
      }
    }
    socket.emit("playCards", {
      roomId,
      cardIds,
      takeCardId: selectedTakeCardId ?? undefined,
    });
    selectedCardIds.clear();
    selectedTakeCardId = null;
    render();
  });

  passButton?.addEventListener("click", () => {
    if (!socket || !roomId) return;
    socket.emit("pass", { roomId });
  });

  clearSelectionButton?.addEventListener("click", () => {
    selectedCardIds.clear();
    selectedTakeCardId = null;
    render();
  });

  handCardsEl?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-id]");
    if (!button) return;
    const cardId = button.dataset.id;
    const source = button.dataset.source;
    if (cardId && source === "hand") {
      toggleCardSelection(cardId);
    }
  });

  tableCardsEl?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-id]");
    if (!button) return;
    const cardId = button.dataset.id;
    const source = button.dataset.source;
    if (cardId && source === "table") {
      toggleTakeSelection(cardId);
    }
  });

  roundCloseButton?.addEventListener("click", () => {
    roundSummary = null;
    render();
  });

  roundOverlayEl?.addEventListener("click", (event) => {
    if (event.target === roundOverlayEl) {
      roundSummary = null;
      render();
    }
  });
}

connectToServer(defaultServerUrl);
attachListeners();
render();
