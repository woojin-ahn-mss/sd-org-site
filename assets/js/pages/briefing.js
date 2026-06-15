/* =========================================================
   pages/briefing.js — 분기 발표 장표(슬라이드 덱)
   페이지 자체가 덱. 분기마다: 표지 → 집중 주제 목록 → 주요 주제별 1장.
   ←/→ 로 넘기고, 전체화면 발표. '주요 편집'에서 분기별 주요 주제 지정.
   데이터는 roadmap 파이프라인 재사용(initiatives + 주제매핑, ETR·종료성 제외).
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError } from '../states.js';
import { jiraUrl, bindJiraLinks } from '../jira-link.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { scoped } from '../storage.js';
import { loadAll as loadPlanData, joinTicketsWithOverrides } from '../api/roadmap-plan-data.js';
import { quartersForItem } from '../gantt.js';
import { auth } from '../api/supabase.js';

const YEAR = 2026;
const TABS = [
  { id: 'q2', quarter: '2026-Q2', label: '2026 2Q', tag: '회고' },
  { id: 'q3', quarter: '2026-Q3', label: '2026 3Q', tag: '예고' },
];
const DEFAULT_FOCUS = 6;   // 주요 미지정 분기는 상위 N개를 집중 주제로.

const DROPPED = new Set(['철회/반려/취소', 'Dropped', 'DROPPED', '철회', '반려', '취소']);
const isDropped = (it) => DROPPED.has((it.status || '').trim());
const projectOf = (it) => it.project || (typeof it.key === 'string' ? it.key.split('-')[0] : '');

const store = scoped('briefing');
const state = {
  byTab: {},        // tabId → groups[]
  slides: [],
  idx: 0,
  editing: false,
  major: { q2: new Set(), q3: new Set() },
};

function loadMajor() {
  const saved = store.get() || {};
  for (const t of TABS) state.major[t.id] = new Set((saved.major && saved.major[t.id]) || []);
}
function saveMajor() {
  store.set({ major: { q2: [...state.major.q2], q3: [...state.major.q3] } });
}

export async function renderBriefing({ rootRel = '' }) {
  const stage = document.getElementById('deck-stage');
  stage.innerHTML = `<div class="slide-loading muted">불러오는 중…</div>`;
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
    showError(stage, err);
    return;
  }

  const objectives = planData.objectives || [];
  const subjects = planData.subjects || [];
  const items = joinTicketsWithOverrides(data.items || [], planData.overrides || [], YEAR)
    .filter(it => !isDropped(it) && projectOf(it) !== 'ETR');

  for (const t of TABS) {
    state.byTab[t.id] = focusSubjects(items.filter(it => quartersForItem(it).has(t.quarter)), objectives, subjects);
  }

  buildSlides();
  bindControls();
  render();
}

/* ----- 데이터: 주제별 집계 ----- */

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
    out.push({ id: sid, subject: (s && s.name) || '(주제)', objective: (o && o.name) || '', color: (o && o.color) || 'var(--accent)', items: sortItems(its) });
  }
  out.sort((a, b) => b.items.length - a.items.length || a.subject.localeCompare(b.subject));
  if (none.length) out.push({ id: '__fasttrack__', subject: 'Fast Track', objective: '', color: 'var(--accent)', items: sortItems(none) });
  return out;
}

function sortItems(items) {
  return items.slice().sort((a, b) => {
    const da = a.resolutionDate || a.dueDate || '';
    const db = b.resolutionDate || b.dueDate || '';
    return da.localeCompare(db) || String(a.key).localeCompare(String(b.key));
  });
}

/** 분기의 '집중 주제' = 지정된 주요, 없으면 상위 N개. */
function majorsOf(tabId) {
  const all = state.byTab[tabId] || [];
  const marked = all.filter(g => state.major[tabId].has(g.id));
  return marked.length ? marked : all.slice(0, DEFAULT_FOCUS);
}
function ticketCount(groups) {
  const set = new Set();
  for (const g of groups) for (const it of g.items) set.add(it.key);
  return set.size;
}

/* ----- 슬라이드 구성 ----- */

function buildSlides() {
  const slides = [];
  for (const t of TABS) {
    slides.push({ kind: 'cover', tab: t.id });
    slides.push({ kind: 'agenda', tab: t.id });
    for (const g of majorsOf(t.id)) slides.push({ kind: 'theme', tab: t.id, group: g });
  }
  state.slides = slides;
  if (state.idx >= slides.length) state.idx = slides.length - 1;
  if (state.idx < 0) state.idx = 0;
}

/* ----- 렌더 ----- */

function render() {
  const stage = document.getElementById('deck-stage');
  const s = state.slides[state.idx];
  if (!s) { stage.innerHTML = ''; return; }
  if (s.kind === 'cover') stage.innerHTML = coverHtml(s.tab);
  else if (s.kind === 'agenda') stage.innerHTML = agendaHtml(s.tab);
  else stage.innerHTML = themeHtml(s.group, s.tab);

  bindJiraLinks(stage);
  if (state.editing && s.kind === 'agenda') bindAgendaEdit(stage, s.tab);

  const pos = document.getElementById('deck-pos');
  if (pos) pos.textContent = `${state.idx + 1} / ${state.slides.length}`;
}

function tabMeta(tabId) { return TABS.find(t => t.id === tabId); }

function coverHtml(tabId) {
  const t = tabMeta(tabId);
  const all = state.byTab[tabId] || [];
  const focus = majorsOf(tabId);
  return `
    <div class="slide slide-cover">
      <div class="slide-kicker">QUARTERLY BRIEFING · ${escapeHtml(t.tag)}</div>
      <div class="cover-q">${escapeHtml(t.label)}</div>
      <div class="cover-sub">${t.tag === '회고' ? '진행·완료한 일' : '배포 예정'} — 집중 주제 ${focus.length}개</div>
      <div class="cover-meta num">전체 주제 ${all.length} · 과제 ${ticketCount(all)}</div>
    </div>`;
}

function agendaHtml(tabId) {
  const t = tabMeta(tabId);
  const editing = state.editing;
  const list = editing ? (state.byTab[tabId] || []) : majorsOf(tabId);
  const rows = list.map((g, i) => {
    const on = state.major[tabId].has(g.id);
    return `
      <li class="ag-row${editing ? ' editable' : ''}${editing && on ? ' on' : ''}" ${editing ? `data-ag-id="${escapeAttr(g.id)}"` : ''}>
        <span class="ag-num">${editing ? `<span class="ag-star">${on ? '★' : '☆'}</span>` : String(i + 1).padStart(2, '0')}</span>
        <span class="ag-dot" style="background:${g.color};"></span>
        <span class="ag-name">${escapeHtml(g.subject)}</span>
        ${g.objective ? `<span class="ag-obj">${escapeHtml(g.objective)}</span>` : '<span class="ag-obj"></span>'}
        <span class="ag-count num">${g.items.length}건</span>
      </li>`;
  }).join('');
  return `
    <div class="slide slide-agenda">
      <div class="slide-kicker">${escapeHtml(t.label)} · ${escapeHtml(t.tag)}</div>
      <h2 class="slide-h">집중한 주제${editing ? ' — 주요 선택(★)' : ''}</h2>
      <ol class="ag-list">${rows || '<li class="muted" style="padding:14px;">주제가 없습니다.</li>'}</ol>
    </div>`;
}

function themeHtml(g, tabId) {
  const t = tabMeta(tabId);
  return `
    <div class="slide slide-theme">
      <div class="slide-kicker">${escapeHtml(t.label)} · ${escapeHtml(t.tag)} · 주요 주제${g.objective ? ' · ' + escapeHtml(g.objective) : ''}</div>
      <h2 class="slide-h" style="color:${g.color};">${escapeHtml(g.subject)} <span class="slide-h-n">${g.items.length}건</span></h2>
      <ul class="th-list">${g.items.map(ticketHtml).join('')}</ul>
    </div>`;
}

function ticketHtml(it) {
  const url = jiraUrl(it.key);
  const keyHtml = url
    ? `<a class="key" href="${url}" target="_blank" rel="noopener noreferrer" data-jira-key="${escapeAttr(it.key)}">${escapeHtml(it.key)}</a>`
    : `<span class="key muted">${escapeHtml(it.key || '')}</span>`;
  return `<li class="th-item">
      <span class="st-dot ${statusCls(it.statusCategory)}"></span>
      ${keyHtml}
      <span class="th-sum">${escapeHtml(it.summary || '')}</span>
    </li>`;
}

/* ----- 컨트롤 ----- */

function bindControls() {
  document.getElementById('deck-prev')?.addEventListener('click', () => go(-1));
  document.getElementById('deck-next')?.addEventListener('click', () => go(1));

  const editBtn = document.getElementById('deck-edit');
  editBtn?.addEventListener('click', () => {
    state.editing = !state.editing;
    editBtn.classList.toggle('primary', state.editing);
    editBtn.textContent = state.editing ? '완료' : '주요 편집';
    // 편집 시작 시 현재 분기의 집중 주제 슬라이드로 이동.
    if (state.editing) {
      const s = state.slides[state.idx];
      const tab = s ? s.tab : TABS[0].id;
      const ai = state.slides.findIndex(sl => sl.kind === 'agenda' && sl.tab === tab);
      if (ai >= 0) state.idx = ai;
    }
    render();
  });

  const fullBtn = document.getElementById('deck-full');
  fullBtn?.addEventListener('click', () => {
    const deck = document.getElementById('deck');
    if (document.fullscreenElement) document.exitFullscreen();
    else deck.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const deck = document.getElementById('deck');
    deck.classList.toggle('is-full', !!document.fullscreenElement);
    const fb = document.getElementById('deck-full');
    if (fb) fb.textContent = document.fullscreenElement ? '창 모드' : '전체화면';
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') { state.idx = 0; render(); }
    else if (e.key === 'End') { state.idx = state.slides.length - 1; render(); }
  });
}

function go(d) {
  state.idx = Math.max(0, Math.min(state.slides.length - 1, state.idx + d));
  render();
}

function bindAgendaEdit(stage, tabId) {
  stage.querySelectorAll('[data-ag-id]').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.agId;
      const set = state.major[tabId];
      if (set.has(id)) set.delete(id); else set.add(id);
      saveMajor();
      buildSlides();         // 주제 슬라이드 갱신
      render();              // 체크 상태 반영
    });
  });
}

function statusCls(category) {
  if (category === 'done') return 'is-done';
  if (category === 'indeterminate') return 'is-progress';
  if (category === 'new') return 'is-new';
  return 'is-wait';
}
