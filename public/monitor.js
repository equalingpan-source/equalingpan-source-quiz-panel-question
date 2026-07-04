const socket = io({
  transports: ['websocket'],
  upgrade: false,
});

const params = new URLSearchParams(window.location.search);
const roomCode = String(params.get('room') || '').trim().toUpperCase();

const monitorQuestionPanel = document.getElementById('monitorQuestionPanel');
const monitorQuestionOrder = document.getElementById('monitorQuestionOrder');
const monitorQuestionText = document.getElementById('monitorQuestionText');
const monitorQuestionAnswer = document.getElementById('monitorQuestionAnswer');
const monitorBoard = document.getElementById('monitorBoard');
const monitorShell = document.querySelector('.monitor-shell');
let refitFrame = 0;
let currentRoom = null;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRoomPhase(room) {
  return room?.phase || 'setup';
}

function shouldUseCompactMonitorLayout() {
  return window.innerWidth <= 960 || window.innerHeight <= 720;
}

function shouldUseUltraCompactMonitorLayout() {
  return window.innerWidth <= 520 || window.innerHeight <= 560;
}

function getMonitorScale() {
  const widthScale = window.innerWidth <= 520 ? Math.max(0.72, window.innerWidth / 520) : 1;
  const heightScale = window.innerHeight <= 560 ? Math.max(0.78, window.innerHeight / 560) : 1;
  return Math.min(1, widthScale, heightScale);
}

function getMonitorGridColumns(playerCount) {
  if (playerCount <= 1) return 1;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isPortraitLike = viewportWidth < viewportHeight * 0.95;

  if (playerCount <= 2) {
    return viewportWidth <= 520 ? 1 : playerCount;
  }

  if (playerCount <= 4) {
    if (viewportWidth <= 440) return 1;
    return 2;
  }

  if (viewportWidth <= 520) return 1;
  if (viewportWidth <= 980 || isPortraitLike) return 2;
  return 3;
}

function fitAnswerText(element, container) {
  if (!element || !container) return;

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!width || !height) return;

  const safeWidth = Math.max(0, width - 24);
  const safeHeight = Math.max(0, height - 28);
  const minPx = shouldUseCompactMonitorLayout() ? 18 : 24;
  let low = minPx;
  let high = Math.max(minPx, Math.min(safeWidth * 0.92, safeHeight * 1.18));
  let best = minPx;

  element.style.maxWidth = `${safeWidth}px`;
  element.style.maxHeight = `${safeHeight}px`;

  while (high - low > 1) {
    const mid = (low + high) / 2;
    element.style.fontSize = `${mid}px`;

    const fitsHeight = element.scrollHeight <= safeHeight + 1;
    const fitsWidth = element.scrollWidth <= safeWidth + 1;

    if (fitsHeight && fitsWidth) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  element.style.fontSize = `${Math.max(minPx, best - 2)}px`;
}

function refitMonitorAnswerText() {
  monitorBoard.querySelectorAll('.board-tile').forEach((card) => {
    const container = card.querySelector('.board-tile-body');
    const answer = card.querySelector('.board-tile-answer-text');
    fitAnswerText(answer, container);
  });
}

function scheduleRefit() {
  if (refitFrame) {
    window.cancelAnimationFrame(refitFrame);
  }

  refitFrame = window.requestAnimationFrame(() => {
    refitFrame = 0;
    refitMonitorAnswerText();
  });
}

function renderQuestion(room) {
  const phase = getRoomPhase(room);
  const question = room.currentQuestion;
  const hasQuestion = !!question?.questionText;

  monitorQuestionPanel.classList.toggle('is-empty', !hasQuestion);
  monitorQuestionOrder.textContent = hasQuestion ? `Q${question.order}` : '問題未セット';
  monitorQuestionText.textContent = hasQuestion ? question.questionText : '親機で問題をセットしてください。';

  if (phase === 'revealResults' && question?.answerText) {
    monitorQuestionAnswer.textContent = `正解: ${question.answerText}`;
    monitorQuestionAnswer.classList.remove('hidden');
  } else {
    monitorQuestionAnswer.textContent = '';
    monitorQuestionAnswer.classList.add('hidden');
  }
}

function applyRoom(room) {
  currentRoom = room;
  const phase = getRoomPhase(room);
  renderQuestion(room);

  if (monitorShell) {
    const monitorScale = getMonitorScale();
    monitorShell.classList.toggle('mode-answers', phase === 'revealAnswers');
    monitorShell.classList.toggle('mode-correct', phase === 'revealResults');
    monitorShell.classList.toggle('is-compact', shouldUseCompactMonitorLayout());
    monitorShell.classList.toggle('is-ultra-compact', shouldUseUltraCompactMonitorLayout());
    monitorShell.style.setProperty('--monitor-scale', String(monitorScale));
    monitorShell.classList.toggle('is-scaled', monitorScale < 0.999);
  }

  const showAnswers = phase === 'revealAnswers' || phase === 'revealResults';
  const playerCount = room.board.length;
  const isSingleLayout = playerCount === 1;

  const cols = getMonitorGridColumns(playerCount);
  const rows = Math.max(1, Math.ceil(playerCount / cols));

  monitorBoard.classList.toggle('is-single-layout', isSingleLayout);
  monitorBoard.style.gridTemplateColumns = isSingleLayout ? 'minmax(0, 1fr)' : `repeat(${cols}, minmax(0, 1fr))`;
  monitorBoard.style.gridTemplateRows = isSingleLayout ? 'auto' : `repeat(${rows}, 1fr)`;

  const currentIds = new Set(room.board.map((player) => `player-${player.id}`));
  Array.from(monitorBoard.children).forEach((child) => {
    if (!currentIds.has(child.id) && !child.classList.contains('board-empty-message')) {
      child.remove();
    }
  });

  if (!room.board.length) {
    if (!monitorBoard.querySelector('.board-empty-message')) {
      monitorBoard.innerHTML = '<div class="board-empty-message board-empty-dark">参加待ち</div>';
    }
    return;
  }

  const emptyMsg = monitorBoard.querySelector('.board-empty-message');
  if (emptyMsg) emptyMsg.remove();

  room.board
    .slice()
    .sort((left, right) => left.slot - right.slot)
    .forEach((player) => {
      let card = document.getElementById(`player-${player.id}`);
      if (!card) {
        card = document.createElement('div');
        card.id = `player-${player.id}`;
        card.className = 'board-tile';
        monitorBoard.appendChild(card);
      }

      const shouldShowRed = player.result === 'correct' && phase === 'revealResults';
      const isLockedVisual = phase !== 'open' || !!player.locked;

      card.classList.toggle('is-correct', shouldShowRed);
      card.classList.toggle('is-locked-visual', isLockedVisual);
      card.classList.toggle('is-hidden-state', !showAnswers);

      const text = player.displayText || ' ';
      const isHandwriting = player.displayMode === 'handwriting' && !!player.displayImage;

      const bodyContent = showAnswers
        ? (
          isHandwriting
            ? `<div class="board-tile-answer-art"><img class="board-tile-answer-image" src="${player.displayImage}" alt="手書き回答" /></div>`
            : `<div class="board-tile-answer-text">${escapeHtml(text)}</div>`
        )
        : `<div class="board-tile-placeholder-name">${escapeHtml(player.name)}</div>`;

      const nextHtml = `
        <div class="board-tile-body">${bodyContent}</div>
        ${showAnswers ? `<div class="board-tile-name">${escapeHtml(player.name)}</div>` : ''}
      `;

      if (card.innerHTML !== nextHtml) {
        card.innerHTML = nextHtml;
      }
    });

  if (showAnswers) {
    scheduleRefit();
  }
}

if (!roomCode) {
  monitorBoard.innerHTML = '<div class="board-empty-message board-empty-dark">ルーム情報がありません</div>';
} else {
  socket.emit('monitor:join', { roomCode }, (response) => {
    if (!response.ok) {
      monitorBoard.innerHTML = `<div class="board-empty-message board-empty-dark">${escapeHtml(
        response.message || '接続できませんでした'
      )}</div>`;
      return;
    }

    applyRoom(response.room);
  });
}

socket.on('monitor:room', (room) => {
  applyRoom(room);
});

socket.on('room:closed', () => {
  monitorQuestionOrder.textContent = '終了';
  monitorQuestionText.textContent = 'ルームが終了しました。';
  monitorQuestionAnswer.textContent = '';
  monitorQuestionAnswer.classList.add('hidden');
  monitorBoard.innerHTML = '<div class="board-empty-message board-empty-dark">ルームが終了しました</div>';
  if (monitorShell) {
    monitorShell.classList.remove('mode-answers', 'mode-correct');
  }
});

window.addEventListener('resize', () => {
  if (currentRoom) {
    applyRoom(currentRoom);
    return;
  }

  scheduleRefit();
});
