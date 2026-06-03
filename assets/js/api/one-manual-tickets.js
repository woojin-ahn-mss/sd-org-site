/* =========================================================
   one-manual-tickets.js — 원 티켓 검토 "링크로 수동 등록" 데이터 레이어 (Supabase)
   테이블: one_manual_tickets (jira_key PK, note, updated_at, updated_by)

   - 자동 sync 쿼리로 안 잡히는 Jira 티켓을 키로 등록 → jira_sync.py 가 issuekey IN(...)
     으로 추가 조회해 one-tickets.json 에 manual:true 로 포함시킨다.
   - ⚠ 등록 즉시 목록에 뜨지 않는다. 데이터는 다음 sync(매일 06:00 KST 또는 수동 트리거)
     실행 후 갱신된다 — UI 는 이 점을 안내해야 한다.
   ========================================================= */

import { supabase, unwrap } from './supabase.js';

/** Jira URL 또는 키 문자열에서 이슈 키(예: PD-7711)를 추출. 없으면 null.
 *  허용: 전체 URL(.../browse/PD-7711), 키 단독(pd-7711, PD-7711), 앞뒤 공백. */
export function extractJiraKey(input) {
  if (!input) return null;
  const s = String(input).trim();
  // /browse/KEY 형태 우선, 아니면 문자열 어디서든 KEY 패턴.
  const m = s.match(/(?:\/browse\/)?\b([A-Za-z][A-Za-z0-9]+-\d+)\b/);
  return m ? m[1].toUpperCase() : null;
}

/** 전체 수동 등록 행 read. @returns {Promise<Array<{jira_key, note, updated_at, updated_by}>>} */
export async function loadManualTickets() {
  return unwrap(await supabase.from('one_manual_tickets').select('*').order('updated_at', { ascending: false }));
}

/** 키 등록(upsert). note 는 선택. 키는 대문자 정규화. */
export async function addManualTicket(jiraKey, note = '') {
  const key = extractJiraKey(jiraKey);
  if (!key) throw new Error('유효한 Jira 키/링크가 아닙니다 (예: PD-7711 또는 .../browse/PD-7711)');
  const row = { jira_key: key, note: String(note || '').trim() || null };
  return unwrap(await supabase.from('one_manual_tickets').upsert(row, { onConflict: 'jira_key' }).select().single());
}

/** 키 등록 해제(삭제). */
export async function removeManualTicket(jiraKey) {
  const key = extractJiraKey(jiraKey) || String(jiraKey || '').trim().toUpperCase();
  if (!key) return;
  unwrap(await supabase.from('one_manual_tickets').delete().eq('jira_key', key));
}
