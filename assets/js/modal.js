/* =========================================================
   modal.js — 공용 모달 헬퍼 (focus trap + Esc + 포커스 복원)
   - design system .modal-backdrop / .modal 사용
   - drilldown / roadmap-plan / 향후 추가 페이지가 공유
   ========================================================= */

/** 모달 백드롭 element 에 표준 동작 부착.
 *  - [data-modal-close] 클릭 → close
 *  - backdrop 클릭 → close
 *  - Escape → close
 *  - Tab → focus trap (modal 내부에서만 순환)
 *
 *  @param {HTMLElement} backdrop  `.modal-backdrop` 루트
 *  @param {{ onClose?: () => void, initialFocus?: HTMLElement | (() => HTMLElement) }} opts
 *  @returns {{ open(): void, close(): void, isOpen(): boolean }}
 */
export function attachModal(backdrop, opts = {}) {
  let lastFocused = null;

  const close = () => {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    if (opts.onClose) opts.onClose();
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (_) { /* detached */ }
    }
    lastFocused = null;
  };

  const open = () => {
    lastFocused = document.activeElement;
    backdrop.hidden = false;
    const initial = typeof opts.initialFocus === 'function'
      ? opts.initialFocus()
      : opts.initialFocus;
    const target = initial || backdrop.querySelector('[data-modal-close]');
    if (target && typeof target.focus === 'function') setTimeout(() => target.focus(), 0);
  };

  backdrop.addEventListener('click', e => {
    if (e.target.matches('[data-modal-close]') || e.target === backdrop) close();
  });
  document.addEventListener('keydown', e => {
    if (backdrop.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') trapTab(e, backdrop);
  });

  return { open, close, isOpen: () => !backdrop.hidden };
}

function trapTab(e, backdrop) {
  const root = backdrop.querySelector('.modal');
  if (!root) return;
  const focusables = root.querySelectorAll(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && active === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault(); first.focus();
  }
}
