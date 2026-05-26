/* =========================================================
   pages/roadmap-plan.js — 로드맵 관리 (PRD 4.6)
   1년치 보드: 미배치 / Q1 / Q2 / Q3 / Q4
   - Jira 카드: initiatives.json 에서 자동 (read-only, D&D 시 토스트 안내)
   - 키워드 카드: **localStorage 가 SoT**, 파일은 첫 시드 + 백업
     → 파일이 갱신돼도 LS 가 있으면 그대로 둠. "↓ JSON Export" 로 공유.
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading, emptyHtml } from '../states.js';
import { jiraKeyHtml, jiraUrl } from '../jira-link.js';
import { scoped } from '../storage.js';
import { toast } from '../toast.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { attachModal } from '../modal.js';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const SUBJECT_CLASS_MAP = {
  '01.추천': 's-rec',
  '02.검색': 's-srch',
  '03.랭킹': 's-rank',
  '04.개인화': 's-pers',
  '05.디스커버리': 's-disc',
};
const FILTERS_KEY = 'roadmapPlan.filters';
const SCHEMA_VERSION = 1;
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,11}$/; // Jira project key

const GROUP_KEY = 'roadmapPlan.groupBy';

let state = {
  rootRel: '',
  year: 2026,
  jiraCards: [],
  keywordCards: [],
  filters: { mainSubject: null, priority: null, project: null },
  groupBy: 'subject',  // 'subject' | 'none'
  cardsStore: null,
};

export async function renderRoadmapPlan({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  state.year = currentYear();
  state.filters = Object.assign({ mainSubject: null, priority: null, project: null },
    scoped(FILTERS_KEY).get({}));
  const savedGroup = scoped(GROUP_KEY).get(null);
  if (savedGroup === 'subject' || savedGroup === 'none') state.groupBy = savedGroup;

  renderYearSelect();
  bindTopActions();
  bindGroupToggle();

  await loadAll();
  refreshFiltersForValidity();
  renderFilters();
  renderHeader();
  renderBoard();
}

/* ----- 데이터 로드 ----------------------------------------- */

async function loadAll() {
  const boardHost = document.getElementById('plan-board');
  showLoading(boardHost, { rows: 4, title: false });
  state.cardsStore = scoped(`roadmapPlan.cards.${state.year}`);

  // Jira initiatives → year 매칭만
  try {
    const data = await loadJson(`${state.rootRel}data/jira/initiatives.json`);
    state.jiraCards = (data.items || [])
      .map(it => initiativeToCard(it))
      .filter(c => c && c.year === state.year);
  } catch (err) {
    console.warn('[roadmap-plan] initiatives load failed', err);
    state.jiraCards = [];
  }

  // 키워드 카드: LS 가 SoT — 없을 때만 파일에서 시드
  const lsCards = state.cardsStore.get(null);
  if (Array.isArray(lsCards)) {
    state.keywordCards = lsCards.map(normalizeKeywordCard);
  } else {
    try {
      const file = await loadJson(`${state.rootRel}data/plans/roadmap-${state.year}.json`);
      state.keywordCards = (file.cards || []).map(normalizeKeywordCard);
      persistCards();
    } catch (_) {
      state.keywordCards = [];
      persistCards();
    }
  }
}

/** 카드를 LS 에 저장. 실패 시 토스트 안내. */
function persistCards() {
  const ok = state.cardsStore.set(state.keywordCards);
  if (!ok) {
    toast({
      kicker: '저장 실패',
      msg: 'localStorage 에 저장하지 못했습니다 (용량/권한).',
      meta: '메모리에만 보관됩니다. "↓ JSON Export" 로 즉시 백업하세요.',
      kind: 'alert',
      hold: 8000,
    });
  }
  return ok;
}

function initiativeToCard(it) {
  if (!it || !it.yearQuarter) return null;
  const m = /^(\d{4})-(Q[1-4])$/.exec(it.yearQuarter);
  if (!m) return null;
  return {
    id: 'jira-' + it.key,
    type: 'jira',
    year: Number(m[1]),
    quarter: m[2],
    ticketKey: it.key,
    title: it.summary || '',
    mainSubject: it.mainSubject || '',
    priority: it.priority || '',
    projectKey: it.project || '',
    status: it.status || '',
  };
}

function normalizeKeywordCard(c) {
  return {
    id: c.id || newCardId(),
    type: 'keyword',
    year: Number(c.year) || state.year,
    quarter: c.quarter || null,
    title: c.title || '',
    mainSubject: c.mainSubject || '',
    priority: c.priority || '',
    projectKey: c.projectKey || '',
    ticketKey: c.ticketKey || '',  // optional: 사용자가 직접 연결한 Jira 키
    notes: c.notes || '',
    createdAt: c.createdAt || new Date().toISOString(),
    updatedAt: c.updatedAt || new Date().toISOString(),
  };
}

// 메인주제 그룹 표시 순서 (디자인 시스템 5+ 기준)
const SUBJECT_ORDER = ['01.추천', '02.검색', '03.랭킹', '04.개인화', '05.디스커버리'];
const SUBJECT_UNCATEGORIZED = '(미분류)';

function newCardId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'kw-' + crypto.randomUUID();
  }
  // fallback (older browsers): ms timestamp + 8 base36 chars
  return 'kw-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 10);
}

/* ----- 헤더 / 컨트롤 --------------------------------------- */

function renderYearSelect() {
  const sel = document.getElementById('plan-year');
  if (!sel) return;
  sel.value = String(state.year);
  sel.addEventListener('change', async () => {
    state.year = Number(sel.value);
    await loadAll();
    refreshFiltersForValidity();
    renderFilters();
    renderHeader();
    renderBoard();
  });
}

function bindTopActions() {
  const addBtn = document.getElementById('btn-add-kw');
  const exportBtn = document.getElementById('btn-export');
  if (addBtn) addBtn.addEventListener('click', () => openCardModal(null));
  if (exportBtn) exportBtn.addEventListener('click', exportJson);
}

function bindGroupToggle() {
  document.querySelectorAll('[data-group-by]').forEach(btn => {
    const updateActive = () => {
      btn.classList.toggle('active', btn.dataset.groupBy === state.groupBy);
    };
    updateActive();
    btn.addEventListener('click', () => {
      state.groupBy = btn.dataset.groupBy;
      scoped(GROUP_KEY).set(state.groupBy);
      document.querySelectorAll('[data-group-by]').forEach(b =>
        b.classList.toggle('active', b.dataset.groupBy === state.groupBy));
      renderBoard();
    });
  });
}

function renderHeader() {
  const lede = document.querySelector('[data-lede]');
  if (!lede) return;
  const total = state.jiraCards.length + state.keywordCards.length;
  const visible = filteredAll();
  const filtered = visible.length !== total;
  const pool = visible.filter(c => !c.quarter).length;
  const filterNote = filtered
    ? ` · <strong class="num accent">${visible.length}</strong>장 표시 중 (필터 적용)`
    : '';
  lede.innerHTML =
    `<strong class="num">${state.year}</strong> 전체 <strong class="num">${total}</strong>장 ` +
    `(Jira <strong class="num">${state.jiraCards.length}</strong> · 키워드 <strong class="num">${state.keywordCards.length}</strong>)` +
    `${filterNote}. 미배치 <strong class="num">${pool}</strong>장.`;
}

/* ----- 필터 ------------------------------------------------ */

/** 현재 카드 풀에 없는 필터 값은 자동 해제 (연도 변경 시 핵심). */
function refreshFiltersForValidity() {
  const all = [...state.jiraCards, ...state.keywordCards];
  const fields = ['mainSubject', 'priority', 'projectKey'];
  const filterToField = { mainSubject: 'mainSubject', priority: 'priority', project: 'projectKey' };
  let changed = false;
  for (const [filter, field] of Object.entries(filterToField)) {
    const v = state.filters[filter];
    if (!v) continue;
    const exists = all.some(c => c[field] === v);
    if (!exists) { state.filters[filter] = null; changed = true; }
  }
  if (changed) {
    scoped(FILTERS_KEY).set(state.filters);
    toast({ kicker: '필터 정리됨', msg: '연도에 없는 필터값은 자동 해제했습니다.' });
  }
}

function renderFilters() {
  const host = document.getElementById('plan-filters');
  if (!host) return;
  const allCards = [...state.jiraCards, ...state.keywordCards];
  const subjects = [...new Set(allCards.map(c => c.mainSubject).filter(Boolean))].sort();
  const priorities = [...new Set(allCards.map(c => c.priority).filter(Boolean))].sort();
  const projects = [...new Set(allCards.map(c => c.projectKey).filter(Boolean))].sort();

  const hasAny = state.filters.mainSubject || state.filters.priority || state.filters.project;
  host.innerHTML = `
    ${chipGroup('mainSubject', '메인주제', subjects, state.filters.mainSubject)}
    ${chipGroup('priority', '우선순위', priorities, state.filters.priority)}
    ${chipGroup('project', '프로젝트', projects, state.filters.project)}
    ${hasAny ? '<button type="button" class="tlink" data-filter-reset>필터 초기화</button>' : ''}
  `;
  host.querySelectorAll('button.fchip').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      const v = btn.dataset.value;
      state.filters[f] = state.filters[f] === v ? null : v;
      scoped(FILTERS_KEY).set(state.filters);
      renderFilters();
      renderBoard();
      renderHeader();
    });
  });
  const reset = host.querySelector('[data-filter-reset]');
  if (reset) reset.addEventListener('click', () => {
    state.filters = { mainSubject: null, priority: null, project: null };
    scoped(FILTERS_KEY).set(state.filters);
    renderFilters();
    renderBoard();
    renderHeader();
  });
}

function chipGroup(filterKey, label, options, current) {
  if (!options.length) return '';
  const chips = options.map(opt => {
    const on = current === opt;
    return `<button type="button" class="fchip ${on ? 'on' : ''}" data-filter="${escapeAttr(filterKey)}" data-value="${escapeAttr(opt)}">${escapeHtml(opt)}</button>`;
  }).join('');
  return `<span class="flabel">${escapeHtml(label)}</span>${chips}`;
}

function isFilterActive() {
  return !!(state.filters.mainSubject || state.filters.priority || state.filters.project);
}

function filteredAll() {
  const allCards = [...state.jiraCards, ...state.keywordCards];
  return allCards.filter(c => {
    if (state.filters.mainSubject && c.mainSubject !== state.filters.mainSubject) return false;
    if (state.filters.priority && c.priority !== state.filters.priority) return false;
    if (state.filters.project && c.projectKey !== state.filters.project) return false;
    return true;
  });
}

/* ----- 보드 / 컬럼 / 카드 ---------------------------------- */

function renderBoard() {
  const host = document.getElementById('plan-board');
  if (!host) return;
  const all = filteredAll();
  const pool = all.filter(c => !c.quarter);
  const byQ = q => all.filter(c => c.quarter === q);

  host.innerHTML = '';
  host.appendChild(columnEl('pool', '미배치', pool, { pool: true }));
  QUARTERS.forEach(q => {
    host.appendChild(columnEl(q, `${state.year} · ${q}`, byQ(q), {}));
  });
  if (isFilterActive()) {
    host.classList.add('plan-board-filtered');
  } else {
    host.classList.remove('plan-board-filtered');
  }
  bindDnd(host);
}

function columnEl(colId, label, cards, { pool }) {
  const col = document.createElement('div');
  col.className = 'plan-col' + (pool ? ' pool' : '') + (cards.length === 0 ? ' empty' : '');
  col.dataset.colId = colId;
  col.innerHTML = `
    <div class="plan-col-h">
      <span>${escapeHtml(label)}</span>
      <span class="ct num">${cards.length}</span>
    </div>
    ${cards.length === 0 ? '<div class="plan-col-drop">DROP HERE</div>' : ''}
  `;

  if (state.groupBy === 'subject') {
    // 메인주제별 그룹 헤더 + 그룹 내 카드들
    const groups = groupCardsBySubject(cards);
    for (const [subject, gcards] of groups) {
      const gh = document.createElement('div');
      gh.className = 'plan-group-h';
      gh.dataset.groupSubject = subject;
      gh.innerHTML = `
        <span class="plan-group-name">${escapeHtml(subject)}</span>
        <span class="ct num">${gcards.length}</span>
        <button type="button" class="plan-group-add" title="이 그룹에 카드 추가" aria-label="${escapeAttr(subject)} 그룹에 카드 추가">＋</button>
      `;
      gh.querySelector('.plan-group-add').addEventListener('click', () => {
        openCardModal(null, {
          mainSubject: subject === SUBJECT_UNCATEGORIZED ? '' : subject,
          quarter: pool ? null : colId,
        });
      });
      col.appendChild(gh);
      gcards.forEach(c => col.appendChild(cardEl(c)));
    }
  } else {
    cards.forEach(c => col.appendChild(cardEl(c)));
  }

  // 컬럼 하단 + 카드 추가 (분기 자동 채움)
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'tlink plan-add-btn';
  addBtn.textContent = '＋ 카드 추가';
  addBtn.addEventListener('click', () => {
    openCardModal(null, { quarter: pool ? null : colId });
  });
  col.appendChild(addBtn);
  return col;
}

/** 메인주제별로 카드를 묶음. 디자인 순서(SUBJECT_ORDER) → 그 외 알파벳 → 미분류. */
function groupCardsBySubject(cards) {
  const map = new Map();
  for (const c of cards) {
    const k = c.mainSubject || SUBJECT_UNCATEGORIZED;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  const orderedKeys = SUBJECT_ORDER.filter(s => map.has(s));
  const otherKeys = [...map.keys()].filter(s =>
    !SUBJECT_ORDER.includes(s) && s !== SUBJECT_UNCATEGORIZED
  ).sort();
  const result = [];
  for (const k of [...orderedKeys, ...otherKeys]) result.push([k, map.get(k)]);
  if (map.has(SUBJECT_UNCATEGORIZED)) result.push([SUBJECT_UNCATEGORIZED, map.get(SUBJECT_UNCATEGORIZED)]);
  return result;
}

function cardEl(card) {
  const el = document.createElement('article');
  const sc = SUBJECT_CLASS_MAP[card.mainSubject] || 's-misc';
  el.className = 'plan-card ' + sc + (card.type === 'keyword' ? ' k' : '');
  el.draggable = true;
  el.dataset.cardId = card.id;
  el.dataset.cardType = card.type;
  el.setAttribute('role', 'listitem');
  el.setAttribute('aria-label', card.title || card.ticketKey || '카드');

  const meta = [];
  if (card.type === 'jira') {
    meta.push(jiraKeyHtml(card.ticketKey));
  } else if (card.ticketKey) {
    // 사용자가 직접 연결한 Jira 키 (키워드 카드 + 티켓)
    meta.push(jiraKeyHtml(card.ticketKey));
  } else {
    meta.push(`<span class="tag">키워드</span>`);
  }
  if (card.mainSubject) meta.push(`<span>${escapeHtml(card.mainSubject)}</span>`);
  if (card.projectKey) meta.push(`<span>· ${escapeHtml(card.projectKey)}</span>`);
  if (card.priority) {
    const cls = priorityClass(card.priority);
    meta.push(`<span class="pri ${cls}">${escapeHtml(card.priority)}</span>`);
  }

  el.innerHTML = `
    <h5>${escapeHtml(card.title || '(제목 없음)')}</h5>
    <div class="pc-meta">${meta.join(' ')}</div>
    ${card.notes ? `<div class="pc-notes">${escapeHtml(card.notes)}</div>` : ''}
    ${card.type === 'keyword'
      ? `<div class="pc-actions">
           <button type="button" class="tlink" data-action="edit">편집</button>
           <button type="button" class="tlink alert-color" data-action="delete">삭제</button>
         </div>`
      : ''}
  `;

  if (card.type === 'keyword') {
    el.querySelector('[data-action="edit"]').addEventListener('click', e => {
      e.stopPropagation();
      openCardModal(card);
    });
    el.querySelector('[data-action="delete"]').addEventListener('click', e => {
      e.stopPropagation();
      confirmDelete(card);
    });
  }
  return el;
}

function priorityClass(p) {
  const norm = String(p || '').toUpperCase();
  if (norm === 'P0') return 'pri-p0';
  if (norm === 'P1') return 'pri-p1';
  if (norm === 'P2') return 'pri-p2';
  if (norm === 'P3') return 'pri-p3';
  return '';
}

/* ----- D&D ------------------------------------------------- */

function bindDnd(boardEl) {
  let dragId = null;
  boardEl.addEventListener('dragstart', e => {
    // 필터 활성 시 D&D 비활성화 (리뷰 Critical #3 — 보이지 않는 카드가 잘못된 분기로 이동 방지)
    if (isFilterActive()) {
      e.preventDefault();
      toast({
        kicker: '필터 활성',
        msg: '카드 이동은 필터 해제 후 가능합니다.',
        meta: '필터 상태에서 이동하면 숨겨진 카드 위치가 의도와 다르게 바뀔 수 있습니다.',
        kind: 'alert',
      });
      return;
    }
    const card = e.target.closest('.plan-card');
    if (!card || !card.draggable) { e.preventDefault(); return; }
    dragId = card.dataset.cardId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    card.classList.add('dragging');
  });
  boardEl.addEventListener('dragend', e => {
    const card = e.target.closest('.plan-card');
    if (card) card.classList.remove('dragging');
    boardEl.querySelectorAll('.plan-col.drag-over').forEach(c => c.classList.remove('drag-over'));
    dragId = null;
  });
  boardEl.addEventListener('dragover', e => {
    const col = e.target.closest('.plan-col');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    boardEl.querySelectorAll('.plan-col.drag-over').forEach(c => {
      if (c !== col) c.classList.remove('drag-over');
    });
    col.classList.add('drag-over');
  });
  boardEl.addEventListener('dragleave', e => {
    const col = e.target.closest('.plan-col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
  });
  boardEl.addEventListener('drop', e => {
    const col = e.target.closest('.plan-col');
    if (!col || !dragId) return;
    e.preventDefault();
    col.classList.remove('drag-over');
    moveCard(dragId, col.dataset.colId);
  });
}

function moveCard(cardId, colId) {
  // dragId 검증 — 외부 payload 위변조 / 필터 외 카드 방어
  const known = state.jiraCards.find(c => c.id === cardId)
              || state.keywordCards.find(c => c.id === cardId);
  if (!known) {
    toast({ kicker: '무효', msg: '알 수 없는 카드입니다.', kind: 'alert' });
    return;
  }
  const targetQuarter = colId === 'pool' ? null : colId;

  // Jira 카드 — 데이터 변경 안 함, 안내만
  if (known.type === 'jira') {
    if (known.quarter === targetQuarter) return;
    toast({
      kicker: 'JIRA SYNC 필요',
      msg: `${known.ticketKey} → ${targetQuarter || '미배치'} 이동.`,
      meta: 'Jira의 Year/Quarter 필드도 직접 업데이트하세요. 다음 sync 때 보드가 갱신됩니다.',
      kind: 'alert',
      hold: 6000,
    });
    return;
  }

  // 키워드 카드 — LS 갱신
  if (known.quarter === targetQuarter) return;
  known.quarter = targetQuarter;
  known.updatedAt = new Date().toISOString();
  persistCards();
  toast({ kicker: '저장됨', msg: `${known.title} → ${targetQuarter || '미배치'}`, kind: 'success' });
  renderBoard();
  renderHeader();
}

/* ----- 카드 모달 (추가 / 편집) ----------------------------- */

let cardModalEl = null;
let cardModalCtl = null;

function openCardModal(card, prefill = {}) {
  ensureCardModal();
  const isEdit = !!card;
  cardModalEl.querySelector('[data-modal-kicker]').textContent = isEdit ? 'EDIT' : 'NEW CARD';
  cardModalEl.querySelector('[data-modal-title]').textContent = isEdit ? '카드 편집' : '카드 추가';

  const f = cardModalEl.querySelector('form');
  f.elements.title.value = card?.title || '';
  f.elements.notes.value = card?.notes || '';
  f.elements.mainSubject.value = card?.mainSubject ?? prefill.mainSubject ?? '';
  f.elements.priority.value = card?.priority || '';
  f.elements.projectKey.value = card?.projectKey || '';
  f.elements.ticketKey.value = card?.ticketKey || '';
  f.elements.quarter.value = card?.quarter ?? prefill.quarter ?? '';
  f.dataset.editingId = card?.id || '';

  cardModalCtl.open();
}

function ensureCardModal() {
  if (cardModalEl) return;
  cardModalEl = document.createElement('div');
  cardModalEl.className = 'modal-backdrop';
  cardModalEl.hidden = true;
  cardModalEl.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title" style="width:520px">
      <form>
        <div class="modal-head">
          <div>
            <div class="modal-kicker" data-modal-kicker></div>
            <h3 class="modal-title" id="plan-modal-title" data-modal-title></h3>
          </div>
          <button type="button" class="modal-close" data-modal-close aria-label="닫기">CLOSE</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label" for="kw-title">제목</label>
            <input class="input" id="kw-title" name="title" required maxlength="120" />
          </div>
          <div class="field">
            <label class="field-label" for="kw-notes">메모</label>
            <textarea class="textarea" id="kw-notes" name="notes" maxlength="500"></textarea>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="kw-subject">메인주제</label>
              <select class="select" id="kw-subject" name="mainSubject">
                <option value="">—</option>
                <option value="01.추천">01.추천</option>
                <option value="02.검색">02.검색</option>
                <option value="03.랭킹">03.랭킹</option>
                <option value="04.개인화">04.개인화</option>
                <option value="05.디스커버리">05.디스커버리</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="kw-priority">우선순위</label>
              <select class="select" id="kw-priority" name="priority">
                <option value="">—</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="kw-project">프로젝트 키</label>
              <input class="input" id="kw-project" name="projectKey" maxlength="12" placeholder="CBP" pattern="[A-Z][A-Z0-9]{1,11}" title="대문자로 시작 + 영숫자 2~12자" />
            </div>
            <div class="field">
              <label class="field-label" for="kw-ticket">티켓 키 (선택)</label>
              <input class="input" id="kw-ticket" name="ticketKey" maxlength="20" placeholder="TM-1234" pattern="[A-Z][A-Z0-9]{1,11}-[0-9]+" title="예: CBP-1234 — 비우면 키워드 전용" />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="kw-quarter">분기</label>
              <select class="select" id="kw-quarter" name="quarter">
                <option value="">미배치</option>
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
              </select>
            </div>
            <div class="field"></div>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" data-modal-close>취소</button>
          <button type="submit" class="btn primary">저장</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(cardModalEl);
  cardModalCtl = attachModal(cardModalEl, {
    initialFocus: () => cardModalEl.querySelector('input[name="title"]'),
  });
  cardModalEl.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    saveCardFromForm(e.currentTarget);
  });
}

function saveCardFromForm(form) {
  const id = form.dataset.editingId;
  const now = new Date().toISOString();
  const projectKeyRaw = form.elements.projectKey.value.trim().toUpperCase();
  if (projectKeyRaw && !PROJECT_KEY_RE.test(projectKeyRaw)) {
    toast({ kicker: '형식 오류', msg: '프로젝트 키는 대문자 영숫자 2~12자여야 합니다.', kind: 'alert' });
    return;
  }
  const ticketKeyRaw = form.elements.ticketKey.value.trim().toUpperCase();
  if (ticketKeyRaw && !/^[A-Z][A-Z0-9]{1,11}-[0-9]+$/.test(ticketKeyRaw)) {
    toast({ kicker: '형식 오류', msg: '티켓 키는 PROJ-숫자 형식이어야 합니다 (예: TM-1234).', kind: 'alert' });
    return;
  }
  // ticketKey 가 있으면 projectKey 자동 채움 (없을 때만)
  let projectKey = projectKeyRaw;
  if (ticketKeyRaw && !projectKey) projectKey = ticketKeyRaw.split('-', 1)[0];

  const data = {
    title: form.elements.title.value.trim(),
    notes: form.elements.notes.value.trim(),
    mainSubject: form.elements.mainSubject.value,
    priority: form.elements.priority.value,
    projectKey,
    ticketKey: ticketKeyRaw,
    quarter: form.elements.quarter.value || null,
  };
  if (!data.title) {
    toast({ kicker: '입력 필요', msg: '제목은 비울 수 없습니다.', kind: 'alert' });
    return;
  }
  if (id) {
    const i = state.keywordCards.findIndex(c => c.id === id);
    if (i >= 0) {
      state.keywordCards[i] = { ...state.keywordCards[i], ...data, updatedAt: now };
      toast({ kicker: '저장됨', msg: data.title, kind: 'success' });
    }
  } else {
    state.keywordCards.push(normalizeKeywordCard({
      ...data,
      id: newCardId(),
      year: state.year,
      createdAt: now,
      updatedAt: now,
    }));
    toast({ kicker: '추가됨', msg: data.title, kind: 'success' });
  }
  persistCards();
  cardModalCtl.close();
  renderFilters();
  renderBoard();
  renderHeader();
}

/* ----- 삭제 확인 ------------------------------------------- */

let confirmEl = null;
let confirmCtl = null;

function confirmDelete(card) {
  ensureConfirmModal();
  confirmEl.querySelector('[data-modal-title]').textContent = '삭제 확인';
  confirmEl.querySelector('[data-modal-body]').innerHTML =
    `정말 <strong>${escapeHtml(card.title || '(제목 없음)')}</strong> 카드를 삭제할까요? 되돌릴 수 없습니다.`;
  confirmCtl.open();
  confirmEl.querySelector('[data-confirm-yes]').onclick = () => {
    state.keywordCards = state.keywordCards.filter(c => c.id !== card.id);
    persistCards();
    toast({ kicker: '삭제됨', msg: card.title || '(제목 없음)' });
    confirmCtl.close();
    renderFilters();
    renderBoard();
    renderHeader();
  };
}

function ensureConfirmModal() {
  if (confirmEl) return;
  confirmEl = document.createElement('div');
  confirmEl.className = 'modal-backdrop';
  confirmEl.hidden = true;
  confirmEl.innerHTML = `
    <div class="modal confirm danger" role="alertdialog" aria-modal="true" aria-labelledby="plan-confirm-title">
      <div class="modal-head">
        <div>
          <div class="modal-kicker">DELETE</div>
          <h3 class="modal-title" id="plan-confirm-title" data-modal-title>삭제 확인</h3>
        </div>
        <button type="button" class="modal-close" data-modal-close aria-label="닫기">CLOSE</button>
      </div>
      <div class="modal-body" data-modal-body></div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-modal-close>취소</button>
        <button type="button" class="btn primary" data-confirm-yes>삭제</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmEl);
  confirmCtl = attachModal(confirmEl, {
    initialFocus: () => confirmEl.querySelector('[data-confirm-yes]'),
  });
}

/* ----- Export --------------------------------------------- */

/** git diff 안정성 위해 결정적 정렬 후 직렬화. */
export function sortCards(cards) {
  const qOrder = { 'Q1': 1, 'Q2': 2, 'Q3': 3, 'Q4': 4 };
  const pOrder = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 };
  return [...cards].sort((a, b) => {
    const qa = a.quarter == null ? 9 : (qOrder[a.quarter] || 8);
    const qb = b.quarter == null ? 9 : (qOrder[b.quarter] || 8);
    if (qa !== qb) return qa - qb;
    const pa = pOrder[a.priority] != null ? pOrder[a.priority] : 9;
    const pb = pOrder[b.priority] != null ? pOrder[b.priority] : 9;
    if (pa !== pb) return pa - pb;
    return String(a.id).localeCompare(String(b.id));
  });
}

function exportJson() {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    year: state.year,
    cards: sortCards(state.keywordCards),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `roadmap-${state.year}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast({
    kicker: 'EXPORTED',
    msg: `roadmap-${state.year}.json`,
    meta: `data/plans/ 에 commit 하면 영구 저장됩니다.`,
    kind: 'success',
    hold: 6000,
  });
}

/* ----- helpers --------------------------------------------- */

function currentYear(now = new Date()) {
  return now.getFullYear();
}

/* test export */
export const _internal = {
  initiativeToCard,
  normalizeKeywordCard,
  priorityClass,
  SUBJECT_CLASS_MAP,
  SCHEMA_VERSION,
  PROJECT_KEY_RE,
  sortCards,
};
