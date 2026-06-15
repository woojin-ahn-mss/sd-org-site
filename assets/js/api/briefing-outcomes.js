/* =========================================================
   api/briefing-outcomes.js — 분기 발표 주제별 '성과' 메모 (Supabase)
   테이블: briefing_outcomes (quarter, subject_id, content, ...)
   ========================================================= */

import { supabase, unwrap } from './supabase.js';

const keyOf = (quarter, subjectId) => `${quarter}:${subjectId}`;

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
