/* =========================================================
   states.js — Empty / Loading / Error 공통 컴포넌트
   - components.css 의 .empty-state / .skel / .error-state 와 매핑
   - HTML 문자열을 반환하므로 innerHTML 또는 insertAdjacentHTML 로 사용
   ========================================================= */

/** HTML escape */
function esc(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/**
 * 로딩 상태 (스켈레톤).
 * @param {{ rows?: number, title?: boolean }} opts
 */
export function loadingHtml(opts = {}) {
  const { rows = 3, title = true } = opts;
  const rowsHtml = Array.from({ length: rows }, (_, i) => {
    const w = [60, 45, 55, 40, 50][i % 5];
    return `<span class="skel h-row" style="width:${w}%"></span>`;
  }).join('');
  return `
    <div class="empty-state" role="status" aria-busy="true">
      ${title ? '<span class="skel h-title"></span>' : ''}
      ${rowsHtml}
    </div>
  `;
}

/**
 * 빈 상태.
 * @param {{ kicker?: string, msg?: string, hint?: string }} opts
 */
export function emptyHtml(opts = {}) {
  const { kicker = 'EMPTY', msg = '데이터 없음', hint } = opts;
  return `
    <div class="empty-state">
      <span class="empty-kicker">${esc(kicker)}</span>
      <span class="empty-msg">${esc(msg)}</span>
      ${hint ? `<span class="empty-hint">${esc(hint)}</span>` : ''}
    </div>
  `;
}

/**
 * 에러 상태.
 * @param {Error|string} err
 * @param {{ kicker?: string, msg?: string }} opts
 */
export function errorHtml(err, opts = {}) {
  const { kicker = 'FETCH FAILED', msg = '데이터를 불러오지 못했습니다.' } = opts;
  const detail = err && err.message ? err.message : String(err);
  return `
    <div class="error-state" role="alert">
      <div class="error-kicker">${esc(kicker)}</div>
      <div class="error-msg">${esc(msg)}</div>
      <div class="error-detail">${esc(detail)}</div>
    </div>
  `;
}

/** 컨테이너에 직접 상태 적용 */
export function showLoading(container, opts) {
  if (container) container.innerHTML = loadingHtml(opts);
}
export function showEmpty(container, opts) {
  if (container) container.innerHTML = emptyHtml(opts);
}
export function showError(container, err, opts) {
  if (container) container.innerHTML = errorHtml(err, opts);
}
