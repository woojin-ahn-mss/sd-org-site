/* =========================================================
   pages/roadmap.js — 로드맵 (간트) 페이지 로직
   PRD 4.2: 필터·시간축 토글·컬럼·URL/localStorage 동기화
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading } from '../states.js';
import { renderGantt, COLUMNS, buildTimeAxis, quartersForItem } from '../gantt.js';
import { scoped } from '../storage.js';
import { attachModal } from '../modal.js';
import { currentYear } from '../goals.js';
import { loadAll as loadPlanData, joinTicketsWithOverrides } from '../api/roadmap-plan-data.js';
import { auth } from '../api/supabase.js';

const store = scoped('roadmap');

// Search & Discovery 실이 관리하는 7개 Jira 프로젝트 (CLAUDE.md 기준).
// 데이터에 없어도 chip 으로 노출 (사용자가 toggle 가능, count=0 표시).
const SD_PROJECTS = ['TM', 'MSSCXTF', 'ETR', 'FT', 'PEL', 'CBP', 'PBO'];

const FILTER_FIELDS = [
  { id: 'project', label: 'PROJECT', pick: it => it.project, fixedValues: SD_PROJECTS },
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
  groupBy: 'objective',  // 'objective'(목표·DB) | 'subject'(주제·DB) | 'mainSubject'(Jira 메인주제)
  excludeLaunched: false,  // 론치완료 상태 제외 토글
  quarter: null,           // 단일 분기 줌 (예: '2026-Q2'). null=전체(6분기 창)
};
const GROUP_MODES = ['objective', 'subject', 'mainSubject'];

export async function renderRoadmap({ rootRel = '' }) {
  const host = document.getElementById('gantt-host');
  showLoading(host, { rows: 6, title: true });

  const year = currentYear();
  // 다른 페이지와 동일하게 Supabase 세션을 먼저 복원 — 그래야 계위 쿼리에 인증 토큰이 붙는다.
  // (localStorage 보관 세션 자동 복원, 로그인 UI 별도 노출 안 함)
  await auth.init();

  let data, planData;
  try {
    // initiatives 는 필수, 계위(objectives/subjects/ticket_subjects)는 Supabase.
    // 미로그인/RLS 로 계위 로드 실패 시 빈 값으로 degrade (메인주제 그룹은 계속 동작).
    [data, planData] = await Promise.all([
      loadJson(`${rootRel}data/jira/initiatives.json`),
      loadPlanData(year).catch(err => {
        console.warn('[roadmap] 계위(Supabase) 로드 실패 — 메인주제 그룹만 가능:', err);
        return { objectives: [], subjects: [], overrides: [] };
      }),
    ]);
  } catch (err) {
    showError(host, err);
    return;
  }

  const objectives = planData.objectives || [];
  const subjects = planData.subjects || [];
  const objById = new Map(objectives.map(o => [o.id, o]));
  const subjById = new Map(subjects.map(s => [s.id, s]));
  const subjectsAvailable = subjects.length > 0;
  // 티켓에 subjectIds 부여 (ticket_subjects 매핑).
  const items = joinTicketsWithOverrides(data.items || [], planData.overrides || [], year);

  let state = { ...DEFAULT_STATE, ...(store.get() || {}), ...stateFromUrl() };
  if (!state.cols || !state.cols.length) state.cols = DEFAULT_STATE.cols;
  if (!state.filters) state.filters = {};
  // 레거시 groupBy 마이그레이션: 'goal'(LS) → 'objective', 옛 'subject'(메인주제) → 'mainSubject'.
  if (state.groupBy === 'goal') state.groupBy = 'objective';
  if (!GROUP_MODES.includes(state.groupBy)) state.groupBy = 'objective';
  // 계위가 없으면(미로그인 등) 메인주제로 폴백.
  if (!subjectsAvailable && state.groupBy !== 'mainSubject') state.groupBy = 'mainSubject';

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

  // --- 분기 줌 선택 (전체 / 단일 분기) ---
  // 옵션은 기본 분기 축(현재분기 -2~+3)의 6개 분기 + '전체'. 단일 분기 선택 시
  // 해당 분기에 걸친 Initiative 만 남기고 간트 축도 그 분기 3개월로 확대.
  function syncQuarterZoom() {
    const host = document.querySelector('[data-quarter-zoom]');
    if (!host) return;
    const quarters = buildTimeAxis('quarter').cells.map(c => c.key);
    host.innerHTML = '';
    const mk = (key, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tlink' + ((state.quarter || null) === key ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        state.quarter = key;              // null=전체
        syncQuarterZoom();
        persist(state); rerender();
      });
      host.appendChild(b);
    };
    mk(null, '전체');
    for (const q of quarters) mk(q, q.replace('-Q', ' Q'));
  }
  syncQuarterZoom();

  // --- 그룹 모드 토글 (메인주제 / 목표) ---
  document.querySelectorAll('[data-group-by]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.groupBy === state.groupBy);
    btn.addEventListener('click', () => {
      state.groupBy = btn.dataset.groupBy;
      document.querySelectorAll('[data-group-by]').forEach(b =>
        b.classList.toggle('active', b.dataset.groupBy === state.groupBy));
      state.collapsedGroups = [];
      persist(state); rerender();
    });
  });

  // --- 론치완료 제외 토글 ---
  const excludeBtn = document.querySelector('[data-exclude-launched]');
  if (excludeBtn) {
    excludeBtn.classList.toggle('active', !!state.excludeLaunched);
    excludeBtn.addEventListener('click', () => {
      state.excludeLaunched = !state.excludeLaunched;
      excludeBtn.classList.toggle('active', !!state.excludeLaunched);
      persist(state); rerender();
    });
  }

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
    let filtered = applyFilters(items, state.filters);
    if (state.excludeLaunched) {
      filtered = filtered.filter(it => it.status !== '론치완료');
    }
    // 단일 분기 줌: 그 분기에 걸친 Initiative 만 (간트 막대 판정과 동일 기준).
    if (state.quarter) {
      filtered = filtered.filter(it => quartersForItem(it).has(state.quarter));
    }
    document.querySelector('[data-cnt-total]').textContent = filtered.length;
    // 목표/주제 모드는 계위(DB) 기반으로 사전 그룹핑해 전달. 메인주제는 gantt 내부 그룹핑.
    const groups = state.groupBy === 'objective'
      ? groupByObjective(filtered, objectives, subjects, subjById)
      : state.groupBy === 'subject'
        ? groupBySubjectEntity(filtered, objectives, subjects, objById)
        : null;
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
      groupBy: state.groupBy === 'mainSubject' ? 'subject' : state.groupBy,
      groups,
      focusQuarter: state.quarter || null,
    });
  }
  rerender();
}

/* ----------------- 계위 그룹핑 (목표/주제) -----------------
 * 티켓 → subjectIds(ticket_subjects) → subject.objective_id 로 목표/주제를 도출.
 * gantt 는 group = { subject(라벨), items, _goal? } 형태를 기대.
 */

/** dueDate asc(없으면 뒤) 정렬 — gantt 내부 sortItemsForGroup 과 동일 규칙. */
function sortByDue(items) {
  items.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });
}

/** 목표 그룹 — 목표 → 주제 2단 중첩. 티켓을 주제별로 모은 뒤 그 주제를 Objective 아래 묶음. */
function groupByObjective(items, objectives, subjects, subjById) {
  const bySubject = new Map();   // sid → items
  const none = [];               // 매핑된 주제가 없는 티켓
  for (const it of items) {
    const sids = (it.subjectIds || []).filter(sid => subjById.has(sid));
    if (!sids.length) { none.push(it); continue; }
    for (const sid of sids) {
      if (!bySubject.has(sid)) bySubject.set(sid, []);
      bySubject.get(sid).push(it);
    }
  }
  const out = [];
  for (const o of objectives) {
    const subs = subjects.filter(s => s.objective_id === o.id && bySubject.has(s.id));
    if (!subs.length) continue;
    const subGroups = subs.map(s => {
      const its = bySubject.get(s.id);
      sortByDue(its);
      return {
        subject: s.name || '(주제)',
        key: `obj:${o.id}|sub:${s.id}`,
        items: its,
        _goal: subjectPeriod(s, its, o.color),
      };
    });
    // 목표 내 distinct 티켓 수 (한 티켓이 같은 목표의 여러 주제에 걸쳐도 1건).
    const seen = new Set();
    for (const sg of subGroups) for (const it of sg.items) seen.add(it.key);
    out.push({
      subject: o.name || '(목표)',
      key: `obj:${o.id}`,
      count: seen.size,
      subGroups,
      _goal: objectivePeriod(o, subjById),
    });
  }
  if (none.length) { sortByDue(none); out.push({ subject: '— 목표 미지정', key: 'obj:none', items: none }); }
  return out;
}

/** 주제 그룹 — 티켓의 subjectIds 별로 묶음. 라벨은 "목표 ↳ 주제", 목표→주제 순. */
function groupBySubjectEntity(items, objectives, subjects, objById) {
  const buckets = new Map();   // sid → items
  const none = [];
  for (const it of items) {
    const sids = (it.subjectIds || []).filter(sid => subjects.some(s => s.id === sid));
    if (!sids.length) { none.push(it); continue; }
    for (const sid of sids) {
      if (!buckets.has(sid)) buckets.set(sid, []);
      buckets.get(sid).push(it);
    }
  }
  // 목표 순서 → 그 안의 주제 순서(이미 display_order 정렬됨).
  const objOrder = new Map(objectives.map((o, i) => [o.id, i]));
  const ordered = subjects.filter(s => buckets.has(s.id)).sort((a, b) => {
    const oa = objOrder.has(a.objective_id) ? objOrder.get(a.objective_id) : 1e9;
    const ob = objOrder.has(b.objective_id) ? objOrder.get(b.objective_id) : 1e9;
    return oa - ob;
  });
  const out = ordered.map(s => {
    const its = buckets.get(s.id);
    sortByDue(its);
    const o = objById.get(s.objective_id);
    const label = o ? `${o.name} ↳ ${s.name}` : (s.name || '(주제)');
    const _goal = subjectPeriod(s, its, o ? o.color : 'accent');
    return { subject: label, items: its, _goal };
  });
  if (none.length) { sortByDue(none); out.push({ subject: '— 주제 미지정', items: none }); }
  return out;
}

/** 주제 막대 기간 — 명시적 start/endMonth 우선, 없으면 티켓들의 날짜 범위(startDate/dueDate)에서 도출.
 *  티켓에도 날짜가 하나도 없으면 null (막대 생략). */
function subjectPeriod(s, items, color) {
  if (s.startMonth && s.endMonth) {
    return { title: s.name, startMonth: s.startMonth, endMonth: s.endMonth, color };
  }
  const months = [];
  for (const it of items || []) {
    for (const d of [it.startDate, it.dueDate]) {
      if (d && /^\d{4}-\d{2}/.test(d)) months.push(d.slice(0, 7));
    }
  }
  if (!months.length) return null;
  months.sort();
  return { title: s.name, startMonth: months[0], endMonth: months[months.length - 1], color };
}

/** Objective 기간 막대 — 하위 주제들의 startMonth min ~ endMonth max. 기간 없으면 null. */
function objectivePeriod(o, subjById) {
  if (!o) return null;
  const subs = [...subjById.values()].filter(s => s.objective_id === o.id && s.startMonth && s.endMonth);
  if (!subs.length) return null;
  const starts = subs.map(s => s.startMonth).sort();
  const ends = subs.map(s => s.endMonth).sort();
  return { title: o.name, startMonth: starts[0], endMonth: ends[ends.length - 1], color: o.color };
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
  // fixedValues 가 정의되면 그 순서대로 (count=0 도 노출), 아니면 데이터 기반 상위 12개
  let sorted;
  if (field.fixedValues && field.fixedValues.length) {
    sorted = field.fixedValues.map(v => [v, counts.get(v) || 0]);
  } else {
    sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }
  const sel = new Set(state.filters[field.id] || []);

  for (const [val, ct] of sorted) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fchip' + (sel.has(val) ? ' on' : '') + (ct === 0 ? ' fchip-empty' : '');
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
  // URL hash 에 기본 필터만 (간단히 mode + filters + group)
  const params = new URLSearchParams();
  params.set('mode', state.mode);
  if (state.groupBy) params.set('group', state.groupBy);
  if (state.quarter) params.set('q', state.quarter);
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
  if (p.get('group')) out.groupBy = p.get('group');
  if (p.get('q')) out.quarter = p.get('q');
  if (p.get('cols')) out.cols = p.get('cols').split(',').filter(Boolean);
  const filters = {};
  for (const [k, v] of p.entries()) {
    if (k.startsWith('f.')) filters[k.slice(2)] = v.split('|').filter(Boolean);
  }
  if (Object.keys(filters).length) out.filters = filters;
  return out;
}
