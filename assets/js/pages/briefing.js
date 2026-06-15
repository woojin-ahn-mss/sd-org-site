/* =========================================================
   pages/briefing.js — 분기 발표 대시보드
   상단 분기 탭(2Q 회고 / 3Q 예고) → 선택한 분기만 전체 너비 트리맵.
   타일 면적 = "주요" 여부(사용자가 직접 지정). 주요는 크게, 나머지는 작게.
   '주요 표시' 편집 모드에서 타일을 클릭해 주요 토글, 평소엔 클릭 시 티켓 리스트.
   roadmap 데이터 파이프라인 재사용.
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading } from '../states.js';
import { jiraUrl, bindJiraLinks } from '../jira-link.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { fmtDate } from '../format.js';
import { scoped } from '../storage.js';
import { loadAll as loadPlanData, joinTicketsWithOverrides } from '../api/roadmap-plan-data.js';
import { quartersForItem } from '../gantt.js';
import { auth } from '../api/supabase.js';

const YEAR = 2026;
const TABS = [
  { id: 'q2', quarter: '2026-Q2', label: '2026 2Q · 회고' },
  { id: 'q3', quarter: '2026-Q3', label: '2026 3Q · 예고' },
];
// 면적 가중치 — 주요는 크게, 나머지는 작게.
const W_MAJOR = 14;
const W_MINOR = 1;

const DROPPED = new Set(['철회/반려/취소', 'Dropped', 'DROPPED', '철회', '반려', '취소']);
const isDropped = (it) => DROPPED.has((it.status || '').trim());
const projectOf = (it) => it.project || (typeof it.key === 'string' ? it.key.split('-')[0] : '');

const store = scoped('briefing');
const state = {
  byTab: {},                 // tabId → { groups, selected }
  active: TABS[0].id,
  editing: false,
  major: { q2: new Set(), q3: new Set() },   // tabId → Set(subjectKey)
};

function loadMajor() {
  const saved = store.get() || {};
  for (const t of TABS) state.major[t.id] = new Set((saved.major && saved.major[t.id]) || []);
}
function saveMajor() {
  store.set({ major: { q2: [...state.major.q2], q3: [...state.major.q3] } });
}

export async function renderBriefing({ rootRel = '' }) {
  const map = document.getElementById('bf-map');
  showLoading(map, { rows: 4, title: false });
  loadMajor();

  try { await auth.init(); } catch (e) { console.warn('[briefing] auth.init 실패', e); }

  let data, planData;
  try {
    [data, planData] = await Promise.all([
      loadJson(`${rootRel}data/jira/initiatives.json`),
      loadPlanData(YEAR).catch(err => {
        console.warn('[briefing] 계위(Supabase) 로드 실패 — Fast Track 으로 표시:', err);
        return { objectives: [], subjects: [], overrides: [] };
      }),
    ]);
  } catch (err) {
    showError(map, err);
    return;
  }

  const objectives = planData.objectives || [];
  const subjects = planData.subjects || [];
  // ETR(외부 요청) 제외 + 종료성 상태 제외.
  const items = joinTicketsWithOverrides(data.items || [], planData.overrides || [], YEAR)
    .filter(it => !isDropped(it) && projectOf(it) !== 'ETR');

  for (const t of TABS) {
    const groups = focusSubjects(items.filter(it => quartersForItem(it).has(t.quarter)), objectives, subjects);
    state.byTab[t.id] = { groups, selected: 0 };
  }

  renderTabs();
  bindEdit();
  selectTab(state.active);

  let raf = 0;
  window.addEventListener('resize', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => layout());
  });
}

/* ----- 탭 / 편집 ----- */

function renderTabs() {
  const host = document.getElementById('bf-tabs');
  host.innerHTML = TABS.map(t =>
    `<button type="button" role="tab" data-bf-tab="${t.id}" class="${t.id === state.active ? 'on' : ''}"
       aria-selected="${t.id === state.active}">${escapeHtml(t.label)}</button>`).join('');
  host.querySelectorAll('[data-bf-tab]').forEach(b => {
    b.addEventListener('click', () => selectTab(b.dataset.bfTab));
  });
}

function bindEdit() {
  const btn = document.getElementById('bf-edit');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.editing = !state.editing;
    btn.classList.toggle('primary', state.editing);
    btn.textContent = state.editing ? '완료' : '주요 표시';
    updateCount();
    layout();
  });
}

function selectTab(tabId) {
  state.active = tabId;
  document.querySelectorAll('#bf-tabs [data-bf-tab]').forEach(b => {
    const on = b.dataset.bfTab === tabId;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  updateCount();
  layout();
  selectTheme(state.byTab[tabId].selected);
}

function updateCount() {
  const c = state.byTab[state.active];
  if (!c) return;
  const majorN = c.groups.filter(isMajor).length;
  const hint = state.editing ? ' · 타일을 클릭해 주요 지정/해제' : '';
  setText('[data-bf-count]', `주요 ${majorN} · 주제 ${c.groups.length} · 과제 ${countTickets(c.groups)}${hint}`);
}

/* ----- 주제별 집계 ----- */

function focusSubjects(items, objectives, subjects) {
  const subjById = new Map(subjects.map(s => [s.id, s]));
  const objById = new Map(objectives.map(o => [o.id, o]));
  const bySubject = new Map();
  const none = [];
  for (const it of items) {
    const sids = (it.subjectIds || []).filter(sid => subjById.has(sid));
    if (!sids.length) { none.push(it); continue; }
    for (const sid of sids) {
      if (!bySubject.has(sid)) bySubject.set(sid, []);
      bySubject.get(sid).push(it);
    }
  }
  const out = [];
  for (const [sid, its] of bySubject) {
    const s = subjById.get(sid);
    const o = s && s.objective_id ? objById.get(s.objective_id) : null;
    out.push({
      id: sid,
      subject: (s && s.name) || '(주제)',
      objective: (o && o.name) || '',
      color: (o && o.color) || 'var(--accent)',
      items: sortItems(its),
    });
  }
  out.sort((a, b) => b.items.length - a.items.length || a.subject.localeCompare(b.subject));
  if (none.length) out.push({ id: '__fasttrack__', subject: 'Fast Track', objective: '', color: 'var(--accent)', items: sortItems(none) });
  return out;
}

function isMajor(g) { return state.major[state.active].has(g.id); }

function countTickets(groups) {
  const set = new Set();
  for (const g of groups) for (const it of g.items) set.add(it.key);
  return set.size;
}

function sortItems(items) {
  return items.slice().sort((a, b) => {
    const da = a.resolutionDate || a.dueDate || '';
    const db = b.resolutionDate || b.dueDate || '';
    return da.localeCompare(db) || String(a.key).localeCompare(String(b.key));
  });
}

/* ----- 트리맵 배치 ----- */

function layout() {
  const map = document.getElementById('bf-map');
  const c = state.byTab[state.active];
  if (!map || !c) return;
  map.classList.toggle('editing', state.editing);
  if (!c.groups.length) {
    map.innerHTML = `<div class="muted" style="position:absolute;inset:0;display:grid;place-items:center;font-size:13px;">표시할 과제가 없습니다.</div>`;
    setDetail(null);
    return;
  }
  const W = map.clientWidth, H = map.clientHeight;
  if (!W || !H) { requestAnimationFrame(() => layout()); return; }

  const anyMajor = c.groups.some(isMajor);
  // 주요가 하나라도 지정되면 주요=크게/나머지=작게, 없으면 균등.
  const vals = c.groups.map((g, i) => ({
    v: anyMajor ? (isMajor(g) ? W_MAJOR : W_MINOR) : 1,
    i,
  }));
  // 주요 먼저 오도록 정렬(레이아웃상 큰 타일이 좌상단). 인덱스는 보존.
  vals.sort((a, b) => b.v - a.v);
  const rects = squarify(vals, 0, 0, W, H);

  map.innerHTML = rects.map(r => {
    const g = c.groups[r.i];
    const major = isMajor(g);
    const small = r.w < 70 || r.h < 34;
    const tiny = r.w < 38 || r.h < 24;
    const fs = Math.max(11, Math.min(26, Math.round(Math.sqrt(r.w * r.h) / 6.5)));
    const sel = r.i === c.selected ? ' is-selected' : '';
    const label = tiny ? '' :
      `<span class="bf-tile-name" style="font-size:${fs}px;">${escapeHtml(g.subject)}</span>
       ${small ? '' : `<span class="bf-tile-meta">${g.objective ? escapeHtml(g.objective) + ' · ' : ''}${g.items.length}건</span>`}`;
    return `<button type="button" class="bf-tile${sel}${major ? ' is-major' : ''}" data-bf-idx="${r.i}"
        title="${escapeAttr(g.subject)} · ${g.items.length}건"
        style="left:${r.x}px;top:${r.y}px;width:${Math.max(r.w - 4, 1)}px;height:${Math.max(r.h - 4, 1)}px;
               background:color-mix(in srgb, ${g.color} 26%, var(--bg-elev));border-color:color-mix(in srgb, ${g.color} 55%, transparent);">
        ${major ? '<span class="bf-star">★</span>' : ''}
        <span class="bf-tile-count num" style="color:${g.color};">${g.items.length}</span>
        ${label}
      </button>`;
  }).join('');

  map.querySelectorAll('.bf-tile').forEach(t => {
    t.addEventListener('click', () => onTileClick(Number(t.dataset.bfIdx)));
  });
}

function onTileClick(idx) {
  const c = state.byTab[state.active];
  const g = c.groups[idx];
  if (!g) return;
  if (state.editing) {
    const set = state.major[state.active];
    if (set.has(g.id)) set.delete(g.id); else set.add(g.id);
    saveMajor();
    updateCount();
    layout();
  } else {
    selectTheme(idx);
  }
}

function selectTheme(idx) {
  const c = state.byTab[state.active];
  if (!c || !c.groups.length) return;
  c.selected = idx;
  document.querySelectorAll('#bf-map .bf-tile').forEach(t => {
    t.classList.toggle('is-selected', Number(t.dataset.bfIdx) === idx);
  });
  setDetail(c.groups[idx]);
}

function setDetail(g) {
  const detail = document.getElementById('bf-detail');
  if (!detail) return;
  if (!g) { detail.innerHTML = ''; return; }
  detail.innerHTML = `
    <div class="bf-detail-head">
      <span class="bf-dot" style="background:${g.color};"></span>
      <strong style="color:${g.color};">${escapeHtml(g.subject)}</strong>
      ${g.objective ? `<span class="bf-theme-obj">${escapeHtml(g.objective)}</span>` : ''}
      <span class="num muted">${g.items.length}건</span>
    </div>
    <div class="bf-detail-list">${g.items.map(entryHtml).join('')}</div>`;
  bindJiraLinks(detail);
}

function entryHtml(it) {
  const url = jiraUrl(it.key);
  const keyHtml = url
    ? `<a class="key" href="${url}" target="_blank" rel="noopener noreferrer" data-jira-key="${escapeAttr(it.key)}">${escapeHtml(it.key)}</a>`
    : `<span class="key muted">${escapeHtml(it.key || '')}</span>`;
  const when = it.resolutionDate || it.dueDate;
  return `
    <div class="bf-entry">
      <div class="bf-entry-meta">
        ${keyHtml}
        <span class="bf-st ${statusCls(it.statusCategory, it.status)}">${escapeHtml(it.status || '—')}</span>
        ${when ? `<span class="bf-when num">${fmtDate(when)}</span>` : ''}
      </div>
      <div class="bf-sum">${escapeHtml(it.summary || '')}</div>
    </div>`;
}

/* ----- squarified treemap ----- */

function squarify(values, x, y, w, h) {
  const total = values.reduce((s, d) => s + d.v, 0) || 1;
  const scale = (w * h) / total;
  const items = values.map(d => ({ ...d, area: d.v * scale }));
  const out = [];
  let rect = { x, y, w, h };
  let i = 0;
  while (i < items.length) {
    const side = Math.min(rect.w, rect.h);
    let row = [items[i]];
    let best = worstRatio(row, side);
    let j = i + 1;
    for (; j < items.length; j++) {
      const r = worstRatio(row.concat(items[j]), side);
      if (r > best) break;
      row.push(items[j]); best = r;
    }
    const rowArea = row.reduce((s, d) => s + d.area, 0);
    if (rect.w <= rect.h) {
      const stripH = rowArea / rect.w || 0;
      let cx = rect.x;
      for (const d of row) { const cw = d.area / stripH || 0; out.push({ ...d, x: cx, y: rect.y, w: cw, h: stripH }); cx += cw; }
      rect = { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH };
    } else {
      const stripW = rowArea / rect.h || 0;
      let cy = rect.y;
      for (const d of row) { const ch = d.area / stripW || 0; out.push({ ...d, x: rect.x, y: cy, w: stripW, h: ch }); cy += ch; }
      rect = { x: rect.x + stripW, y: rect.y, w: rect.w - stripW, h: rect.h };
    }
    i = j;
  }
  return out;
}

function worstRatio(row, side) {
  let sum = 0, max = -Infinity, min = Infinity;
  for (const d of row) { sum += d.area; if (d.area > max) max = d.area; if (d.area < min) min = d.area; }
  const s2 = side * side, sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

function statusCls(category, name) {
  if (category === 'done') return 'st st-done';
  if (category === 'indeterminate') return 'st st-progress';
  if (category === 'new') return 'st st-prop';
  if (name === '반려' || name === 'DROPPED') return 'st st-rejected';
  return 'st st-wait';
}

function setText(sel, v) {
  const el = document.querySelector(sel);
  if (el) el.textContent = v;
}
