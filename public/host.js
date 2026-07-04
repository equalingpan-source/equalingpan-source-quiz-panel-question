const socket = io({
  transports: ['websocket'],
  upgrade: false,
});

const HOST_ROOM_KEY = 'quizPanelHostRoom';

const createSection = document.getElementById('createSection');
const controlSection = document.getElementById('controlSection');
const createRoomBtn = document.getElementById('createRoomBtn');
const createMessage = document.getElementById('createMessage');
const controlMessage = document.getElementById('controlMessage');

const roomCodeEl = document.getElementById('roomCode');
const toggleInputBtn = document.getElementById('toggleInputBtn');
const toggleDisplayBtn = document.getElementById('toggleDisplayBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const monitorWaitBtn = document.getElementById('monitorWaitBtn');
const modeTextBtn = document.getElementById('modeTextBtn');
const modeHandwritingBtn = document.getElementById('modeHandwritingBtn');
const csvFileInput = document.getElementById('csvFileInput');
const csvFileName = document.getElementById('csvFileName');
const questionCountLabel = document.getElementById('questionCountLabel');
const questionList = document.getElementById('questionList');
const selectedQuestionOrder = document.getElementById('selectedQuestionOrder');
const selectedQuestionMode = document.getElementById('selectedQuestionMode');
const selectedQuestionText = document.getElementById('selectedQuestionText');
const selectedQuestionAnswer = document.getElementById('selectedQuestionAnswer');
const selectedQuestionNote = document.getElementById('selectedQuestionNote');
const applyQuestionBtn = document.getElementById('applyQuestionBtn');
const currentQuestionBanner = document.getElementById('currentQuestionBanner');
const playerCards = document.getElementById('playerCards');
const playerQrImage = document.getElementById('playerQrImage');
const playerUrlSelect = document.getElementById('playerUrlSelect');
const monitorUrlInput = document.getElementById('monitorUrlInput');
const copyPlayerUrlBtn = document.getElementById('copyPlayerUrlBtn');
const copyMonitorUrlBtn = document.getElementById('copyMonitorUrlBtn');
const openMonitorBtn = document.getElementById('openMonitorBtn');
const reloadNetworkBtn = document.getElementById('reloadNetworkBtn');

let currentRoom = null;
let urlCandidates = [];
let questionBank = [];
let selectedQuestionId = '';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setMessage(target, text, type = '') {
  target.textContent = text || '';
  target.className = 'status-text';
  if (type) target.classList.add(type);
}

function saveHostRoomCode(roomCode) {
  if (!roomCode) return;

  try {
    sessionStorage.setItem(HOST_ROOM_KEY, roomCode);
  } catch (_error) {
    // ignore storage failures
  }
}

function clearHostRoomCode() {
  try {
    sessionStorage.removeItem(HOST_ROOM_KEY);
  } catch (_error) {
    // ignore storage failures
  }
}

function resetToCreateView(message = '', type = '') {
  currentRoom = null;
  createSection.classList.remove('hidden');
  controlSection.classList.add('hidden');
  setMessage(createMessage, message, type);
}

async function copyTextToClipboard(text, buttonEl) {
  const value = String(text || '');
  if (!value) return false;

  let success = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      success = true;
    } catch (_error) {
      success = false;
    }
  }

  if (!success) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      success = document.execCommand('copy');
    } catch (_error) {
      success = false;
    }

    document.body.removeChild(textarea);
  }

  if (success && buttonEl) {
    const originalText = buttonEl.textContent;
    buttonEl.textContent = 'コピー済み';
    buttonEl.classList.add('button-success');
    setTimeout(() => {
      buttonEl.textContent = originalText;
      buttonEl.classList.remove('button-success');
    }, 1800);
  }

  return success;
}

function getPlayerJoinUrl(baseUrl, roomCode) {
  const url = new URL('/player-entry.html', baseUrl);
  url.searchParams.set('room', roomCode);
  return url.toString();
}

function getMonitorUrl(baseUrl, roomCode) {
  const url = new URL('/monitor.html', baseUrl);
  url.searchParams.set('room', roomCode);
  return url.toString();
}

function isPrivateIpv4Host(hostname) {
  return /^(10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function shouldIncludeLanCandidates() {
  const hostname = String(window.location.hostname || '').toLowerCase();
  return hostname === 'localhost' || hostname === '::1' || isPrivateIpv4Host(hostname);
}

function getRoomPhase(room) {
  return room?.phase || 'setup';
}

function parseCsvRows(text) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(current);
      if (row.some((cell) => String(cell || '').trim())) {
        rows.push(row);
      }
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => String(cell || '').trim())) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
}

function normalizeQuestionMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (['handwriting', 'draw', 'drawing', '手書き'].includes(normalized)) {
    return 'handwriting';
  }
  return 'text';
}

function pickColumn(row, headers, keys, fallback = '') {
  for (const key of keys) {
    const index = headers.indexOf(key);
    if (index >= 0) {
      return row[index] || fallback;
    }
  }
  return fallback;
}

function buildQuestionBankFromCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((cell) => normalizeHeader(cell));

  return rows
    .slice(1)
    .map((row, index) => {
      const questionText = String(
        pickColumn(row, headers, ['question', '問題', 'problem'], row[0] || '')
      ).trim();
      const answerText = String(
        pickColumn(row, headers, ['answer', '回答', 'correct'], row[1] || '')
      ).trim();
      const note = String(pickColumn(row, headers, ['note', 'メモ'], '')).trim();
      const mode = normalizeQuestionMode(
        pickColumn(row, headers, ['answermode', 'mode', '回答方式'], '')
      );
      const orderRaw = pickColumn(row, headers, ['order', 'no', 'number', '問題番号'], `${index + 1}`);

      return {
        id: `q-${index + 1}`,
        order: Number(orderRaw) || index + 1,
        questionText,
        answerText,
        answerMode: mode,
        note,
      };
    })
    .filter((question) => question.questionText);
}

function getSelectedQuestion() {
  return questionBank.find((question) => question.id === selectedQuestionId) || null;
}

function getSortedQuestionBank() {
  return questionBank
    .slice()
    .sort((left, right) => left.order - right.order);
}

function getPreviewQuestion() {
  return getSelectedQuestion() || currentRoom?.currentQuestion || null;
}

function getQuestionModeLabel(mode) {
  return mode === 'handwriting' ? '手書き' : '通常入力';
}

function getPreviewMode(question) {
  if (question?.answerMode === 'handwriting' || question?.answerMode === 'text') {
    return question.answerMode;
  }
  return currentRoom?.answerMode || 'text';
}

function renderSelectedQuestion() {
  const question = getPreviewQuestion();
  const phase = getRoomPhase(currentRoom);
  const selected = getSelectedQuestion();
  const previewMode = getPreviewMode(question);

  selectedQuestionOrder.textContent = question ? `Q${question.order || '-'}` : '未選択';
  selectedQuestionMode.textContent = getQuestionModeLabel(previewMode);
  selectedQuestionText.textContent = question ? question.questionText : '問題を選ぶとここに表示されます。';

  if (question?.answerText) {
    selectedQuestionAnswer.textContent = `答え: ${question.answerText}`;
    selectedQuestionAnswer.classList.remove('hidden');
  } else {
    selectedQuestionAnswer.textContent = '';
    selectedQuestionAnswer.classList.add('hidden');
  }

  if (question?.note) {
    selectedQuestionNote.textContent = question.note;
    selectedQuestionNote.classList.remove('hidden');
  } else {
    selectedQuestionNote.textContent = '';
    selectedQuestionNote.classList.add('hidden');
  }

  const canApply = !!currentRoom && !!selected && phase === 'setup';
  applyQuestionBtn.disabled = !canApply;
}

function renderQuestionBank() {
  questionList.innerHTML = '';

  if (!questionBank.length) {
    const empty = document.createElement('div');
    empty.className = 'host-question-empty';
    empty.textContent = '問題なし';
    questionList.appendChild(empty);
    renderSelectedQuestion();
    return;
  }

  getSortedQuestionBank()
    .forEach((question) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `host-question-item${question.id === selectedQuestionId ? ' is-selected' : ''}`;
      button.innerHTML = `
        <span class="host-question-item-order">Q${question.order}</span>
        <span class="host-question-item-text">${escapeHtml(question.questionText)}</span>
      `;
      button.addEventListener('click', () => {
        selectedQuestionId = question.id;
        renderQuestionBank();
      });
      questionList.appendChild(button);
    });

  renderSelectedQuestion();
}

function renderPlayerCards(room) {
  playerCards.innerHTML = '';

  if (!room.board.length) {
    const empty = document.createElement('div');
    empty.className = 'board-empty-message';
    empty.textContent = '参加待ち';
    playerCards.appendChild(empty);
    return;
  }

  room.board
    .slice()
    .sort((left, right) => left.slot - right.slot)
    .forEach((player) => {
      const card = document.createElement('div');
      card.classList.add('host-answer-card');
      const phase = getRoomPhase(room);
      const canToggleResult = phase === 'locked' || phase === 'revealAnswers' || phase === 'revealResults';
      const canUnlockPlayer = phase === 'open' && player.locked && player.connected;

      const isCorrect = player.result === 'correct';
      const isLockedVisual = phase !== 'open' || !!player.locked;
      const canRemovePlayer = !player.connected;

      card.classList.toggle('is-correct', isCorrect);
      card.classList.toggle('is-locked-visual', isLockedVisual);
      card.classList.toggle('is-clickable', canToggleResult);
      card.classList.toggle('is-disconnected', canRemovePlayer);

      const resultLabel = isCorrect ? '正解' : '';
      const text = player.answerText || ' ';
      const isHandwriting = player.answerMode === 'handwriting' && !!player.answerImage;
      const charCount = Array.from(text).length;
      let fontSize = '1.2rem';

      if (charCount <= 4) fontSize = '1.8rem';
      else if (charCount <= 8) fontSize = '1.5rem';
      else if (charCount <= 12) fontSize = '1.3rem';
      else fontSize = '1.1rem';

      const answerMarkup = isHandwriting
        ? `<img class="host-card-surface host-card-image" src="${player.answerImage}" alt="手書き回答" />`
        : `<div class="host-card-surface host-card-text" style="font-size: ${fontSize}">${escapeHtml(text)}</div>`;

      card.innerHTML = `
        <div class="host-card-header">
          <span class="host-card-slot">${player.slot}</span>
          <span class="host-card-badge">${resultLabel}</span>
        </div>
        <div class="host-card-body">${answerMarkup}</div>
        <div class="host-card-footer">
          <span class="host-card-name">${escapeHtml(player.name)}</span>
        </div>
        <div class="host-lock-indicator"></div>
        ${canUnlockPlayer ? '<button class="host-card-unlock" type="button">解除</button>' : ''}
        ${canRemovePlayer ? '<button class="host-card-remove" type="button">削除</button>' : ''}
      `;

      card.addEventListener('click', (event) => {
        if (event.target.closest('.host-card-remove') || event.target.closest('.host-card-unlock')) {
          return;
        }
        if (!canToggleResult) {
          return;
        }

        const nextResult = player.result === 'correct' ? 'pending' : 'correct';
        socket.emit(
          'host:setResult',
          { roomCode: room.code, playerId: player.id, result: nextResult },
          (response) => {
            if (!response.ok) {
              setMessage(controlMessage, response.message, 'warn');
              return;
            }

            setMessage(
              controlMessage,
              nextResult === 'correct'
                ? `${player.name} を正解にしました。`
                : `${player.name} の正解を外しました。`,
              'ok'
            );
          }
        );
      });

      const removeBtn = card.querySelector('.host-card-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', (event) => {
          event.stopPropagation();

          socket.emit('host:removePlayer', { roomCode: room.code, playerId: player.id }, (response) => {
            if (!response.ok) {
              setMessage(controlMessage, response.message, 'warn');
              return;
            }

            setMessage(controlMessage, `${player.name} を削除しました。`, 'ok');
          });
        });
      }

      const unlockBtn = card.querySelector('.host-card-unlock');
      if (unlockBtn) {
        unlockBtn.addEventListener('click', (event) => {
          event.stopPropagation();

          socket.emit('host:unlockPlayer', { roomCode: room.code, playerId: player.id }, (response) => {
            if (!response.ok) {
              setMessage(controlMessage, response.message, 'warn');
              return;
            }

            setMessage(controlMessage, `${player.name} のロックを解除しました。`, 'ok');
          });
        });
      }

      playerCards.appendChild(card);
    });
}

function renderUrlOptions(room) {
  playerUrlSelect.innerHTML = '';

  urlCandidates.forEach((baseUrl, index) => {
    const option = document.createElement('option');
    option.value = getPlayerJoinUrl(baseUrl, room.code);
    option.textContent = option.value;
    option.selected = index === 0;
    playerUrlSelect.appendChild(option);
  });

  const selectedPlayerUrl = playerUrlSelect.value || getPlayerJoinUrl(window.location.origin, room.code);
  const selectedBaseUrl = new URL(selectedPlayerUrl).origin;
  playerQrImage.src = `/api/qr?text=${encodeURIComponent(selectedPlayerUrl)}`;
  monitorUrlInput.value = getMonitorUrl(selectedBaseUrl, room.code);
}

async function loadNetworkCandidates() {
  const candidateSet = new Set([window.location.origin]);

  try {
    const response = await fetch('/api/network-info', { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      const port = Number(payload?.port) || window.location.port || 3000;
      if (shouldIncludeLanCandidates()) {
        (payload?.lanAddresses || []).forEach(({ address }) => {
          if (address) {
            candidateSet.add(`http://${address}:${port}`);
          }
        });
      }
    }
  } catch (_error) {
    // keep current origin only
  }

  const allCandidates = Array.from(candidateSet);
  const preferred = allCandidates.find((url) => !/localhost|127\.0\.0\.1/.test(url)) || window.location.origin;
  urlCandidates = [preferred, ...allCandidates.filter((url) => url !== preferred)];

  if (currentRoom) {
    renderUrlOptions(currentRoom);
  }
}

function renderAnswerMode(room) {
  const phase = getRoomPhase(room);
  const isHandwriting = room.answerMode === 'handwriting';
  modeTextBtn.className = `button host-mode-button${!isHandwriting ? ' button-primary' : ''}`;
  modeHandwritingBtn.className = `button host-mode-button${isHandwriting ? ' button-primary' : ''}`;
  modeTextBtn.disabled = phase === 'open';
  modeHandwritingBtn.disabled = phase === 'open';
}

function renderCurrentQuestionBanner(room) {
  const question = room.currentQuestion;
  currentQuestionBanner.textContent = question ? `セット中 Q${question.order}` : '未セット';
}

function configureActionButton(button, config) {
  button.textContent = config.label;
  const roleClass = button.id === 'toggleInputBtn' ? 'host-primary-action' : 'host-monitor-action';
  button.className = `button ${roleClass} ${config.className}`.trim();
  button.disabled = !!config.disabled;
  button.dataset.targetPhase = config.targetPhase || '';
  button.dataset.successMessage = config.successMessage || '';
}

function getPrimaryActionConfig(room) {
  const phase = getRoomPhase(room);
  const hasMode = room.answerMode === 'text' || room.answerMode === 'handwriting';
  const hasQuestion = !!room.currentQuestion?.questionText;

  if (phase === 'setup') {
    return {
      label: '回答開始',
      className: 'button-success',
      targetPhase: 'open',
      successMessage: '回答受付を開始しました。',
      disabled: !hasMode || !hasQuestion,
    };
  }

  if (phase === 'open') {
    return {
      label: '回答終了',
      className: 'button-danger',
      targetPhase: 'locked',
      successMessage: '回答受付を終了しました。',
      disabled: false,
    };
  }

  if (phase === 'locked') {
    return {
      label: '締め切り解除',
      className: 'button-success',
      targetPhase: 'open',
      successMessage: '回答受付を再開しました。',
      disabled: false,
    };
  }

  return {
    label: '次の問題へ',
    className: 'button-success',
    targetPhase: 'nextRound',
    successMessage: '次の問題に切り替えました。',
    disabled: false,
  };
}

function getMonitorActionEnabled(room) {
  const phase = getRoomPhase(room);
  return room.playerCount > 0 && phase !== 'setup' && phase !== 'open';
}

function syncSelectionWithCurrentQuestion(room) {
  if (!room.currentQuestion || !questionBank.length) {
    return;
  }

  const currentSelectionExists = questionBank.some((question) => question.id === selectedQuestionId);
  if (currentSelectionExists) {
    return;
  }

  const matchingQuestion = questionBank.find(
    (question) => question.order === room.currentQuestion.order
      && question.questionText === room.currentQuestion.questionText
  );

  if (matchingQuestion) {
    selectedQuestionId = matchingQuestion.id;
  }
}

function getNextQuestionForNextRound() {
  if (!questionBank.length) {
    return null;
  }

  const orderedQuestions = getSortedQuestionBank();
  const currentQuestion = currentRoom?.currentQuestion;
  const currentIndex = orderedQuestions.findIndex(
    (question) => question.id === selectedQuestionId
      || (
        currentQuestion
        && question.order === currentQuestion.order
        && question.questionText === currentQuestion.questionText
      )
  );

  if (currentIndex < 0) {
    return getSelectedQuestion() || orderedQuestions[0] || null;
  }

  return orderedQuestions[currentIndex + 1] || orderedQuestions[currentIndex] || null;
}

function applyQuestionByValue(question, successMessage) {
  if (!currentRoom || !question) return;

  socket.emit('host:setQuestion', { roomCode: currentRoom.code, question }, (response) => {
    if (!response.ok) {
      setMessage(controlMessage, response.message, 'warn');
      return;
    }

    setMessage(controlMessage, successMessage, 'ok');
  });
}

function renderRoom(room) {
  currentRoom = room;
  saveHostRoomCode(room.code);
  createSection.classList.add('hidden');
  controlSection.classList.remove('hidden');

  syncSelectionWithCurrentQuestion(room);

  const phase = getRoomPhase(room);
  const onAirLabel = document.getElementById('hostOnAirLabel');
  const isStageLocked = phase === 'setup' || phase === 'locked';

  controlSection.classList.toggle('is-input-locked', isStageLocked);
  controlSection.classList.toggle('is-answer-revealed', phase === 'revealResults');
  controlSection.classList.toggle('mode-answers', phase === 'revealAnswers');
  controlSection.classList.toggle('mode-correct', phase === 'revealResults');

  if (onAirLabel) {
    if (phase === 'setup') onAirLabel.textContent = '準備中';
    else if (phase === 'open') onAirLabel.textContent = '回答受付中';
    else if (phase === 'locked') onAirLabel.textContent = '受付終了';
    else if (phase === 'revealAnswers') onAirLabel.textContent = '回答表示中';
    else onAirLabel.textContent = '正解表示中';
  }

  roomCodeEl.textContent = room.code;

  configureActionButton(toggleInputBtn, getPrimaryActionConfig(room));
  const monitorEnabled = getMonitorActionEnabled(room);

  toggleDisplayBtn.textContent = 'モニターへ回答表示';
  toggleDisplayBtn.className = 'button host-monitor-action button-primary';
  toggleDisplayBtn.disabled = !monitorEnabled;

  clearAllBtn.textContent = 'モニターへ正解表示';
  clearAllBtn.className = 'button host-monitor-action button-danger';
  clearAllBtn.disabled = !monitorEnabled;

  monitorWaitBtn.textContent = 'モニターを待機に戻す';
  monitorWaitBtn.className = 'button host-monitor-action';
  monitorWaitBtn.disabled = !monitorEnabled || phase === 'locked';

  renderAnswerMode(room);
  renderCurrentQuestionBanner(room);
  renderQuestionBank();
  renderPlayerCards(room);
  renderUrlOptions(room);
}

function setHostAnswerMode(mode) {
  if (!currentRoom) return;

  socket.emit('host:setAnswerMode', { roomCode: currentRoom.code, mode }, (response) => {
    if (!response.ok) {
      setMessage(controlMessage, response.message, 'warn');
      return;
    }

    setMessage(
      controlMessage,
      mode === 'handwriting' ? '回答方法を手書きにしました。' : '回答方法を通常入力にしました。',
      'ok'
    );
  });
}

function applySelectedQuestion() {
  if (!currentRoom) return;

  const question = getSelectedQuestion();
  if (!question) {
    setMessage(controlMessage, '問題を選択してください。', 'warn');
    return;
  }

  socket.emit('host:setQuestion', { roomCode: currentRoom.code, question }, (response) => {
    if (!response.ok) {
      setMessage(controlMessage, response.message, 'warn');
      return;
    }

    setMessage(controlMessage, `Q${question.order} をセットしました。`, 'ok');
  });
}

function changeRoomPhase(targetPhase, successMessage) {
  if (!currentRoom || !targetPhase) return;

  socket.emit('host:setPhase', { roomCode: currentRoom.code, phase: targetPhase }, (response) => {
    if (!response.ok) {
      setMessage(controlMessage, response.message, 'warn');
      return;
    }

    setMessage(controlMessage, successMessage, 'ok');
  });
}

function resetCurrentRound() {
  if (!currentRoom) return;

  const confirmed = window.confirm('現在の回答をリセットしていいですか？');
  if (!confirmed) return;

  socket.emit('host:clearAll', { roomCode: currentRoom.code, nextPhase: 'setup' }, (response) => {
    if (!response.ok) {
      setMessage(controlMessage, response.message, 'warn');
      return;
    }

    setMessage(controlMessage, '次の問題へ切り替えました。', 'ok');
  });
}

async function loadQuestionCsv(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const nextQuestionBank = buildQuestionBankFromCsv(text);

    if (!nextQuestionBank.length) {
      questionBank = [];
      selectedQuestionId = '';
      csvFileName.textContent = file.name;
      questionCountLabel.textContent = '0問';
      renderQuestionBank();
      setMessage(controlMessage, '読み込める問題がありませんでした。', 'warn');
      return;
    }

    questionBank = nextQuestionBank;

    const matchedCurrentQuestion = currentRoom?.currentQuestion
      ? questionBank.find(
          (question) => question.order === currentRoom.currentQuestion.order
            && question.questionText === currentRoom.currentQuestion.questionText
        )
      : null;

    selectedQuestionId = matchedCurrentQuestion?.id || questionBank[0].id;
    csvFileName.textContent = file.name;
    questionCountLabel.textContent = `${questionBank.length}問`;
    renderQuestionBank();
    setMessage(controlMessage, `${questionBank.length}問を読み込みました。`, 'ok');
  } catch (_error) {
    questionBank = [];
    selectedQuestionId = '';
    csvFileName.textContent = '未読込';
    questionCountLabel.textContent = '0問';
    renderQuestionBank();
    setMessage(controlMessage, 'CSVを読み込めませんでした。', 'warn');
  } finally {
    csvFileInput.value = '';
  }
}

function goToNextRoundWithSelection() {
  if (!currentRoom) return;

  const nextQuestion = getNextQuestionForNextRound();
  const confirmed = window.confirm('現在の回答をリセットして、次の問題へ進みますか？');
  if (!confirmed) return;

  socket.emit('host:clearAll', { roomCode: currentRoom.code, nextPhase: 'setup' }, (response) => {
    if (!response.ok) {
      setMessage(controlMessage, response.message, 'warn');
      return;
    }

    if (nextQuestion) {
      selectedQuestionId = nextQuestion.id;
      renderQuestionBank();
      applyQuestionByValue(nextQuestion, `Q${nextQuestion.order} を次の問題としてセットしました。`);
      return;
    }

    setMessage(controlMessage, '回答をリセットしました。', 'ok');
  });
}

createRoomBtn.addEventListener('click', () => {
  socket.emit('host:create', {}, (response) => {
    if (!response.ok) {
      setMessage(createMessage, response.message, 'warn');
      return;
    }

    setMessage(createMessage, '');
    renderRoom(response.room);
    setMessage(controlMessage, 'ルームを作成しました。', 'ok');
  });
});

toggleInputBtn.addEventListener('click', () => {
  if (toggleInputBtn.dataset.targetPhase === 'nextRound') {
    goToNextRoundWithSelection();
    return;
  }

  changeRoomPhase(toggleInputBtn.dataset.targetPhase, toggleInputBtn.dataset.successMessage);
});

toggleDisplayBtn.addEventListener('click', () => {
  changeRoomPhase('revealAnswers', 'モニターに回答を表示しました。');
});

clearAllBtn.addEventListener('click', () => {
  changeRoomPhase('revealResults', 'モニターに正解を表示しました。');
});

modeTextBtn.addEventListener('click', () => {
  setHostAnswerMode('text');
});

modeHandwritingBtn.addEventListener('click', () => {
  setHostAnswerMode('handwriting');
});

monitorWaitBtn.addEventListener('click', () => {
  changeRoomPhase('locked', 'モニターを待機に戻しました。');
});

applyQuestionBtn.addEventListener('click', () => {
  applySelectedQuestion();
});

csvFileInput.addEventListener('change', async () => {
  const file = csvFileInput.files?.[0];
  await loadQuestionCsv(file);
});

playerUrlSelect.addEventListener('change', () => {
  if (!currentRoom) return;

  playerQrImage.src = `/api/qr?text=${encodeURIComponent(playerUrlSelect.value)}`;
  monitorUrlInput.value = getMonitorUrl(new URL(playerUrlSelect.value).origin, currentRoom.code);
});

copyPlayerUrlBtn.addEventListener('click', async () => {
  if (!playerUrlSelect.value) return;

  const copied = await copyTextToClipboard(playerUrlSelect.value, copyPlayerUrlBtn);
  setMessage(controlMessage, copied ? '参加URLをコピーしました。' : '参加URLをコピーできませんでした。', copied ? 'ok' : 'warn');
});

copyMonitorUrlBtn.addEventListener('click', async () => {
  if (!monitorUrlInput.value) return;

  const copied = await copyTextToClipboard(monitorUrlInput.value, copyMonitorUrlBtn);
  setMessage(controlMessage, copied ? 'モニターURLをコピーしました。' : 'モニターURLをコピーできませんでした。', copied ? 'ok' : 'warn');
});

openMonitorBtn.addEventListener('click', () => {
  if (!monitorUrlInput.value) return;
  window.open(monitorUrlInput.value, 'quiz-panel-questionboard-monitor');
});

reloadNetworkBtn.addEventListener('click', async () => {
  await loadNetworkCandidates();
  setMessage(controlMessage, 'URLを更新しました。', 'ok');
});

socket.on('host:room', (room) => {
  renderRoom(room);
});

socket.on('room:closed', () => {
  clearHostRoomCode();
  resetToCreateView('ルームとの接続が切れました。もう一度作成してください。', 'warn');
});

loadNetworkCandidates();

try {
  const savedRoomCode = String(sessionStorage.getItem(HOST_ROOM_KEY) || '').trim().toUpperCase();
  if (savedRoomCode) {
    setMessage(createMessage, '前回のルームに接続しています。');
    socket.emit('host:resume', { roomCode: savedRoomCode }, (response) => {
      if (!response.ok) {
        clearHostRoomCode();
        setMessage(createMessage, '前回のルームには接続できませんでした。新しく作成してください。', 'warn');
        return;
      }

      setMessage(createMessage, '');
      renderRoom(response.room);
      setMessage(controlMessage, 'ルームに接続しました。', 'ok');
    });
  }
} catch (_error) {
  // ignore storage failures
}
