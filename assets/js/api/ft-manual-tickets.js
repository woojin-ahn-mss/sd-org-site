/* =========================================================
   ft-manual-tickets.js — 패스트트랙 "키로 수동 등록" 데이터 레이어 (Supabase)
   테이블: ft_manual_tickets (jira_key PK, note, updated_at, updated_by)

   - 자동 sync 쿼리(project IN(MSSCXTF,FT,PEL) AND issuetype=Initiative)로 안 잡히는
     패스트트랙 티켓(예: 특정 TM Initiative)을 키로 등록 → jira_sync.py 가 issuekey IN(...)
     으로 추가 조회해 ft-tickets.json 에 manual:true 로 포함시킨다.
   - ⚠ 등록 즉시 목록에 뜨지 않는다. 데이터는 다음 sync(매일 06:00 KST 또는 수동 트리거)
     실행 후 갱신된다 — UI 는 이 점을 안내해야 한다.
   - one-manual-tickets.js 와 동일 패턴. 키 추출기는 거기서 재사용.
   ========================================================= */

import { supabase, unwrap } from './supabase.js';
import { extractJiraKey } from './one-manual-tickets.js';

export { extractJiraKey };

/** 전체 수동 등록 행 read. @returns {Promise<Array<{jira_key, note, updated_at, updated_by}>>} */
export async function loadManualTickets() {
  return unwrap(await supabase.from('ft_manual_tickets').select('*').order('updated_at', { ascending: false }));
}

/** 키 등록(upsert). note 는 선택. 키는 대문자 정규화. */
export async function addManualTicket(jiraKey, note = '') {
  const key = extractJiraKey(jiraKey);
  if (!key) throw new Error('유효한 Jira 키/링크가 아닙니다 (예: TM-1234 또는 .../browse/TM-1234)');
  const row = { jira_key: key, note: String(note || '').trim() || null };
  return unwrap(await supabase.from('ft_manual_tickets').upsert(row, { onConflict: 'jira_key' }).select().single());
}

/** 키 등록 해제(삭제). */
export async function removeManualTicket(jiraKey) {
  const key = extractJiraKey(jiraKey) || String(jiraKey || '').trim().toUpperCase();
  if (!key) return;
  unwrap(await supabase.from('ft_manual_tickets').delete().eq('jira_key', key));
}
