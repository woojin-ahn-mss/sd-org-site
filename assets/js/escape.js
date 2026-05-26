/* =========================================================
   escape.js — HTML/Attribute 안전 처리 단일 헬퍼
   - 중복 구현을 막기 위해 모든 모듈은 이 파일을 import 한다.
   ========================================================= */

const TABLE = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => TABLE[c]);
}

export const escapeAttr = escapeHtml;
