/* =========================================================
   pages/briefing.js — 분기 발표 대시보드
   2026 2Q 회고 | 2026 3Q 예고.
   "집중한 주제(Subject)"를 티켓 수 비례 면적의 트리맵으로 보여주고(어디에
   집중했는지 한눈에), 타일을 클릭하면 그 주제의 Jira 티켓 리스트가 아래
   패널에 펼쳐진다. roadmap 데이터 파이프라인 재사용.
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading } from '../states.js';
import { jiraUrl, bindJiraLinks } from '../jira-link.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { fmtDate } from '../format.js';
import { loadAll as loadPlanData, joinTicketsWithOverrides } from '../api/roadmap-plan-data.js';
import { quartersForItem } from '../gantt.js';
import { auth } from '../api/supabase.js';

// 발표 대상 분기 (회고 / 예고). 다음 분기로 넘어가면 여기만 바꾸면 된다.
const Q_REVIEW = '2026-Q2';
const Q_PREVIEW = '2026-Q3';
const YEAR = 2026;

const DROPPED = new Set(['철회/반려/취소', 'Dropped', 'DROPPED', '철회', '반려', '취소']);
const isDropped = (it) => DROPPED.has((it.status || '').trim());
const projectOf = (it) => it.project || (typeof it.key === 'string' ? it.key.split('-')[0] : '');

// 컬럼별 상태 (리사이즈 시 재배치용)
const cols = {
  q2: { host: null, groups: [], selected: 0 },
  q3: { host: null, groups: [], selected: 0 },
};

export async function renderBriefing({ rootRel = '' }) {
  cols.q2.host = document.getElementById('bf-q2');
  cols.q3.host = document.getElementById('bf-q3');
  showLoading(cols.q2.host, { rows: 4, title: true });
  showLoading(cols.q3.host, { rows: 4, title: true });

  try { await auth.init(); } catch (e) { console.warn('[briefing] auth.init 실패', e); }

  let data, planData;
  try {
    [data, planData] = await Promise.all([
      loadJson(`${rootRel}data/jira/initiatives.json`),
      loadPlanData(YEAR).catch(err => {
        console.warn('[briefing] 계위(Supabase) 로드 실패 — 주제 미지정으로 표시:', err);
        return { objectives: [], subjects: [], overrides: [] };
      }),
    ]);
  } catch (err) {
    showError(cols.q2.host, err);
    cols.q3.host.innerHTML = '';
    return;
  }

  const objectives = planData.objectives || [];
  const subjects = planData.subjects || [];
  // ETR(외부 요청) 티켓은 분기 발표에서 제외. 종료성 상태도 제외.
  const items = joinTicketsWithOverrides(data.items || [], planData.overrides || [], YEAR)
    .filter(it => !isDropped(it) && projectOf(it) !== 'ETR');

  cols.q2.groups = focusSubjects(items.filter(it => quartersForItem(it).has(Q_REVIEW)), objectives, subjects);
  cols.q3.groups = focusSubjects(items.filter(it => quartersForItem(it).has(Q_PREVIEW)), objectives, subjects);

  setText('[data-bf-count="q2"]', `주제 ${cols.q2.groups.length} · 과제 ${countTickets(cols.q2.groups)}`);
  setText('[data-bf-count="q3"]', `주제 ${cols.q3.groups.length} · 과제 ${countTickets(cols.q3.groups)}`);
  const summaryEl = document.querySelector('[data-bf-summary]');
  if (summaryEl && !subjects.length) summaryEl.textContent = '· 로그인하면 주제별로 분류됩니다';

  renderColumn('q2');
  renderColumn('q3');

  // 리사이즈 시 트리맵 재배치 (rAF 디바운스)
  let raf = 0;
  window.addEventListener('resize', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { layout('q2'); layout('q3'); });
  });
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
      subject: (s && s.name) || '(주제)',
      objective: (o && o.name) || '',
      color: (o && o.color) || 'var(--accent)',
      items: sortItems(its),
    });
  }
  out.sort((a, b) => b.items.length - a.items.length || a.subject.localeCompare(b.subject));
  // 주제 매핑이 없는 티켓은 'Fast Track' 으로 묶는다 (사용자 정의).
  if (none.length) out.push({ subject: 'Fast Track', objective: '', color: 'var(--accent)', items: sortItems(none) });
  return out;
}

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

/* ----- 렌더: 트리맵 + 디테일 패널 ----- */

function renderColumn(which) {
  const c = cols[which];
  if (!c.groups.length) {
    c.host.innerHTML = `<div class="muted" style="padding:14px;font-size:13px;">표시할 과제가 없습니다.</div>`;
    return;
  }
  c.host.innerHTML = `
    <div class="bf-treemap" data-bf-map></div>
    <div class="bf-detail" data-bf-detail></div>`;
  layout(which);
  selectTheme(which, 0);

  const map = c.host.querySelector('[data-bf-map]');
  map.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-bf-idx]');
    if (!tile) return;
    selectTheme(which, Number(tile.dataset.bfIdx));
  });
}

/** 트리맵 타일 배치 (컨테이너 실측 → squarified). */
function layout(which) {
  const c = cols[which];
  const map = c.host && c.host.querySelector('[data-bf-map]');
  if (!map) return;
  const W = map.clientWidth, H = map.clientHeight;
  if (!W || !H) { requestAnimationFrame(() => layout(which)); return; }

  const vals = c.groups.map((g, i) => ({ v: Math.max(g.items.length, 0.0001), i }));
  const rects = squarify(vals, 0, 0, W, H);
  map.innerHTML = rects.map(r => {
    const g = c.groups[r.i];
    const small = r.w < 64 || r.h < 30;
    const tiny = r.w < 34 || r.h < 22;
    const fs = Math.max(11, Math.min(20, Math.round(Math.sqrt(r.w * r.h) / 7)));
    const sel = r.i === c.selected ? ' is-selected' : '';
    const label = tiny ? '' :
      `<span class="bf-tile-name" style="font-size:${fs}px;">${escapeHtml(g.subject)}</span>
       ${small ? '' : `<span class="bf-tile-meta">${g.objective ? escapeHtml(g.objective) + ' · ' : ''}${g.items.length}건</span>`}`;
    return `<button type="button" class="bf-tile${sel}" data-bf-idx="${r.i}"
        title="${escapeAttr(g.subject)} · ${g.items.length}건"
        style="left:${r.x}px;top:${r.y}px;width:${Math.max(r.w - 3, 1)}px;height:${Math.max(r.h - 3, 1)}px;
               background:color-mix(in srgb, ${g.color} 26%, var(--bg-elev));border-color:color-mix(in srgb, ${g.color} 55%, transparent);">
        <span class="bf-tile-count num" style="color:${g.color};">${g.items.length}</span>
        ${label}
      </button>`;
  }).join('');
}

function selectTheme(which, idx) {
  const c = cols[which];
  c.selected = idx;
  const map = c.host.querySelector('[data-bf-map]');
  if (map) map.querySelectorAll('.bf-tile').forEach(t => {
    t.classList.toggle('is-selected', Number(t.dataset.bfIdx) === idx);
  });
  const detail = c.host.querySelector('[data-bf-detail]');
  const g = c.groups[idx];
  if (!detail || !g) return;
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
      for (const d of row) {
        const cw = d.area / stripH || 0;
        out.push({ ...d, x: cx, y: rect.y, w: cw, h: stripH });
        cx += cw;
      }
      rect = { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH };
    } else {
      const stripW = rowArea / rect.h || 0;
      let cy = rect.y;
      for (const d of row) {
        const ch = d.area / stripW || 0;
        out.push({ ...d, x: rect.x, y: cy, w: stripW, h: ch });
        cy += ch;
      }
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
