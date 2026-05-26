/* =========================================================
   jira-link.js — Jira 키 → deeplink URL
   - 사이트는 public github pages 지만 Jira 자체는 사내 접속만 가능
   - PRD: https://jira.team.musinsa.com (server) / atlassian.net 도 같이 운용
   - 우리 시스템 정답: server URL (사용자가 평소 보는 화면)
   ========================================================= */

import { escapeHtml } from './escape.js';

export const JIRA_BASE = 'https://jira.team.musinsa.com';

/** 정상적인 Jira 키 형태인지 (PROJECT-1234) */
export function isJiraKey(s) {
  return typeof s === 'string' && /^[A-Z][A-Z0-9]+-\d+$/.test(s);
}

/** Jira 키 → 브라우저 URL */
export function jiraUrl(key) {
  if (!isJiraKey(key)) return null;
  return `${JIRA_BASE}/browse/${key}`;
}

/**
 * 페이지 안의 `[data-jira-key]` 비-anchor 요소를 클릭 시 새 탭으로 Jira 열도록 바인딩.
 * (event delegation — DOM 갱신에도 자동 작동)
 *
 * 주의: anchor(`<a href>`)는 브라우저 기본 동작이 이미 새 탭을 열므로 건너뜀.
 * 그러지 않으면 더블 오픈 발생 (리뷰 Critical #1).
 */
export function bindJiraLinks(root = document) {
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-jira-key], .key[data-key]');
    if (!el) return;
    if (el.tagName === 'A' && el.getAttribute('href')) return; // native anchor 처리
    const key = el.dataset.jiraKey || el.dataset.key || el.textContent.trim();
    const url = jiraUrl(key);
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

/**
 * "CBP-1234" 텍스트를 anchor 로 마크업하는 HTML 헬퍼.
 */
export function jiraKeyHtml(key, { className = 'key' } = {}) {
  const safe = escapeHtml(key || '');
  const url = jiraUrl(key);
  if (!url) return `<span class="${className} muted">${safe}</span>`;
  return `<a class="${className}" href="${url}" target="_blank" rel="noopener noreferrer" data-jira-key="${safe}">${safe}</a>`;
}
