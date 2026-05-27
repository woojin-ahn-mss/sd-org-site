/* =========================================================
   pages/roadmap-plan.js — 로드맵 관리
   Google Sheet SoT · Objective(OKR/색상) → Subject(주제) → Card+Jira티켓 3단

   인증/저장:
     - sheets.js wrapper (사용자 본인 OAuth, musinsa.com 도메인 Internal)
     - 진입 시 silent 로그인 시도 → 실패 시 로그인 버튼 노출 (plan.js 패턴)

   데이터 모델 (PRD §3.3 v3):
     objectives          : id, name, color, description, display_order, ...
     subjects            : id, objective_id, name, startMonth, endMonth, ...
     roadmap-plan-cards  : id, subject_id, year, quarter, title, notes, mainSubject, priority, projectKey, ...
     roadmap-plan-overrides : jira_key, year, subject_id, quarter, ... (Jira 매핑+분기 통합)
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading, emptyHtml } from '../states.js';
import { jiraKeyHtml, jiraUrl, bindJiraLinks } from '../jira-link.js';
import { scoped } from '../storage.js';
import { toast } from '../toast.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { attachModal } from '../modal.js';
import { auth, AuthRequiredError } from '../api/sheets.js';
import {
  verifySchema, loadAll,
  createObjective, updateObjective, deleteObjective, validateObjectiveDelete,
  createSubject, updateSubject, deleteSubject, validateSubjectDelete,
  createCard, updateCard, deleteCard,
  setTicketMapping, joinTicketsWithOverrides,
  SchemaMismatchError,
} from '../api/roadmap-plan-data.js';
import { GOAL_COLORS, isValidMonth, isValidPeriod, fmtPeriod } from '../goals.js';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const SUBJECT_CLASS_MAP = {
  '01.추천': 's-rec',
  '02.검색': 's-srch',
  '03.랭킹': 's-rank',
  '04.개인화': 's-pers',
  '05.디스커버리': 's-disc',
};
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,11}$/;
const FILTERS_KEY = 'roadmapPlan.filters';
const GROUP_KEY   = 'roadmapPlan.groupBy';

const $ = (id) => document.getElementById(id);

const state = {
  rootRel: '',
  year: currentYear(),
  signedIn: false,
  email: null,
  objectives: [],
  subjects: [],
  cards: [],
  overrides: [],
  jiraTickets: [],   // joined with overrides
  filters: { objective: null, subject: null, mainSubject: null, priority: null, project: null },
  groupBy: 'subject',  // 'subject' | 'objective' | 'none'
  modals: {},
};

/* ─── 부트 ────────────────────────────────────────────────── */

export async function renderRoadmapPlan({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  state.year = currentYear();
  const savedGroup = scoped(GROUP_KEY).get(null);
  if (savedGroup === 'subject' || savedGroup === 'objective' || savedGroup === 'none') {
    state.groupBy = savedGroup;
  }
  state.filters = Object.assign(
    { objective: null, subject: null, mainSubject: null, priority: null, project: null },
    scoped(FILTERS_KEY).get({}) || {}
  );

  bindAuthUi();
  bindRefresh();
  bindYearSelect();
  bindGroupToggle();
  bindAddButtons();
  bindModals();

  try {
    await auth.signIn({ silent: true });
    state.signedIn = true;
    state.email = auth.email();
  } catch (e) {
    state.signedIn = false;
    if (e instanceof AuthRequiredError) {
      renderAuthUi();
      return;
    }
    console.error('[roadmap-plan] auth 예외', e);
    renderAuthUi();
    toast({ kicker: '로그인 실패', msg: e.message || String(e), kind: 'alert' });
    return;
  }
  renderAuthUi();
  await loadAndRender();
}

async function loadAndRender() {
  if (!state.signedIn) return;
  const objectiveBoard = $('objective-board');
  const subjectBoard = $('subject-board');
  const planBoard = $('plan-board');
  showLoading(planBoard, { rows: 3, title: false });

  try {
    await verifySchema();
  } catch (e) {
    showSchemaIssue(e);
    return;
  }

  let sheetData, jiraData;
  try {
    [sheetData, jiraData] = await Promise.all([
      loadAll(state.year),
      loadJson(`${state.rootRel}data/jira/initiatives.json`).catch(() => ({ items: [] })),
    ]);
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      state.signedIn = false;
      renderAuthUi();
      return;
    }
    console.error('[roadmap-plan] load 실패', e);
    showError(planBoard, e);
    return;
  }

  state.objectives = sheetData.objectives;
  state.subjects = sheetData.subjects;
  state.cards = sheetData.cards;
  state.overrides = sheetData.overrides;
  state.jiraTickets = joinTicketsWithOverrides(jiraData.items || [], state.overrides, state.year);

  showBoards(true);
  renderFilters();
  renderObjectiveBoard();
  renderSubjectBoard();
  renderCardBoard();
  enableRefresh(true);
  enableAddButtons(true);
}

function showBoards(on) {
  $('sec-board-controls').hidden = !on;
  $('sec-objective').hidden = !on;
  $('sec-subject').hidden = !on;
  $('sec-cards').hidden = !on;
}

function showSchemaIssue(e) {
  showBoards(false);
  const host = $('plan-board');
  host.innerHTML = '';
  host.parentElement.parentElement.parentElement.querySelector('#sec-cards').hidden = false;
  $('sec-cards').hidden = false;
  const msg = (e && e.message) ? e.message : String(e);
  $('plan-board').innerHTML = `
    <div class="poc-card" style="border-color: var(--alert);">
      <strong>⚠ Sheet 스키마 초기화 필요</strong>
      <pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:11px;margin-top:8px;">${escapeHtml(msg)}</pre>
      <p class="muted" style="font-size:12px;margin-top:8px;">
        운영자(우진님)에게 알려주세요. Sheet 의 다음 시트들에 정확한 헤더가 있어야 합니다:
        objectives / subjects / roadmap-plan-cards / roadmap-plan-overrides.
        헤더 갱신 후 새로고침.
      </p>
    </div>
  `;
}

/* ─── 인증 UI ────────────────────────────────────────────── */

function bindAuthUi() {
  $('btn-signin')?.addEventListener('click', async () => {
    const statusEl = $('auth-status');
    if (statusEl) statusEl.textContent = '로그인 중…';
    try {
      await auth.signIn();
      state.signedIn = true;
      state.email = auth.email();
      renderAuthUi();
      await loadAndRender();
    } catch (e) {
      console.error('[roadmap-plan] signIn 실패', e);
      if (statusEl) {
        statusEl.textContent = '로그인 실패 — 다시 시도';
        statusEl.classList.add('err');
      }
    }
  });
  $('btn-signout')?.addEventListener('click', () => {
    auth.signOut();
    state.signedIn = false;
    state.email = null;
    state.objectives = []; state.subjects = []; state.cards = []; state.overrides = []; state.jiraTickets = [];
    renderAuthUi();
    showBoards(false);
    enableRefresh(false);
    enableAddButtons(false);
  });
}

function renderAuthUi() {
  const statusEl = $('auth-status');
  const signin = $('btn-signin');
  const signout = $('btn-signout');
  const help = $('auth-help');
  if (state.signedIn) {
    if (statusEl) {
      statusEl.textContent = `로그인됨: ${state.email || '(이메일 미상)'}`;
      statusEl.classList.remove('err');
      statusEl.classList.add('ok');
    }
    if (signin) signin.hidden = true;
    if (signout) signout.hidden = false;
    if (help) help.hidden = true;
  } else {
    if (statusEl) {
      statusEl.textContent = '로그인이 필요합니다';
      statusEl.classList.remove('ok');
      statusEl.classList.remove('err');
    }
    if (signin) signin.hidden = false;
    if (signout) signout.hidden = true;
    if (help) help.hidden = false;
  }
}

function bindRefresh() {
  const btn = $('btn-refresh');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!state.signedIn) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = '⟳ 로딩 중…';
    try { await loadAndRender(); }
    finally { btn.disabled = false; btn.textContent = orig; }
  });
}

function enableRefresh(on) {
  const btn = $('btn-refresh');
  if (btn) btn.disabled = !on;
}

function enableAddButtons(on) {
  for (const id of ['btn-add-obj', 'btn-add-subj', 'btn-add-card']) {
    const btn = $(id);
    if (btn) btn.disabled = !on;
  }
}

/* ─── 보드 상단 컨트롤 ───────────────────────────────────── */

function bindYearSelect() {
  const sel = $('plan-year');
  if (!sel) return;
  sel.value = String(state.year);
  sel.addEventListener('change', async () => {
    const y = parseInt(sel.value, 10);
    if (!Number.isFinite(y)) return;
    state.year = y;
    if (state.signedIn) await loadAndRender();
  });
}

function bindGroupToggle() {
  document.querySelectorAll('button[data-group-by]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.groupBy;
      if (v !== 'subject' && v !== 'objective' && v !== 'none') return;
      state.groupBy = v;
      scoped(GROUP_KEY).set(v);
      reflectGroupToggle();
      renderCardBoard();
    });
  });
  reflectGroupToggle();
}

function reflectGroupToggle() {
  document.querySelectorAll('button[data-group-by]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.groupBy === state.groupBy);
  });
}

function bindAddButtons() {
  $('btn-add-obj')?.addEventListener('click', () => openObjectiveModal(null));
  $('btn-add-subj')?.addEventListener('click', () => openSubjectModal(null));
  $('btn-add-card')?.addEventListener('click', () => openCardModal(null));
}

/* ─── 필터 ─────────────────────────────────────────────── */

function renderFilters() {
  const host = $('plan-filters');
  if (!host) return;

  const objectiveOpts = state.objectives.map(o => ({ v: o.id, label: o.name || '(이름 없음)' }));
  const subjectOpts = state.subjects.map(s => ({ v: s.id, label: s.name || '(이름 없음)' }));
  const allItems = [...state.cards, ...state.jiraTickets];
  const mainSubjects = uniqueSorted(allItems.map(x => x.mainSubject).filter(Boolean));
  const priorities = uniqueSorted(allItems.map(x => x.priority).filter(Boolean));
  const projects = uniqueSorted(allItems.map(x => x.projectKey || x.project).filter(Boolean));

  const hasAny =
    state.filters.objective || state.filters.subject ||
    state.filters.mainSubject || state.filters.priority || state.filters.project;

  host.innerHTML = `
    ${chipGroup('objective',   'OBJECTIVE',    objectiveOpts, state.filters.objective)}
    ${chipGroup('subject',     '주제',         subjectOpts,   state.filters.subject)}
    ${chipGroup('mainSubject', '메인주제',     mainSubjects.map(v => ({ v, label: v })), state.filters.mainSubject)}
    ${chipGroup('priority',    '우선순위',     priorities.map(v => ({ v, label: v })),   state.filters.priority)}
    ${chipGroup('project',     '프로젝트',     projects.map(v => ({ v, label: v })),     state.filters.project)}
    ${hasAny ? '<button type="button" class="tlink" data-filter-reset>필터 초기화</button>' : ''}
  `;

  host.querySelectorAll('button.fchip').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      const v = btn.dataset.value;
      state.filters[f] = state.filters[f] === v ? null : v;
      scoped(FILTERS_KEY).set(state.filters);
      renderFilters();
      renderCardBoard();
    });
  });
  host.querySelector('[data-filter-reset]')?.addEventListener('click', () => {
    state.filters = { objective: null, subject: null, mainSubject: null, priority: null, project: null };
    scoped(FILTERS_KEY).set(state.filters);
    renderFilters();
    renderCardBoard();
  });
}

function chipGroup(filterKey, label, options, current) {
  if (!options.length) return '';
  const chips = options.map(opt => {
    const on = current === opt.v;
    return `<button type="button" class="fchip ${on ? 'on' : ''}"
              data-filter="${escapeAttr(filterKey)}"
              data-value="${escapeAttr(opt.v)}">${escapeHtml(opt.label)}</button>`;
  }).join('');
  return `<span class="flabel">${escapeHtml(label)}</span>${chips}`;
}

function uniqueSorted(arr) {
  return [...new Set(arr)].sort((a, b) => String(a).localeCompare(String(b), 'ko'));
}

/* ─── 색상 상속 ─────────────────────────────────────────── */

function objectiveById(id) { return state.objectives.find(o => o.id === id) || null; }
function subjectById(id)   { return state.subjects.find(s => s.id === id) || null; }

function colorVarForObjective(obj) {
  if (!obj) return 'var(--accent)';
  const found = GOAL_COLORS.find(c => c.key === obj.color);
  return `var(${found ? found.var : '--accent'})`;
}

function colorVarForSubject(subj) {
  if (!subj) return 'var(--accent)';
  return colorVarForObjective(objectiveById(subj.objective_id));
}

function colorVarForCard(card) {
  if (!card || !card.subject_id) return 'var(--accent)';
  return colorVarForSubject(subjectById(card.subject_id));
}

/* ─── Objective 보드 ────────────────────────────────────── */

function renderObjectiveBoard() {
  const host = $('objective-board');
  if (!host) return;
  if (!state.objectives.length) {
    host.innerHTML = `<div class="muted" style="padding:14px;font-size:13px;">Objective 가 없습니다. 우측 상단 <strong>🎯 Objective</strong> 버튼으로 추가하세요.</div>`;
    return;
  }
  host.innerHTML = state.objectives.map(o => objectiveCardEl(o)).join('');
  host.querySelectorAll('[data-obj-id]').forEach(el => {
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const obj = objectiveById(el.dataset.objId);
      if (obj) openObjectiveModal(obj);
    });
  });
}

function objectiveCardEl(obj) {
  const color = colorVarForObjective(obj);
  const subjCount = state.subjects.filter(s => s.objective_id === obj.id).length;
  return `
    <article class="obj-card" data-obj-id="${escapeAttr(obj.id)}" style="border-left: 3px solid ${color}; padding: 10px 12px; cursor: pointer;">
      <div class="poc-row" style="justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-weight:600;font-size:14px;color:${color};">${escapeHtml(obj.name || '(이름 없음)')}</div>
          ${obj.description ? `<div class="muted" style="font-size:12px;margin-top:2px;">${escapeHtml(obj.description)}</div>` : ''}
        </div>
        <span class="muted dim-mono" style="font-size:11px;">주제 ${subjCount}</span>
      </div>
    </article>
  `;
}

/* ─── Subject 보드 ──────────────────────────────────────── */

function renderSubjectBoard() {
  const host = $('subject-board');
  if (!host) return;
  if (!state.subjects.length) {
    host.innerHTML = `<div class="muted" style="padding:14px;font-size:13px;">주제가 없습니다. <strong>📌 주제</strong> 버튼으로 추가하세요.</div>`;
    return;
  }
  // Objective 별로 그룹핑
  const groups = state.objectives.map(obj => ({
    objective: obj,
    subjects: state.subjects.filter(s => s.objective_id === obj.id),
  }));
  const orphans = state.subjects.filter(s => !s.objective_id || !objectiveById(s.objective_id));
  const html = [
    ...groups.map(g => subjectGroupEl(g.objective, g.subjects)),
    orphans.length ? subjectGroupEl(null, orphans) : '',
  ].filter(Boolean).join('');
  host.innerHTML = html;
  host.querySelectorAll('[data-subj-id]').forEach(el => {
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const subj = subjectById(el.dataset.subjId);
      if (subj) openSubjectModal(subj);
    });
  });
}

function subjectGroupEl(objective, subjects) {
  const color = colorVarForObjective(objective);
  const head = objective
    ? `<div class="muted dim-mono" style="font-size:11px;color:${color};margin-bottom:4px;">↳ ${escapeHtml(objective.name || '(Objective)')}</div>`
    : `<div class="muted dim-mono" style="font-size:11px;margin-bottom:4px;">↳ (Objective 미배치)</div>`;
  const body = subjects.map(s => subjectCardEl(s, color)).join('');
  return `<div class="subj-group" style="margin-bottom:12px;">${head}<div style="display:flex;flex-wrap:wrap;gap:8px;">${body}</div></div>`;
}

function subjectCardEl(subj, color) {
  const cardCount = state.cards.filter(c => c.subject_id === subj.id).length;
  const ticketCount = state.jiraTickets.filter(t => t.subject_id === subj.id).length;
  const period = (subj.startMonth && subj.endMonth) ? fmtPeriod({ startMonth: subj.startMonth, endMonth: subj.endMonth }) : '';
  return `
    <article class="subj-card" data-subj-id="${escapeAttr(subj.id)}"
             style="border:1px solid var(--rule); border-left: 3px solid ${color}; padding:8px 10px; min-width:180px; cursor:pointer; background: var(--bg-elev);">
      <div style="font-size:13px;font-weight:500;">${escapeHtml(subj.name || '(이름 없음)')}</div>
      <div class="muted dim-mono" style="font-size:10.5px;margin-top:2px;">
        ${period ? escapeHtml(period) + ' · ' : ''}카드 ${cardCount} · 티켓 ${ticketCount}
      </div>
    </article>
  `;
}

/* ─── 카드 보드 (5컬럼 + D&D) ──────────────────────────── */

function renderCardBoard() {
  const host = $('plan-board');
  if (!host) return;

  const allItems = [
    ...state.cards.map(c => ({ ...c, _kind: 'card' })),
    ...state.jiraTickets.map(t => ({
      _kind: 'jira',
      id: `jira-${t.key}`,
      jira_key: t.key,
      summary: t.summary,
      subject_id: t.subject_id,
      quarter: t.quarter,
      baseQuarter: t.baseQuarter,
      _override: t._override,
      title: t.summary,
      mainSubject: t.mainSubject || '',
      priority: t.priority || '',
      projectKey: t.project || '',
      status: t.status || '',
    })),
  ];

  const filtered = applyFilters(allItems);

  // 분기별 분류
  const cols = {
    pool: filtered.filter(it => !QUARTERS.includes(it.quarter)),
    Q1: filtered.filter(it => it.quarter === 'Q1'),
    Q2: filtered.filter(it => it.quarter === 'Q2'),
    Q3: filtered.filter(it => it.quarter === 'Q3'),
    Q4: filtered.filter(it => it.quarter === 'Q4'),
  };

  const html = `
    ${columnEl('pool', '미배치', cols.pool, { pool: true })}
    ${columnEl('Q1', 'Q1', cols.Q1, {})}
    ${columnEl('Q2', 'Q2', cols.Q2, {})}
    ${columnEl('Q3', 'Q3', cols.Q3, {})}
    ${columnEl('Q4', 'Q4', cols.Q4, {})}
  `;
  host.innerHTML = `<div class="board-cols" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">${html}</div>`;

  bindDnd(host);
  bindJiraLinks(host);

  // 클릭으로 카드 편집 (키워드만)
  host.querySelectorAll('[data-card-id]').forEach(el => {
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;  // Jira 링크 클릭은 통과
      const id = el.dataset.cardId;
      const card = state.cards.find(c => c.id === id);
      if (card) openCardModal(card);
    });
  });
}

function columnEl(colId, label, items, { pool }) {
  const grouped = groupCards(items);
  const inner = grouped.map(g => groupEl(g)).join('') || `<div class="muted" style="padding:10px;font-size:12px;">${pool ? '카드/티켓 없음' : '비어 있음'}</div>`;
  return `
    <div class="board-col" data-col="${escapeAttr(colId)}" style="border:1px solid var(--rule); background:var(--bg-elev); border-radius:4px; padding:8px; min-height:200px;">
      <div class="muted dim-mono" style="font-size:11px;margin-bottom:6px;">${escapeHtml(label)} <span class="num">${items.length}</span></div>
      <div class="board-drop" data-col-drop="${escapeAttr(colId)}" style="min-height:180px;">${inner}</div>
    </div>
  `;
}

function groupCards(items) {
  if (state.groupBy === 'none') return [{ key: '__all__', label: '', items }];
  if (state.groupBy === 'objective') {
    const map = new Map();
    for (const it of items) {
      const subj = it.subject_id ? subjectById(it.subject_id) : null;
      const objId = subj ? subj.objective_id : '';
      const key = objId || '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return state.objectives
      .filter(o => map.has(o.id))
      .map(o => ({ key: o.id, label: o.name, color: colorVarForObjective(o), items: map.get(o.id) }))
      .concat(map.has('__none__') ? [{ key: '__none__', label: '(미배치)', items: map.get('__none__') }] : []);
  }
  // 'subject'
  const map = new Map();
  for (const it of items) {
    const key = it.subject_id || '__none__';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return state.subjects
    .filter(s => map.has(s.id))
    .map(s => ({ key: s.id, label: s.name, color: colorVarForSubject(s), items: map.get(s.id) }))
    .concat(map.has('__none__') ? [{ key: '__none__', label: '(주제 미배치)', items: map.get('__none__') }] : []);
}

function groupEl(g) {
  const head = g.label
    ? `<div class="muted dim-mono" style="font-size:10.5px;${g.color ? `color:${g.color};` : ''}margin:4px 0 4px;">↳ ${escapeHtml(g.label)} · ${g.items.length}</div>`
    : '';
  return `<div class="group">${head}${g.items.map(cardEl).join('')}</div>`;
}

function cardEl(it) {
  const subj = it.subject_id ? subjectById(it.subject_id) : null;
  const color = subj ? colorVarForSubject(subj) : 'var(--rule)';
  const isJira = it._kind === 'jira';
  const titleHtml = isJira
    ? `${jiraKeyHtml(it.jira_key)} <span style="font-size:12px;">${escapeHtml(it.title || '')}</span>`
    : `<span style="font-size:13px;font-weight:500;">${escapeHtml(it.title || '(제목 없음)')}</span>`;
  const meta = [
    it.mainSubject ? `<span class="${SUBJECT_CLASS_MAP[it.mainSubject] || 's-misc'}" style="font-size:10px;padding:1px 4px;border-radius:2px;">${escapeHtml(it.mainSubject)}</span>` : '',
    it.priority ? `<span class="pri pri-${escapeAttr(priorityClass(it.priority))}" style="font-size:10px;">${escapeHtml(it.priority)}</span>` : '',
    it.projectKey ? `<span class="muted dim-mono" style="font-size:10px;">${escapeHtml(it.projectKey)}</span>` : '',
  ].filter(Boolean).join(' ');
  const overrideMark = isJira && it._override ? `<span title="분기/주제 override" style="font-size:9px;color:var(--accent);">⊘</span>` : '';
  const dataAttrs = isJira
    ? `data-jira-key="${escapeAttr(it.jira_key)}" draggable="true"`
    : `data-card-id="${escapeAttr(it.id)}" draggable="true"`;
  return `
    <article class="rp-card" ${dataAttrs}
             style="border-left: 3px solid ${color}; border:1px solid var(--rule); border-left-width:3px; padding:6px 8px; margin-bottom:6px; background:var(--bg-base); border-radius:3px; cursor:${isJira ? 'grab' : 'pointer'};">
      <div class="poc-row" style="justify-content:space-between;align-items:flex-start;gap:6px;">
        <div style="flex:1;min-width:0;">${titleHtml}</div>
        ${overrideMark}
      </div>
      ${meta ? `<div class="poc-row" style="gap:4px;margin-top:3px;">${meta}</div>` : ''}
    </article>
  `;
}

function priorityClass(p) {
  if (!p) return '';
  return String(p).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ─── 필터 적용 ──────────────────────────────────────── */

function applyFilters(items) {
  const f = state.filters;
  return items.filter(it => {
    if (f.objective) {
      const subj = it.subject_id ? subjectById(it.subject_id) : null;
      if (!subj || subj.objective_id !== f.objective) return false;
    }
    if (f.subject && it.subject_id !== f.subject) return false;
    if (f.mainSubject && it.mainSubject !== f.mainSubject) return false;
    if (f.priority && it.priority !== f.priority) return false;
    if (f.project && (it.projectKey || it.project) !== f.project) return false;
    return true;
  });
}

/* ─── D&D ─────────────────────────────────────────────── */

let dragInfo = null;  // { kind:'card'|'jira', id }

function bindDnd(boardEl) {
  boardEl.querySelectorAll('.rp-card[draggable="true"]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      if (el.dataset.cardId) dragInfo = { kind: 'card', id: el.dataset.cardId };
      else if (el.dataset.jiraKey) dragInfo = { kind: 'jira', id: el.dataset.jiraKey };
      e.dataTransfer.effectAllowed = 'move';
      el.style.opacity = '0.5';
    });
    el.addEventListener('dragend', () => {
      el.style.opacity = '';
      dragInfo = null;
    });
  });
  boardEl.querySelectorAll('[data-col-drop]').forEach(drop => {
    drop.addEventListener('dragover', (e) => {
      if (!dragInfo) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      drop.style.background = 'var(--bg-elev)';
    });
    drop.addEventListener('dragleave', () => { drop.style.background = ''; });
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      drop.style.background = '';
      if (!dragInfo) return;
      const col = drop.dataset.colDrop;
      const newQuarter = col === 'pool' ? '' : col;
      await moveItem(dragInfo, newQuarter);
    });
  });
}

async function moveItem(info, newQuarter) {
  try {
    if (info.kind === 'card') {
      const card = state.cards.find(c => c.id === info.id);
      if (!card) return;
      if ((card.quarter || '') === newQuarter) return;
      const updated = await updateCard(card, { quarter: newQuarter });
      Object.assign(card, updated);
    } else {
      const t = state.jiraTickets.find(x => x.key === info.id);
      if (!t) return;
      if ((t.quarter || '') === newQuarter) return;
      // override 갱신 — subject_id 는 기존 그대로
      const updated = await setTicketMapping(
        t.key,
        { year: state.year, subject_id: t.subject_id, quarter: newQuarter },
        state.overrides
      );
      // overrides state 갱신
      const idx = state.overrides.findIndex(o => o.jira_key === t.key);
      if (updated) {
        if (idx >= 0) state.overrides[idx] = updated;
        else state.overrides.push(updated);
      } else if (idx >= 0) {
        state.overrides.splice(idx, 1);
      }
      t.quarter = newQuarter;
      t._override = !!(t.subject_id || (newQuarter && newQuarter !== t.baseQuarter));
    }
    renderCardBoard();
  } catch (e) {
    handleApiError(e, '이동 실패');
  }
}

/* ─── 모달 바인딩 ───────────────────────────────────────── */

function bindModals() {
  state.modals.obj = attachModal($('obj-pop'));
  state.modals.subj = attachModal($('subj-pop'));
  state.modals.card = attachModal($('card-pop'));
  state.modals.confirm = attachModal($('confirm-pop'));

  $('obj-form')?.addEventListener('submit', onObjectiveSubmit);
  $('subj-form')?.addEventListener('submit', onSubjectSubmit);
  $('card-form')?.addEventListener('submit', onCardSubmit);

  // 색상 swatch
  const sw = $('obj-color-swatch');
  if (sw) {
    sw.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;';
    sw.innerHTML = GOAL_COLORS.map(c => `
      <button type="button" data-color="${escapeAttr(c.key)}" title="${escapeAttr(c.label)}"
              style="width:24px;height:24px;border-radius:50%;border:1px solid var(--rule);background:var(${c.var});cursor:pointer;"></button>
    `).join('');
    sw.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-color]');
      if (!btn) return;
      const form = $('obj-form');
      form.color.value = btn.dataset.color;
      sw.querySelectorAll('button').forEach(b => b.style.outline = b === btn ? '2px solid var(--accent-strong)' : '');
    });
  }
}

/* ─── Objective modal ───────────────────────────────────── */

function openObjectiveModal(obj) {
  const form = $('obj-form');
  $('obj-modal-title').textContent = obj ? `Objective: ${obj.name}` : '새 Objective';
  form.reset();
  form.id.value = obj ? obj.id : '';
  if (obj) {
    form.name.value = obj.name || '';
    form.description.value = obj.description || '';
    form.color.value = obj.color || 'accent';
    form.display_order.value = obj.display_order ?? 0;
  } else {
    form.color.value = 'accent';
    form.display_order.value = state.objectives.length;
  }
  // 선택된 색상 표시
  $('obj-color-swatch').querySelectorAll('button').forEach(b => {
    b.style.outline = b.dataset.color === form.color.value ? '2px solid var(--accent-strong)' : '';
  });
  // 삭제 버튼
  const delBtn = form.querySelector('[data-obj-delete]');
  if (delBtn) {
    delBtn.hidden = !obj;
    delBtn.onclick = () => requestObjectiveDelete(obj);
  }
  state.modals.obj.open();
}

async function onObjectiveSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const patch = {
    name: (fd.get('name') || '').toString().trim(),
    description: (fd.get('description') || '').toString().trim(),
    color: fd.get('color') || 'accent',
    display_order: parseInt(fd.get('display_order'), 10) || 0,
  };
  if (!patch.name) { toast({ kicker: '입력', msg: '이름은 필수입니다.', kind: 'alert' }); return; }

  const id = fd.get('id');
  try {
    if (id) {
      const obj = state.objectives.find(o => o.id === id);
      if (!obj) return;
      const updated = await updateObjective(obj, patch);
      Object.assign(obj, updated);
    } else {
      const created = await createObjective(patch);
      state.objectives.push(created);
    }
    state.objectives.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    state.modals.obj.close();
    renderObjectiveBoard();
    renderSubjectBoard();
    renderCardBoard();
    renderFilters();
  } catch (err) {
    handleApiError(err, 'Objective 저장 실패');
  }
}

function requestObjectiveDelete(obj) {
  if (!obj) return;
  const check = validateObjectiveDelete(obj.id, state.subjects);
  if (!check.ok) {
    toast({ kicker: '삭제 차단', msg: check.reason, kind: 'alert' });
    return;
  }
  openConfirm({
    title: 'Objective 삭제',
    body: `<p>"${escapeHtml(obj.name || obj.id)}" 을(를) 삭제합니다.</p><p class="muted" style="font-size:12px;">하위 주제·카드는 영향받지 않지만 (선행 차단됨) 이 Objective 행이 사라집니다.</p>`,
    onOk: async () => {
      try {
        await deleteObjective(obj);
        state.objectives = state.objectives.filter(o => o.id !== obj.id);
        state.modals.obj.close();
        state.modals.confirm.close();
        renderObjectiveBoard();
        renderSubjectBoard();
        renderCardBoard();
        renderFilters();
      } catch (e) {
        handleApiError(e, '삭제 실패');
      }
    },
  });
}

/* ─── Subject modal ─────────────────────────────────────── */

function openSubjectModal(subj) {
  const form = $('subj-form');
  $('subj-modal-title').textContent = subj ? `주제: ${subj.name}` : '새 주제';
  form.reset();
  form.id.value = subj ? subj.id : '';

  // objective select
  form.objective_id.innerHTML = '<option value="">(선택)</option>' +
    state.objectives.map(o => `<option value="${escapeAttr(o.id)}">${escapeHtml(o.name || o.id)}</option>`).join('');
  // month options
  fillMonthSelect(form.startMonth);
  fillMonthSelect(form.endMonth);

  if (subj) {
    form.objective_id.value = subj.objective_id || '';
    form.name.value = subj.name || '';
    form.description.value = subj.description || '';
    form.startMonth.value = subj.startMonth || '';
    form.endMonth.value = subj.endMonth || '';
    form.display_order.value = subj.display_order ?? 0;
  } else {
    form.display_order.value = state.subjects.length;
  }
  const delBtn = form.querySelector('[data-subj-delete]');
  if (delBtn) {
    delBtn.hidden = !subj;
    delBtn.onclick = () => requestSubjectDelete(subj);
  }
  state.modals.subj.open();
}

function fillMonthSelect(sel) {
  const y = state.year;
  const opts = ['<option value="">—</option>'];
  for (let yr = y - 1; yr <= y + 1; yr++) {
    for (let m = 1; m <= 12; m++) {
      const v = `${yr}-${String(m).padStart(2, '0')}`;
      opts.push(`<option value="${v}">${v}</option>`);
    }
  }
  sel.innerHTML = opts.join('');
}

async function onSubjectSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const patch = {
    objective_id: fd.get('objective_id') || '',
    name: (fd.get('name') || '').toString().trim(),
    description: (fd.get('description') || '').toString().trim(),
    startMonth: fd.get('startMonth') || '',
    endMonth: fd.get('endMonth') || '',
    display_order: parseInt(fd.get('display_order'), 10) || 0,
  };
  if (!patch.name) { toast({ kicker: '입력', msg: '이름은 필수입니다.', kind: 'alert' }); return; }
  if (!patch.objective_id) { toast({ kicker: '입력', msg: 'Objective 를 선택하세요.', kind: 'alert' }); return; }
  if (patch.startMonth && !isValidMonth(patch.startMonth)) { toast({ kicker: '입력', msg: '시작월 형식 오류 (YYYY-MM).', kind: 'alert' }); return; }
  if (patch.endMonth && !isValidMonth(patch.endMonth)) { toast({ kicker: '입력', msg: '종료월 형식 오류.', kind: 'alert' }); return; }
  if (patch.startMonth && patch.endMonth && !isValidPeriod(patch.startMonth, patch.endMonth)) {
    toast({ kicker: '입력', msg: '시작월이 종료월보다 늦습니다.', kind: 'alert' });
    return;
  }

  const id = fd.get('id');
  try {
    if (id) {
      const subj = state.subjects.find(s => s.id === id);
      if (!subj) return;
      const updated = await updateSubject(subj, patch);
      Object.assign(subj, updated);
    } else {
      const created = await createSubject(patch);
      state.subjects.push(created);
    }
    state.subjects.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    state.modals.subj.close();
    renderSubjectBoard();
    renderCardBoard();
    renderFilters();
  } catch (err) {
    handleApiError(err, '주제 저장 실패');
  }
}

function requestSubjectDelete(subj) {
  if (!subj) return;
  const check = validateSubjectDelete(subj.id, state.cards, state.overrides);
  if (!check.ok) {
    toast({ kicker: '삭제 차단', msg: check.reason, kind: 'alert' });
    return;
  }
  openConfirm({
    title: '주제 삭제',
    body: `<p>"${escapeHtml(subj.name || subj.id)}" 을(를) 삭제합니다.</p>`,
    onOk: async () => {
      try {
        await deleteSubject(subj);
        state.subjects = state.subjects.filter(s => s.id !== subj.id);
        state.modals.subj.close();
        state.modals.confirm.close();
        renderSubjectBoard();
        renderCardBoard();
        renderFilters();
      } catch (e) {
        handleApiError(e, '삭제 실패');
      }
    },
  });
}

/* ─── Card modal ────────────────────────────────────────── */

function openCardModal(card) {
  const form = $('card-form');
  $('card-modal-title').textContent = card ? `카드: ${card.title}` : '새 카드';
  form.reset();
  form.id.value = card ? card.id : '';
  form.year.value = String(state.year);

  // subject select
  form.subject_id.innerHTML = '<option value="">— (미배치)</option>' +
    state.subjects.map(s => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name || s.id)}</option>`).join('');

  if (card) {
    form.subject_id.value = card.subject_id || '';
    form.title.value = card.title || '';
    form.quarter.value = card.quarter || '';
    form.mainSubject.value = card.mainSubject || '';
    form.priority.value = card.priority || '';
    form.projectKey.value = card.projectKey || '';
    form.notes.value = card.notes || '';
  }
  const delBtn = form.querySelector('[data-card-delete]');
  if (delBtn) {
    delBtn.hidden = !card;
    delBtn.onclick = () => requestCardDelete(card);
  }
  state.modals.card.open();
}

async function onCardSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const projectKey = (fd.get('projectKey') || '').toString().trim();
  if (projectKey && !PROJECT_KEY_RE.test(projectKey)) {
    toast({ kicker: '입력', msg: '프로젝트 키 형식 오류 (예: CBP, TM, MSSCXTF).', kind: 'alert' });
    return;
  }
  const patch = {
    subject_id: fd.get('subject_id') || '',
    title: (fd.get('title') || '').toString().trim(),
    quarter: fd.get('quarter') || '',
    mainSubject: (fd.get('mainSubject') || '').toString().trim(),
    priority: fd.get('priority') || '',
    projectKey,
    notes: (fd.get('notes') || '').toString().trim(),
    year: state.year,
  };
  if (!patch.title) { toast({ kicker: '입력', msg: '제목은 필수입니다.', kind: 'alert' }); return; }

  const id = fd.get('id');
  try {
    if (id) {
      const card = state.cards.find(c => c.id === id);
      if (!card) return;
      const updated = await updateCard(card, patch);
      Object.assign(card, updated);
    } else {
      const created = await createCard(patch);
      state.cards.push(created);
    }
    state.modals.card.close();
    renderCardBoard();
    renderFilters();
    renderSubjectBoard();
  } catch (err) {
    handleApiError(err, '카드 저장 실패');
  }
}

function requestCardDelete(card) {
  if (!card) return;
  openConfirm({
    title: '카드 삭제',
    body: `<p>"${escapeHtml(card.title || card.id)}" 을(를) 삭제합니다.</p>`,
    onOk: async () => {
      try {
        await deleteCard(card);
        state.cards = state.cards.filter(c => c.id !== card.id);
        state.modals.card.close();
        state.modals.confirm.close();
        renderCardBoard();
        renderSubjectBoard();
      } catch (e) {
        handleApiError(e, '삭제 실패');
      }
    },
  });
}

/* ─── 삭제 확인 공통 ───────────────────────────────────── */

function openConfirm({ title, body, onOk }) {
  $('confirm-title').textContent = title;
  $('confirm-body').innerHTML = body;
  const ok = $('confirm-ok');
  ok.onclick = onOk;
  state.modals.confirm.open();
}

/* ─── 에러 처리 ────────────────────────────────────────── */

function handleApiError(e, label) {
  console.error(`[roadmap-plan] ${label}`, e);
  if (e instanceof AuthRequiredError) {
    state.signedIn = false;
    renderAuthUi();
    showBoards(false);
    toast({ kicker: '재로그인 필요', msg: '세션이 만료되었습니다. 다시 로그인해 주세요.', kind: 'alert' });
    return;
  }
  if (e instanceof SchemaMismatchError) {
    showSchemaIssue(e);
    return;
  }
  toast({ kicker: label, msg: e.message || String(e), kind: 'alert' });
}

/* ─── utils ───────────────────────────────────────────── */

function currentYear(now = new Date()) {
  return now.getFullYear();
}

/* test export */
export const _internal = {
  applyFilters, groupCards, priorityClass, SUBJECT_CLASS_MAP, PROJECT_KEY_RE,
  colorVarForObjective, colorVarForSubject, colorVarForCard,
};
