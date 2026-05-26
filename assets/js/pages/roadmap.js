/* =========================================================
   pages/roadmap.js — 로드맵 (간트) 페이지 로직
   PRD 4.2: 필터·시간축 토글·컬럼·URL/localStorage 동기화
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading } from '../states.js';
import { renderGantt, COLUMNS } from '../gantt.js';
import { scoped } from '../storage.js';
import { attachModal } from '../modal.js';

const store = scoped('roadmap');

const FILTER_FIELDS = [
  { id: 'project',     label: 'PROJECT',     pick: it => it.project },
  { id: 'mainSubject', label: 'MAIN SUBJECT', pick: it => it.mainSubject },
  { id: 'labels',      label: 'LABELS',      pick: it => it.labels || [] },
  { id: 'yearQuarter', label: 'PERIOD',      pick: it => it.yearQuarter },
];
const ADVANCED_FIELDS = [
  { id: 'status',   label: 'STATUS',   pick: it => it.status },
  { id: 'assignee', label: 'ASSIGNEE', pick: it => (it.assignee && it.assignee.name) },
  { id: 'priority', label: 'PRIORITY', pick: it => it.priority },
];

const DEFAULT_STATE = {
  mode: 'quarter',
  cols: COLUMNS.filter(c => c.default).map(c => c.id),
  filters: {},        // { project: ['CBP'], ... }
  collapsedGroups: [],
};

export async function renderRoadmap({ rootRel = '' }) {
  const host = document.getElementById('gantt-host');
  showLoading(host, { rows: 6, title: true });

  let data;
  try {
    data = await loadJson(`${rootRel}data/jira/initiatives.json`);
  } catch (err) {
    showError(host, err);
    return;
  }

  const items = data.items || [];
  let state = { ...DEFAULT_STATE, ...(store.get() || {}), ...stateFromUrl() };
  if (!state.cols || !state.cols.length) state.cols = DEFAULT_STATE.cols;
  if (!state.filters) state.filters = {};

  // 마이그레이션: 새로 추가된 default 컬럼은 기존 saved state 에 없어도 자동 켜기
  const colsSet = new Set(state.cols);
  for (const c of COLUMNS) {
    if (c.default && !colsSet.has(c.id)) colsSet.add(c.id);
  }
  state.cols = [...colsSet];

  // --- 컬럼 토글 popover (이벤트 1회 부착) ---
  bindColsPopover(state, () => { persist(state); rerender(); });

  // --- 필터 UI ---
  buildFilters(items, state, () => { persist(state); rerender(); });

  // --- 시간축 토글 ---
  document.querySelectorAll('[data-time-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.timeMode === state.mode);
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.timeMode;
      document.querySelectorAll('[data-time-mode]').forEach(b =>
        b.classList.toggle('active', b.dataset.timeMode === state.mode));
      persist(state); rerender();
    });
  });

  document.querySelector('[data-toggle-advanced]')?.addEventListener('click', () => {
    const adv = document.querySelector('[data-filters="advanced"]');
    adv.hidden = !adv.hidden;
  });

  document.querySelector('[data-reset]')?.addEventListener('click', () => {
    state = { ...DEFAULT_STATE };
    store.set(state);
    location.hash = '';
    location.reload();
  });

  function rerender() {
    const filtered = applyFilters(items, state.filters);
    document.querySelector('[data-cnt-total]').textContent = filtered.length;
    renderGantt(host, {
      mode: state.mode,
      items: filtered,
      columns: state.cols,
      collapsedGroups: new Set(state.collapsedGroups),
      onGroupToggle: subject => {
        const set = new Set(state.collapsedGroups);
        if (set.has(subject)) set.delete(subject); else set.add(subject);
        state.collapsedGroups = [...set];
        persist(state); rerender();
      },
    });
  }
  rerender();
}

/* ----------------- 필터 ----------------- */

function buildFilters(items, state, onChange) {
  const basic = document.querySelector('[data-filters="basic"]');
  const advanced = document.querySelector('[data-filters="advanced"]');
  basic.innerHTML = '';
  advanced.innerHTML = '';

  for (const f of FILTER_FIELDS) basic.appendChild(buildFilterGroup(f, items, state, onChange));
  for (const f of ADVANCED_FIELDS) advanced.appendChild(buildFilterGroup(f, items, state, onChange));
}

function buildFilterGroup(field, items, state, onChange) {
  const group = document.createElement('div');
  group.style.display = 'flex';
  group.style.flexWrap = 'wrap';
  group.style.gap = '4px 10px';
  group.style.alignItems = 'baseline';
  group.style.marginRight = '12px';

  const label = document.createElement('span');
  label.className = 'flabel';
  label.textContent = field.label;
  group.appendChild(label);

  // 값 후보 수집
  const counts = new Map();
  for (const it of items) {
    const v = field.pick(it);
    const arr = Array.isArray(v) ? v : (v == null ? [] : [v]);
    for (const x of arr) counts.set(x, (counts.get(x) || 0) + 1);
  }
  // 상위 12개만 (너무 많으면)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const sel = new Set(state.filters[field.id] || []);

  for (const [val, ct] of sorted) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fchip' + (sel.has(val) ? ' on' : '');
    chip.textContent = `${val} ${ct}`;
    chip.addEventListener('click', () => {
      if (sel.has(val)) sel.delete(val); else sel.add(val);
      state.filters[field.id] = [...sel];
      onChange();
    });
    group.appendChild(chip);
  }
  if (!sorted.length) {
    const muted = document.createElement('span');
    muted.className = 'muted';
    muted.style.fontSize = '11px';
    muted.textContent = '—';
    group.appendChild(muted);
  }
  return group;
}

function applyFilters(items, filters) {
  return items.filter(it => {
    for (const [id, vals] of Object.entries(filters || {})) {
      if (!vals || !vals.length) continue;
      const field = [...FILTER_FIELDS, ...ADVANCED_FIELDS].find(f => f.id === id);
      if (!field) continue;
      const v = field.pick(it);
      const itemVals = Array.isArray(v) ? v : (v == null ? [] : [v]);
      if (!vals.some(x => itemVals.includes(x))) return false;
    }
    return true;
  });
}

/* ----------------- 컬럼 popover -----------------
 * 이벤트 부착은 1회만, 컬럼 리스트(body)만 매번 다시 그림.
 * 모달 닫기 / Esc / focus trap / 백드롭 클릭 모두 attachModal 위임.
 */

function renderColsBody(state, onChange) {
  const body = document.getElementById('cols-body');
  body.innerHTML = '';
  for (const c of COLUMNS) {
    const row = document.createElement('label');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.padding = '6px 0';
    row.style.borderBottom = '1px solid var(--rule)';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.cols.includes(c.id) || c.required;
    cb.disabled = c.required;
    cb.addEventListener('change', () => {
      const set = new Set(state.cols);
      if (cb.checked) set.add(c.id); else set.delete(c.id);
      state.cols = [...set];
      onChange();
    });
    const txt = document.createElement('span');
    txt.textContent = c.label + (c.required ? ' (필수)' : '');
    txt.style.fontFamily = 'var(--font-mono)';
    txt.style.fontSize = '12px';
    row.appendChild(cb);
    row.appendChild(txt);
    body.appendChild(row);
  }
}

function bindColsPopover(state, onChange) {
  const pop = document.getElementById('cols-pop');
  if (!pop) return;
  // data-close-cols 를 표준 data-modal-close 로 보강 (attachModal 이 인식)
  pop.querySelectorAll('[data-close-cols]').forEach(b => b.setAttribute('data-modal-close', ''));

  // 초기 렌더 — 사용자가 클릭하기 전부터 body 채워둠 (스크린샷 비어보이는 케이스 방지)
  renderColsBody(state, onChange);

  const modal = attachModal(pop);

  // 트리거: 컬럼 버튼
  document.querySelector('[data-cols]')?.addEventListener('click', () => {
    renderColsBody(state, onChange);   // 매번 최신 state 로 다시 그림
    modal.open();
  });

  // 기본값
  document.querySelector('[data-cols-default]')?.addEventListener('click', () => {
    state.cols = COLUMNS.filter(c => c.default).map(c => c.id);
    onChange();
    renderColsBody(state, onChange);
  });
}

/* ----------------- 상태 직렬화 ----------------- */

function persist(state) {
  store.set(state);
  // URL hash 에 기본 필터만 (간단히 mode + filters)
  const params = new URLSearchParams();
  params.set('mode', state.mode);
  for (const [k, v] of Object.entries(state.filters || {})) {
    if (v && v.length) params.set(`f.${k}`, v.join('|'));
  }
  if (state.cols && state.cols.length) params.set('cols', state.cols.join(','));
  history.replaceState(null, '', '#' + params.toString());
}

function stateFromUrl() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return {};
  const p = new URLSearchParams(h);
  const out = {};
  if (p.get('mode')) out.mode = p.get('mode');
  if (p.get('cols')) out.cols = p.get('cols').split(',').filter(Boolean);
  const filters = {};
  for (const [k, v] of p.entries()) {
    if (k.startsWith('f.')) filters[k.slice(2)] = v.split('|').filter(Boolean);
  }
  if (Object.keys(filters).length) out.filters = filters;
  return out;
}
