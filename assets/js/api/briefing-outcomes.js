/* =========================================================
   api/briefing-outcomes.js — 분기 발표 주제별 '성과' 메모 (Supabase)
   테이블: briefing_outcomes (quarter, subject_id, content, ...)
   ========================================================= */

import { supabase, unwrap } from './supabase.js';

const keyOf = (quarter, subjectId) => `${quarter}:${subjectId}`;

/* ----- 카드(슬라이드별: 분기×팀×주제) 통합 상태 ----- */

/** 전체 카드 로드 → { 'quarter:team:subjectId': {content, order:[], hidden:[]} }. */
export async function loadCards() {
  const rows = unwrap(await supabase.from('briefing_card').select('quarter, team, subject_id, content, ticket_order, hidden_keys'));
  const map = {};
  for (const r of rows || []) {
    map[`${r.quarter}:${r.team}:${r.subject_id}`] = {
      content: r.content || '',
      order: r.ticket_order || [],
      hidden: r.hidden_keys || [],
    };
  }
  return map;
}

/** 카드 전체 upsert(부분 클로버 방지 — content/order/hidden 모두 전달). 셋 다 비면 삭제. */
export async function saveCard(quarter, team, subjectId, { content = '', order = [], hidden = [] } = {}) {
  const empty = !String(content || '').trim() && !(order && order.length) && !(hidden && hidden.length);
  if (empty) {
    unwrap(await supabase.from('briefing_card').delete()
      .eq('quarter', quarter).eq('team', team).eq('subject_id', subjectId));
    return;
  }
  unwrap(await supabase.from('briefing_card').upsert({
    quarter, team, subject_id: subjectId,
    content: String(content || ''),
    ticket_order: order || [],
    hidden_keys: hidden || [],
  }, { onConflict: 'quarter,team,subject_id' }));
}

/** 전체 성과 로드 → { 'quarter:subjectId': content } 맵. */
export async function loadOutcomes() {
  const rows = unwrap(await supabase.from('briefing_outcomes').select('quarter, subject_id, content'));
  const map = {};
  for (const r of rows || []) map[keyOf(r.quarter, r.subject_id)] = r.content || '';
  return map;
}

/** 성과 저장 — 내용 있으면 upsert, 비면 삭제. 입력 형식(줄바꿈·공백) 그대로 보존. */
export async function upsertOutcome(quarter, subjectId, content) {
  const text = content == null ? '' : String(content);
  if (!text.trim()) {
    unwrap(await supabase.from('briefing_outcomes').delete().eq('quarter', quarter).eq('subject_id', subjectId));
    return;
  }
  unwrap(await supabase.from('briefing_outcomes')
    .upsert({ quarter, subject_id: subjectId, content: text }, { onConflict: 'quarter,subject_id' }));
}

/* ----- 숨긴(노출 제외) 티켓 ----- */

/** 숨긴 Jira 키 Set. */
export async function loadHidden() {
  const rows = unwrap(await supabase.from('briefing_hidden_tickets').select('jira_key'));
  return new Set((rows || []).map(r => r.jira_key));
}

/** 티켓 숨김 토글 — hidden=true 면 upsert(숨김), false 면 delete(노출). */
export async function setHidden(jiraKey, hidden) {
  if (hidden) {
    unwrap(await supabase.from('briefing_hidden_tickets').upsert({ jira_key: jiraKey }, { onConflict: 'jira_key' }));
  } else {
    unwrap(await supabase.from('briefing_hidden_tickets').delete().eq('jira_key', jiraKey));
  }
}

/* ----- 주제별 티켓 순서 ----- */

/** 전체 순서 로드 → { 'quarter:subjectId': [jira_key, ...] } 맵. */
export async function loadOrders() {
  const rows = unwrap(await supabase.from('briefing_ticket_order').select('quarter, subject_id, jira_keys'));
  const map = {};
  for (const r of rows || []) map[keyOf(r.quarter, r.subject_id)] = r.jira_keys || [];
  return map;
}

/** 순서 저장(upsert). 빈 배열이면 삭제. */
export async function saveOrder(quarter, subjectId, jiraKeys) {
  if (!jiraKeys || !jiraKeys.length) {
    unwrap(await supabase.from('briefing_ticket_order').delete().eq('quarter', quarter).eq('subject_id', subjectId));
    return;
  }
  unwrap(await supabase.from('briefing_ticket_order')
    .upsert({ quarter, subject_id: subjectId, jira_keys: jiraKeys }, { onConflict: 'quarter,subject_id' }));
}

/* ----- 주제 → 팀 태깅 ----- */

/** 전체 주제 팀 태깅 → { subject_id: 'hd'|'pe'|'etc' }. */
export async function loadSubjectTeams() {
  const rows = unwrap(await supabase.from('briefing_subject_team').select('subject_id, team'));
  const map = {};
  for (const r of rows || []) map[r.subject_id] = r.team;
  return map;
}

/* ----- 슬라이드(분기×팀) 카드 순서 ----- */

/** 전체 슬라이드 카드 순서 → { 'quarter:team': [subjectId, ...] }. */
export async function loadSlideOrders() {
  const rows = unwrap(await supabase.from('briefing_slide').select('quarter, team, card_order'));
  const map = {};
  for (const r of rows || []) map[`${r.quarter}:${r.team}`] = r.card_order || [];
  return map;
}

/** 카드 순서 저장(upsert). 빈 배열이면 삭제. */
export async function saveSlideOrder(quarter, team, cardOrder) {
  if (!cardOrder || !cardOrder.length) {
    unwrap(await supabase.from('briefing_slide').delete().eq('quarter', quarter).eq('team', team));
    return;
  }
  unwrap(await supabase.from('briefing_slide')
    .upsert({ quarter, team, card_order: cardOrder }, { onConflict: 'quarter,team' }));
}

/* ----- 티켓 제목 override ----- */

/** 전체 제목 override → { jira_key: title }. */
export async function loadTitles() {
  const rows = unwrap(await supabase.from('briefing_ticket_title').select('jira_key, title'));
  const map = {};
  for (const r of rows || []) map[r.jira_key] = r.title || '';
  return map;
}

/** 제목 저장 — 있으면 upsert, 비면 삭제(원래 summary 로 복귀). */
export async function setTitle(jiraKey, title) {
  const t = title == null ? '' : String(title);
  if (!t.trim()) {
    unwrap(await supabase.from('briefing_ticket_title').delete().eq('jira_key', jiraKey));
    return;
  }
  unwrap(await supabase.from('briefing_ticket_title').upsert({ jira_key: jiraKey, title: t }, { onConflict: 'jira_key' }));
}

/** 주제 팀 지정(upsert). team 이 비면 태깅 삭제(자동 배치로 복귀). */
export async function setSubjectTeam(subjectId, team) {
  if (!team) {
    unwrap(await supabase.from('briefing_subject_team').delete().eq('subject_id', subjectId));
    return;
  }
  unwrap(await supabase.from('briefing_subject_team')
    .upsert({ subject_id: subjectId, team }, { onConflict: 'subject_id' }));
}
