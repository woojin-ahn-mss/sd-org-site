/* =========================================================
   pages/briefing.js — 분기 발표 대시보드
   2026 2Q 회고(진행·완료) | 2026 3Q 예고(배포 예정)
   목표 → 주제(Subject) 계위로 분류. roadmap 과 동일 데이터 파이프라인 재사용.
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

// 철회/반려/취소(종료성) 상태는 항상 제외 (roadmap 과 동일 기준).
const DROPPED = new Set(['철회/반려/취소', 'Dropped', 'DROPPED', '철회', '반려', '취소']);
const isDropped = (it) => DROPPED.has((it.status || '').trim());

export async function renderBriefing({ rootRel = '' }) {
  const q2Host = document.getElementById('bf-q2');
  const q3Host = document.getElementById('bf-q3');
  showLoading(q2Host, { rows: 5, title: true });
  showLoading(q3Host, { rows: 5, title: true });

  // Supabase 세션 복원 (계위 쿼리 인증). 실패해도 평면 degrade.
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
    showError(q2Host, err);
    q3Host.innerHTML = '';
    return;
  }

  const objectives = planData.objectives || [];
  const subjects = planData.subjects || [];
  const items = joinTicketsWithOverrides(data.items || [], planData.overrides || [], YEAR)
    .filter(it => !isDropped(it));

  const inQuarter = (it, q) => quartersForItem(it).has(q);
  const q2Items = items.filter(it => inQuarter(it, Q_REVIEW));
  const q3Items = items.filter(it => inQuarter(it, Q_PREVIEW));

  // 헤더 카운트
  setText('[data-bf-count="q2"]', q2Items.length);
  setText('[data-bf-count="q3"]', q3Items.length);
  const summaryEl = document.querySelector('[data-bf-summary]');
  if (summaryEl) {
    summaryEl.textContent = subjects.length
      ? `2Q ${q2Items.length}건 · 3Q ${q3Items.length}건`
      : `2Q ${q2Items.length}건 · 3Q ${q3Items.length}건 (로그인하면 목표·주제로 분류됩니다)`;
  }

  q2Host.innerHTML = columnHtml(groupByObjective(q2Items, objectives, subjects), '2Q 과제가 없습니다.');
  q3Host.innerHTML = columnHtml(groupByObjective(q3Items, objectives, subjects), '3Q 예정 과제가 없습니다.');

  // Jira 키 클릭 → 새 탭 (비-anchor data-jira-key 위임). anchor 는 native.
  bindJiraLinks(document.querySelector('.bf-cols') || document);
}

/* ----- 그룹핑 (목표 → 주제) ----- */

function groupByObjective(items, objectives, subjects) {
  const subjById = new Map(subjects.map(s => [s.id, s]));
  const bySubject = new Map();   // subjectId → items
  const none = [];               // 매핑된 주제 없음
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
    const subGroups = subs.map(s => ({ name: s.name || '(주제)', items: sortItems(bySubject.get(s.id)) }));
    const seen = new Set();
    for (const sg of subGroups) for (const it of sg.items) seen.add(it.key);
    out.push({ name: o.name || '(목표)', color: o.color || 'var(--text)', count: seen.size, subGroups });
  }
  if (none.length) {
    out.push({ name: '— 주제 미지정', color: 'var(--dim)', count: none.length, subGroups: [{ name: '', items: sortItems(none) }] });
  }
  return out;
}

/** 종료/기한 임박 순 정렬 (완료일 → 기한 → 키). */
function sortItems(items) {
  return items.slice().sort((a, b) => {
    const da = a.resolutionDate || a.dueDate || '';
    const db = b.resolutionDate || b.dueDate || '';
    return da.localeCompare(db) || String(a.key).localeCompare(String(b.key));
  });
}

/* ----- 렌더 ----- */

function columnHtml(groups, emptyMsg) {
  if (!groups.length) return `<div class="muted" style="padding:14px;font-size:13px;">${escapeHtml(emptyMsg)}</div>`;
  return groups.map(g => {
    const subs = g.subGroups.map(sg => `
      <div class="bf-subj">
        ${sg.name ? `<div class="bf-subj-head">↳ ${escapeHtml(sg.name)} <span class="num">${sg.items.length}</span></div>` : ''}
        ${sg.items.map(entryHtml).join('')}
      </div>`).join('');
    return `
      <div class="bf-group">
        <div class="bf-obj-head">
          <span class="bf-dot" style="background:${g.color};"></span>
          <strong style="color:${g.color};">${escapeHtml(g.name)}</strong>
          <span class="num muted">${g.count}</span>
        </div>
        ${subs}
      </div>`;
  }).join('');
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
      </div>
      <div class="bf-entry-body">
        <div class="bf-sum">${escapeHtml(it.summary || '')}</div>
        ${when ? `<div class="bf-when num">${fmtDate(when)}</div>` : ''}
      </div>
    </div>`;
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
