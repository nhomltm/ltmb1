import { playhtml } from "https://unpkg.com/playhtml";

// ==================== CONSTANTS ====================
const BOARD_SIZE = 9;
const COLS = 'abcdefghi';
const PIECE_TYPES = {
  dam: { icon: '🥊', name: 'Đấm', beats: 'keo' },
  la: { icon: '🍃', name: 'Lá', beats: 'dam' },
  keo: { icon: '✂️', name: 'Kéo', beats: 'la' }
};
const ARENA_BOARDS = [1, 2, 3, 4];

// ==================== GLOBAL STATE ====================
let myPlayerId = null;
let baseRoomId = '';
let currentRoomId = '';
let selectedMode = '2p'; // '2p' | 'arena'

// --- Chế độ 2 người chơi ---
let gameData = null;
let myPlayerNumber = null;
let selectedPieceId = null;
let validMoves = [];

// --- Chế độ đấu trường 4 bàn ---
let arenaBoards = {}; // { [num]: { gameData, myPlayerNumber, selectedPieceId, validMoves } }
let myPlayingBoard = null; // bàn mà mình đang là NGƯỜI CHƠI (chỉ được chơi 1 bàn cùng lúc)

// ==================== HELPERS: PHÒNG / TÊN / ID ====================
function generateRoomId() {
  return 'room-' + Math.random().toString(36).substring(2, 8);
}

function getRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('room');
}

function getModeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const m = params.get('mode');
  return (m === '2p' || m === 'arena') ? m : null;
}

function getOrCreateMyPlayerId() {
  let id = sessionStorage.getItem('ottv2-player-id');
  if (!id) {
    id = 'p-' + Math.random().toString(36).substring(2, 11);
    sessionStorage.setItem('ottv2-player-id', id);
  }
  return id;
}

function getSavedName() {
  return (sessionStorage.getItem('ottv2-player-name') || '').trim();
}

// ==================== TRẠNG THÁI BAN ĐẦU CỦA 1 BÀN CỜ ====================
function createInitialState(roomId) {
  const pieces = {};
  const board = Array.from({length: BOARD_SIZE}, () => Array(BOARD_SIZE).fill(null));

  const p1Setup = [
    {type: 'dam', row: 0, col: 2}, {type: 'dam', row: 1, col: 6}, {type: 'dam', row: 2, col: 7},
    {type: 'la', row: 0, col: 5}, {type: 'la', row: 1, col: 8}, {type: 'la', row: 2, col: 1},
    {type: 'keo', row: 0, col: 8}, {type: 'keo', row: 1, col: 3}, {type: 'keo', row: 2, col: 4}
  ];

  const p2Setup = [
    {type: 'dam', row: 8, col: 6}, {type: 'dam', row: 7, col: 2}, {type: 'dam', row: 6, col: 1},
    {type: 'la', row: 8, col: 3}, {type: 'la', row: 7, col: 0}, {type: 'la', row: 6, col: 7},
    {type: 'keo', row: 8, col: 0}, {type: 'keo', row: 7, col: 5}, {type: 'keo', row: 6, col: 4}
  ];

  const p1Counters = {dam: 0, la: 0, keo: 0};
  p1Setup.forEach(pos => {
    p1Counters[pos.type]++;
    const id = `p1-${pos.type}-${p1Counters[pos.type]}`;
    pieces[id] = { id, player: 1, type: pos.type, row: pos.row, col: pos.col };
    board[pos.row][pos.col] = id;
  });

  const p2Counters = {dam: 0, la: 0, keo: 0};
  p2Setup.forEach(pos => {
    p2Counters[pos.type]++;
    const id = `p2-${pos.type}-${p2Counters[pos.type]}`;
    pieces[id] = { id, player: 2, type: pos.type, row: pos.row, col: pos.col };
    board[pos.row][pos.col] = id;
  });

  return {
    room: roomId,
    players: {},
    playerOrder: [],
    spectators: [],
    board,
    pieces,
    currentPlayer: 1,
    gameStatus: "waiting",
    winner: null,
    winnerReason: null,
    turnNumber: 0
  };
}

// ==================== GAME LOGIC (dùng chung cho cả 2 chế độ) ====================
function isInsideBoard(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function canCapture(attackerType, defenderType) {
  if (attackerType === defenderType) return false;
  return PIECE_TYPES[attackerType].beats === defenderType;
}

function getLegalMovesForPiece(state, pieceId) {
  const piece = state.pieces[pieceId];
  if (!piece) return [];

  const moves = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = piece.row + dr;
      const nc = piece.col + dc;
      if (!isInsideBoard(nr, nc)) continue;

      const targetId = state.board[nr][nc];
      if (!targetId) {
        moves.push({row: nr, col: nc, captures: null});
      } else {
        const target = state.pieces[targetId];
        if (target.player !== piece.player && target.type !== piece.type && canCapture(piece.type, target.type)) {
          moves.push({row: nr, col: nc, captures: targetId});
        }
      }
    }
  }
  return moves;
}

// NOTE: đã khôi phục đầy đủ kiểm tra lượt chơi / quyền sở hữu quân
// (bản trước bị mất phần này khi dọn debug log, khiến ai cũng đi được bất kỳ quân nào bất kỳ lúc nào).
function validateMove(state, pieceId, toRow, toCol) {
  const piece = state.pieces[pieceId];
  if (!piece) return {valid: false, reason: "Quân không tồn tại"};
  if (state.gameStatus !== "playing") return {valid: false, reason: "Game chưa bắt đầu"};

  const currentPlayerId = state.playerOrder[state.currentPlayer - 1];
  const currentPlayerInfo = currentPlayerId ? state.players[currentPlayerId] : null;
  if (!currentPlayerInfo || currentPlayerInfo.id !== myPlayerId) {
    return {valid: false, reason: "Không phải lượt của bạn"};
  }
  if (piece.player !== state.currentPlayer) {
    return {valid: false, reason: "Đây không phải quân của bạn"};
  }

  if (!isInsideBoard(toRow, toCol)) return {valid: false, reason: "Nằm ngoài bàn cờ"};

  const dr = Math.abs(toRow - piece.row);
  const dc = Math.abs(toCol - piece.col);
  if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) {
    return {valid: false, reason: "Quân chỉ được di chuyển đúng 1 ô theo 8 hướng"};
  }

  const targetId = state.board[toRow][toCol];
  if (targetId) {
    const target = state.pieces[targetId];
    if (target.player === piece.player) {
      return {valid: false, reason: "Không thể ăn quân của mình"};
    }
    if (target.type === piece.type) {
      return {valid: false, reason: "Hai quân cùng loại không thể ăn nhau"};
    }
    if (!canCapture(piece.type, target.type)) {
      return {valid: false, reason: "Quân của bạn yếu hơn"};
    }
  }

  return {valid: true};
}

function executeMove(draft, pieceId, toRow, toCol) {
  const piece = draft.pieces[pieceId];
  const fromRow = piece.row;
  const fromCol = piece.col;

  const newBoard = draft.board.map(row => [...row]);
  newBoard[fromRow][fromCol] = null;

  const targetId = newBoard[toRow][toCol];
  let captured = null;
  if (targetId) {
    captured = draft.pieces[targetId];
    delete draft.pieces[targetId];
  }

  piece.row = toRow;
  piece.col = toCol;
  newBoard[toRow][toCol] = pieceId;
  draft.board = newBoard;

  const opponent = piece.player === 1 ? 2 : 1;
  const opponentPieces = Object.values(draft.pieces).filter(p => p.player === opponent);
  const typesPresent = new Set(opponentPieces.map(p => p.type));
  const missingType = ['dam', 'la', 'keo'].find(t => !typesPresent.has(t));

  if (missingType) {
    draft.gameStatus = "finished";
    draft.winner = piece.player;
    const typeNames = {dam: 'Đấm', la: 'Lá', keo: 'Kéo'};
    draft.winnerReason = `Bạn đã ăn hết toàn bộ quân ${typeNames[missingType]} của đối phương!`;
  }

  if (draft.gameStatus !== "finished") {
    if ((toRow === 0 && toCol === 0) || (toRow === 8 && toCol === 8)) {
      draft.gameStatus = "finished";
      draft.winner = piece.player;
      const goalName = (toRow === 0 && toCol === 0) ? 'a1' : 'i9';
      draft.winnerReason = `Bạn đã đưa quân vào ô ${goalName}!`;
    }
  }

  if (draft.gameStatus === "playing") {
    draft.currentPlayer = opponent;
    draft.turnNumber++;
  }

  return {success: true, captured};
}

// ==================== TOAST DÙNG CHUNG ====================
function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 2500);
}

function showError(msg) {
  showToast(msg, 'error');
}

function showCaptureMessage(capturedName) {
  showToast(`Ăn được quân ${capturedName} của đối phương!`, 'capture');
}

// ==================== MÀN HÌNH ====================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function showGameScreen() {
  showScreen('game');
  const roomDisplay = document.getElementById('room-display');
  const roomDisplayFooter = document.getElementById('room-display-footer');
  if (roomDisplay) roomDisplay.textContent = currentRoomId;
  if (roomDisplayFooter) roomDisplayFooter.textContent = currentRoomId;
  const back = document.getElementById('back-link');
  if (back) back.href = `?room=${baseRoomId}`;
}

function showArenaScreen() {
  showScreen('arena');
  const roomDisplay = document.getElementById('arena-room-display');
  if (roomDisplay) roomDisplay.textContent = baseRoomId;
  const back = document.getElementById('arena-back-link');
  if (back) back.href = `?room=${baseRoomId}`;
}

function renderCoordinates() {
  const header = document.getElementById('coord-header');
  const side = document.getElementById('coord-side');
  if (!header || !side) return;
  header.innerHTML = '<div class="corner"></div>' + COLS.split('').map(c => `<div class="coord">${c}</div>`).join('');
  side.innerHTML = '';
  for (let i = 1; i <= BOARD_SIZE; i++) {
    const div = document.createElement('div');
    div.className = 'coord';
    div.textContent = i;
    side.appendChild(div);
  }
}

/* ============================================================
   ================  CHẾ ĐỘ 1: 2 NGƯỜI CHƠI  ==================
   ============================================================ */

function renderBoard() {
  const boardEl = document.getElementById('board');
  if (!boardEl || !gameData) return;

  const state = gameData.getData();
  if (!state || !state.board) {
    boardEl.innerHTML = '';
    return;
  }

  boardEl.innerHTML = '';

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;

      const pieceId = state.board[row]?.[col];
      if (pieceId && state.pieces[pieceId]) {
        const piece = state.pieces[pieceId];
        const pieceEl = document.createElement('span');
        pieceEl.className = `piece player${piece.player}`;
        pieceEl.textContent = PIECE_TYPES[piece.type].icon;
        pieceEl.dataset.pieceId = pieceId;
        cell.appendChild(pieceEl);
      }

      if ((row === 0 && col === 0) || (row === 8 && col === 8)) {
        cell.classList.add('goal');
        const flag = document.createElement('span');
        flag.className = 'goal-flag';
        flag.textContent = '🏁';
        cell.appendChild(flag);
      }

      if (selectedPieceId === pieceId) {
        cell.classList.add('selected');
      }

      const moveInfo = validMoves.find(m => m.row === row && m.col === col);
      if (moveInfo) {
        cell.classList.add(moveInfo.captures ? 'capture-move' : 'valid-move');
      }

      cell.addEventListener('click', () => onCellClick(row, col));
      boardEl.appendChild(cell);
    }
  }
}

function renderPlayerPanels() {
  const state = gameData.getData();

  ['p1', 'p2'].forEach((p, idx) => {
    const playerNum = idx + 1;
    const panel = document.getElementById(`player${playerNum}-panel`);
    const nameEl = document.getElementById(`${p}-name`);
    if (!panel || !nameEl) return;

    const playerId = state.playerOrder[idx];
    const player = playerId ? state.players[playerId] : null;
    nameEl.textContent = player ? player.name : 'Đang chờ...';

    ['dam', 'la', 'keo'].forEach(type => {
      const count = Object.values(state.pieces).filter(p => p.player === playerNum && p.type === type).length;
      const countEl = document.getElementById(`${p}-${type}`);
      if (countEl) countEl.textContent = count;
    });

    panel.classList.toggle('active', state.gameStatus === 'playing' && state.currentPlayer === playerNum);
  });

  const playerCountEl = document.getElementById('player-count');
  const turnCountEl = document.getElementById('turn-count');
  if (playerCountEl) playerCountEl.textContent = state.playerOrder.length;
  if (turnCountEl) turnCountEl.textContent = state.turnNumber;
}

function renderTurnIndicator() {
  const state = gameData.getData();
  const indicator = document.getElementById('turn-indicator');
  if (!indicator) return;

  if (state.gameStatus === 'waiting') {
    indicator.textContent = 'ĐANG CHỜ NGƯỜI CHƠI THỨ 2...';
    indicator.className = 'turn-indicator waiting';
  } else if (state.gameStatus === 'finished') {
    indicator.textContent = `🏆 PLAYER ${state.winner} THẮNG!`;
    indicator.className = 'turn-indicator winner';
  } else {
    if (myPlayerNumber === null) {
      indicator.textContent = '👀 BẠN ĐANG QUAN SÁT';
      indicator.className = 'turn-indicator waiting';
    } else if (state.currentPlayer === myPlayerNumber) {
      indicator.textContent = '🎯 ĐẾN LƯỢT BẠN';
      indicator.className = 'turn-indicator my-turn';
    } else {
      indicator.textContent = '⏳ ĐANG CHỜ ĐỐI THỦ...';
      indicator.className = 'turn-indicator opponent-turn';
    }
  }
}

function renderSpectators() {
  const state = gameData.getData();
  const el = document.getElementById('spectator-info');
  if (!el) return;

  if (!state.spectators || state.spectators.length === 0) {
    el.textContent = '';
    return;
  }
  el.textContent = `👁️ ${state.spectators.map(s => s.name).join(', ')}`;
}

function renderAll() {
  try {
    renderBoard();
    renderPlayerPanels();
    renderTurnIndicator();
    renderSpectators();

    const state = gameData.getData();
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) resetBtn.style.display = state.gameStatus === 'finished' ? 'inline-block' : 'none';
  } catch (err) {
    console.error('[OTTv2] renderAll error:', err);
  }
}

function onCellClick(row, col) {
  const state = gameData.getData();
  if (state.gameStatus !== 'playing') return;

  const clickedPieceId = state.board[row][col];

  if (selectedPieceId) {
    const moveInfo = validMoves.find(m => m.row === row && m.col === col);
    if (moveInfo) {
      makeMove(selectedPieceId, row, col);
      selectedPieceId = null;
      validMoves = [];
      renderAll();
      return;
    }

    if (clickedPieceId && state.pieces[clickedPieceId]) {
      const piece = state.pieces[clickedPieceId];
      if (piece.player === myPlayerNumber && state.currentPlayer === myPlayerNumber) {
        selectedPieceId = clickedPieceId;
        validMoves = getLegalMovesForPiece(state, clickedPieceId);
        renderAll();
        return;
      }
    }

    selectedPieceId = null;
    validMoves = [];
    renderAll();
    return;
  }

  if (clickedPieceId && state.pieces[clickedPieceId]) {
    const piece = state.pieces[clickedPieceId];
    if (piece.player === myPlayerNumber && state.currentPlayer === myPlayerNumber) {
      selectedPieceId = clickedPieceId;
      validMoves = getLegalMovesForPiece(state, clickedPieceId);
      renderAll();
    }
  }
}

function makeMove(pieceId, toRow, toCol) {
  const state = gameData.getData();
  const validation = validateMove(state, pieceId, toRow, toCol);
  if (!validation.valid) {
    showError(validation.reason);
    return;
  }

  const targetId = state.board[toRow][toCol];
  const capturedPiece = targetId ? state.pieces[targetId] : null;

  gameData.setData((draft) => {
    executeMove(draft, pieceId, toRow, toCol);
  });

  if (capturedPiece) {
    const typeNames = {dam: 'Đấm', la: 'Lá', keo: 'Kéo'};
    showCaptureMessage(typeNames[capturedPiece.type]);
  }

  renderAll();
}

function autoJoinTwoPlayer() {
  const name = getSavedName() || `Player ${gameData.getData().playerOrder.length + 1}`;

  gameData.setData((draft) => {
    const existing = draft.players[myPlayerId];
    if (existing) return;

    if (draft.playerOrder.length >= 2) {
      const alreadySpectating = (draft.spectators || []).some(s => s.id === myPlayerId);
      if (alreadySpectating) return;
      draft.spectators = draft.spectators || [];
      draft.spectators.push({ id: myPlayerId, name, joinedAt: Date.now() });
      return;
    }

    draft.players[myPlayerId] = { id: myPlayerId, name, joinedAt: Date.now() };
    draft.playerOrder.push(myPlayerId);

    if (draft.playerOrder.length === 2) {
      draft.gameStatus = "playing";
      draft.currentPlayer = 1;
    }
  });

  const state = gameData.getData();
  const idx = state.playerOrder.indexOf(myPlayerId);
  myPlayerNumber = idx >= 0 ? idx + 1 : null;

  if (myPlayerNumber === null) {
    showToast(`Bạn đang xem trận đấu với tên ${name}`, 'info');
  }
}

function resetGame() {
  if (!gameData) return;
  const newState = createInitialState(currentRoomId);
  gameData.setData(newState);
  selectedPieceId = null;
  validMoves = [];
  renderAll();
}

async function initTwoPlayerGame() {
  try {
    await playhtml.init({ room: currentRoomId });
    await playhtml.ready;

    const initialState = createInitialState(currentRoomId);
    gameData = playhtml.createPageData("ottv2-game", initialState);

    let state = gameData.getData();
    if (!state || !state.board) {
      gameData.setData(initialState);
      state = initialState;
    }

    gameData.onUpdate(() => {
      selectedPieceId = null;
      validMoves = [];
      try { renderAll(); } catch (err) { console.error('[OTTv2] renderAll error:', err); }
    });

    myPlayerId = getOrCreateMyPlayerId();

    const existingPlayer = state.players[myPlayerId];
    if (existingPlayer) {
      const myIndex = state.playerOrder.indexOf(myPlayerId);
      myPlayerNumber = myIndex >= 0 ? myIndex + 1 : null;
    } else {
      autoJoinTwoPlayer();
    }

    renderCoordinates();
    showGameScreen();
    renderAll();
  } catch (err) {
    console.error('[OTTv2] PlayHTML init failed:', err);
    showLobbyError('Không thể kết nối PlayHTML: ' + (err?.message || err));
  }
}

/* ============================================================
   ==============  CHẾ ĐỘ 2: ĐẤU TRƯỜNG 4 BÀN  ================
   ============================================================ */

function buildArenaGrid() {
  const grid = document.getElementById('arena-grid');
  if (!grid) return;
  grid.innerHTML = '';

  ARENA_BOARDS.forEach(num => {
    const panel = document.createElement('div');
    panel.className = 'board-panel';
    panel.id = `panel-${num}`;
    panel.innerHTML = `
      <div class="board-panel-header">
        <span class="board-panel-title">BÀN ${num}</span>
        <span class="board-panel-code">${baseRoomId}-${num}</span>
      </div>
      <div class="mini-players">
        <div class="mini-player p1">
          <span class="mini-player-name" id="name-${num}-1">Đang chờ...</span>
          <span class="mini-piece-counts" id="counts-${num}-1">🥊0 🍃0 ✂️0</span>
        </div>
        <div class="mini-player p2">
          <span class="mini-player-name" id="name-${num}-2">Đang chờ...</span>
          <span class="mini-piece-counts" id="counts-${num}-2">🥊0 🍃0 ✂️0</span>
        </div>
      </div>
      <div class="mini-board" id="board-${num}"></div>
      <div class="board-panel-turn" id="turn-${num}"></div>
      <div class="board-panel-footer">
        <button class="join-board-btn" data-board="${num}">THAM GIA</button>
        <button class="reset-board-btn" data-board="${num}" style="display:none">🔄 Chơi lại</button>
      </div>
      <div class="spectator-info-mini" id="spectator-${num}"></div>
    `;
    grid.appendChild(panel);
  });

  grid.querySelectorAll('.join-board-btn').forEach(btn => {
    btn.addEventListener('click', () => joinArenaBoard(parseInt(btn.dataset.board, 10)));
  });
  grid.querySelectorAll('.reset-board-btn').forEach(btn => {
    btn.addEventListener('click', () => resetArenaBoard(parseInt(btn.dataset.board, 10)));
  });
}

function renderMiniBoard(num, state, b) {
  const boardEl = document.getElementById(`board-${num}`);
  if (!boardEl) return;
  boardEl.innerHTML = '';

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      const pieceId = state.board[row]?.[col];
      if (pieceId && state.pieces[pieceId]) {
        const piece = state.pieces[pieceId];
        const span = document.createElement('span');
        span.className = `piece player${piece.player}`;
        span.textContent = PIECE_TYPES[piece.type].icon;
        cell.appendChild(span);
      }

      if ((row === 0 && col === 0) || (row === 8 && col === 8)) {
        cell.classList.add('goal');
      }

      if (b.selectedPieceId === pieceId && pieceId) {
        cell.classList.add('selected');
      }

      const moveInfo = b.validMoves.find(m => m.row === row && m.col === col);
      if (moveInfo) {
        cell.classList.add(moveInfo.captures ? 'capture-move' : 'valid-move');
      }

      cell.addEventListener('click', () => onArenaCellClick(num, row, col));
      boardEl.appendChild(cell);
    }
  }
}

function renderArenaBoard(num) {
  const b = arenaBoards[num];
  if (!b) return;
  const state = b.gameData.getData();
  if (!state || !state.board) return;

  renderMiniBoard(num, state, b);

  [1, 2].forEach(pn => {
    const playerId = state.playerOrder[pn - 1];
    const player = playerId ? state.players[playerId] : null;
    const nameEl = document.getElementById(`name-${num}-${pn}`);
    if (nameEl) nameEl.textContent = player ? player.name : 'Đang chờ...';

    const dam = Object.values(state.pieces).filter(p => p.player === pn && p.type === 'dam').length;
    const la = Object.values(state.pieces).filter(p => p.player === pn && p.type === 'la').length;
    const keo = Object.values(state.pieces).filter(p => p.player === pn && p.type === 'keo').length;
    const countsEl = document.getElementById(`counts-${num}-${pn}`);
    if (countsEl) countsEl.textContent = `🥊${dam} 🍃${la} ✂️${keo}`;
  });

  const turnEl = document.getElementById(`turn-${num}`);
  if (turnEl) {
    if (state.gameStatus === 'waiting') {
      turnEl.textContent = 'Đang chờ người chơi...';
      turnEl.className = 'board-panel-turn waiting';
    } else if (state.gameStatus === 'finished') {
      turnEl.textContent = `🏆 Player ${state.winner} thắng!`;
      turnEl.className = 'board-panel-turn winner';
    } else if (b.myPlayerNumber && b.myPlayerNumber === state.currentPlayer) {
      turnEl.textContent = '🎯 Lượt của bạn';
      turnEl.className = 'board-panel-turn my-turn';
    } else if (b.myPlayerNumber) {
      turnEl.textContent = '⏳ Chờ đối thủ';
      turnEl.className = 'board-panel-turn opponent-turn';
    } else {
      turnEl.textContent = '👀 Đang xem';
      turnEl.className = 'board-panel-turn waiting';
    }
  }

  const joinBtn = document.querySelector(`.join-board-btn[data-board="${num}"]`);
  const resetBtn = document.querySelector(`.reset-board-btn[data-board="${num}"]`);
  const iAmRegistered = !!state.players[myPlayerId] || (state.spectators || []).some(s => s.id === myPlayerId);
  if (joinBtn) joinBtn.style.display = iAmRegistered ? 'none' : 'inline-block';
  if (resetBtn) resetBtn.style.display = state.gameStatus === 'finished' ? 'inline-block' : 'none';

  const specEl = document.getElementById(`spectator-${num}`);
  if (specEl) {
    const names = (state.spectators || []).map(s => s.name).join(', ');
    specEl.textContent = names ? `👁️ ${names}` : '';
  }
}

function renderArenaAll() {
  ARENA_BOARDS.forEach(num => renderArenaBoard(num));
}

function onArenaCellClick(num, row, col) {
  const b = arenaBoards[num];
  if (!b) return;
  const state = b.gameData.getData();
  if (state.gameStatus !== 'playing') return;

  const clickedPieceId = state.board[row][col];

  if (b.selectedPieceId) {
    const moveInfo = b.validMoves.find(m => m.row === row && m.col === col);
    if (moveInfo) {
      makeArenaMove(num, b.selectedPieceId, row, col);
      b.selectedPieceId = null;
      b.validMoves = [];
      renderArenaBoard(num);
      return;
    }

    if (clickedPieceId && state.pieces[clickedPieceId]) {
      const piece = state.pieces[clickedPieceId];
      if (piece.player === b.myPlayerNumber && state.currentPlayer === b.myPlayerNumber) {
        b.selectedPieceId = clickedPieceId;
        b.validMoves = getLegalMovesForPiece(state, clickedPieceId);
        renderArenaBoard(num);
        return;
      }
    }

    b.selectedPieceId = null;
    b.validMoves = [];
    renderArenaBoard(num);
    return;
  }

  if (clickedPieceId && state.pieces[clickedPieceId]) {
    const piece = state.pieces[clickedPieceId];
    if (piece.player === b.myPlayerNumber && state.currentPlayer === b.myPlayerNumber) {
      b.selectedPieceId = clickedPieceId;
      b.validMoves = getLegalMovesForPiece(state, clickedPieceId);
      renderArenaBoard(num);
    }
  }
}

function makeArenaMove(num, pieceId, toRow, toCol) {
  const b = arenaBoards[num];
  if (!b) return;
  const state = b.gameData.getData();
  const validation = validateMove(state, pieceId, toRow, toCol);
  if (!validation.valid) {
    showError(validation.reason);
    return;
  }

  const targetId = state.board[toRow][toCol];
  const capturedPiece = targetId ? state.pieces[targetId] : null;

  b.gameData.setData((draft) => {
    executeMove(draft, pieceId, toRow, toCol);
  });

  if (capturedPiece) {
    const typeNames = {dam: 'Đấm', la: 'Lá', keo: 'Kéo'};
    showCaptureMessage(typeNames[capturedPiece.type]);
  }

  renderArenaBoard(num);
}

function joinArenaBoard(num) {
  const b = arenaBoards[num];
  if (!b) return;

  const name = getSavedName() || `Player ${b.gameData.getData().playerOrder.length + 1}`;

  b.gameData.setData((draft) => {
    const existing = draft.players[myPlayerId];
    if (existing) return;

    // Mỗi người chỉ được làm NGƯỜI CHƠI ở 1 bàn tại 1 thời điểm; các bàn khác chỉ có thể xem.
    const canBePlayer = draft.playerOrder.length < 2 && (myPlayingBoard === null || myPlayingBoard === num);

    if (!canBePlayer) {
      const alreadySpectating = (draft.spectators || []).some(s => s.id === myPlayerId);
      if (alreadySpectating) return;
      draft.spectators = draft.spectators || [];
      draft.spectators.push({ id: myPlayerId, name, joinedAt: Date.now() });
      return;
    }

    draft.players[myPlayerId] = { id: myPlayerId, name, joinedAt: Date.now() };
    draft.playerOrder.push(myPlayerId);

    if (draft.playerOrder.length === 2) {
      draft.gameStatus = "playing";
      draft.currentPlayer = 1;
    }
  });

  const state = b.gameData.getData();
  const idx = state.playerOrder.indexOf(myPlayerId);
  b.myPlayerNumber = idx >= 0 ? idx + 1 : null;

  if (b.myPlayerNumber !== null) {
    myPlayingBoard = num;
    showToast(`Bạn đã vào Bàn ${num} với vai trò Player ${b.myPlayerNumber}`, 'success');
  } else {
    showToast(`Bạn đang xem Bàn ${num}`, 'info');
  }

  renderArenaBoard(num);
}

function resetArenaBoard(num) {
  const b = arenaBoards[num];
  if (!b) return;

  const newState = createInitialState(`${baseRoomId}-${num}`);
  b.gameData.setData(newState);
  b.myPlayerNumber = null;
  b.selectedPieceId = null;
  b.validMoves = [];
  if (myPlayingBoard === num) myPlayingBoard = null;

  renderArenaBoard(num);
}

async function initArenaGame() {
  try {
    await playhtml.init({ room: currentRoomId });
    await playhtml.ready;

    myPlayerId = getOrCreateMyPlayerId();

    buildArenaGrid();

    ARENA_BOARDS.forEach(num => {
      const key = `ottv2-arena-board-${num}`;
      const initialState = createInitialState(`${baseRoomId}-${num}`);
      const gd = playhtml.createPageData(key, initialState);

      let state = gd.getData();
      if (!state || !state.board) {
        gd.setData(initialState);
        state = initialState;
      }

      const idx = state.playerOrder.indexOf(myPlayerId);
      const myNumber = idx >= 0 ? idx + 1 : null;

      arenaBoards[num] = {
        gameData: gd,
        myPlayerNumber: myNumber,
        selectedPieceId: null,
        validMoves: []
      };

      if (myNumber !== null) myPlayingBoard = num;

      gd.onUpdate(() => {
        arenaBoards[num].selectedPieceId = null;
        arenaBoards[num].validMoves = [];
        try { renderArenaBoard(num); } catch (err) { console.error('[OTTv2] arena render error:', err); }
      });
    });

    renderArenaAll();
    showArenaScreen();
  } catch (err) {
    console.error('[OTTv2] PlayHTML init failed:', err);
    showLobbyError('Không thể kết nối PlayHTML: ' + (err?.message || err));
  }
}

/* ============================================================
   ========================  LOBBY  ============================
   ============================================================ */

function showLobbyError(msg) {
  const statusEl = document.getElementById('lobby-status');
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.style.display = 'block';
  }
  showScreen('lobby');
}

function proceedToGame() {
  const nameInput = document.getElementById('player-name');
  const name = nameInput ? nameInput.value.trim() : '';
  if (name) sessionStorage.setItem('ottv2-player-name', name);
  window.location.href = `?room=${baseRoomId}&mode=${selectedMode}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const urlRoom = getRoomFromUrl();
  const urlMode = getModeFromUrl();
  baseRoomId = urlRoom || generateRoomId();

  if (!urlRoom) {
    window.history.replaceState({}, '', `?room=${baseRoomId}`);
  }

  const roomIdInput = document.getElementById('room-id');
  if (roomIdInput) roomIdInput.value = baseRoomId;

  const savedName = sessionStorage.getItem('ottv2-player-name');
  if (savedName) {
    const nameInput = document.getElementById('player-name');
    if (nameInput) nameInput.value = savedName;
  }

  document.querySelectorAll('.mode-card').forEach(card => {
    if (card.classList.contains('selected')) selectedMode = card.dataset.mode;
    card.addEventListener('click', () => {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedMode = card.dataset.mode;
    });
  });

  const generateBtn = document.getElementById('generate-room');
  if (generateBtn) {
    generateBtn.addEventListener('click', () => {
      baseRoomId = generateRoomId();
      if (roomIdInput) roomIdInput.value = baseRoomId;
      window.history.replaceState({}, '', `?room=${baseRoomId}`);
    });
  }

  const copyBtn = document.getElementById('copy-link');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const link = `${window.location.origin}${window.location.pathname}?room=${baseRoomId}&mode=${selectedMode}`;
      navigator.clipboard.writeText(link).then(() => {
        const status = document.getElementById('lobby-status');
        if (status) {
          status.textContent = 'Đã sao chép link phòng!';
          status.style.display = 'block';
          setTimeout(() => { status.style.display = 'none'; }, 2000);
        }
      }).catch(() => {
        alert('Link phòng: ' + link);
      });
    });
  }

  const joinBtn = document.getElementById('join-btn');
  if (joinBtn) joinBtn.addEventListener('click', proceedToGame);

  const nameInput = document.getElementById('player-name');
  if (nameInput) {
    nameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') proceedToGame();
    });
  }

  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', resetGame);

  renderCoordinates();

  if (urlMode === '2p') {
    currentRoomId = baseRoomId;
    initTwoPlayerGame();
  } else if (urlMode === 'arena') {
    currentRoomId = baseRoomId;
    initArenaGame();
  } else {
    showScreen('lobby');
  }
});