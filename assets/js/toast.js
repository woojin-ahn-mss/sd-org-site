/* =========================================================
   toast.js — 토스트 알림 (design system .toasts/.toast)
   - 4초 후 자동 사라짐 (.toast-prog 애니메이션과 동기)
   - kind: 'default' | 'success' | 'alert'
   - alert 는 aria-live=assertive (스크린리더 즉시 안내), 그 외 polite
   ========================================================= */

import { escapeHtml } from './escape.js';

const HOLD_MS = 4000;
let politeHost = null;
let assertiveHost = null;

function ensureHosts() {
  if (!politeHost) {
    politeHost = document.querySelector('.toasts.toasts-polite');
    if (!politeHost) {
      politeHost = document.createElement('div');
      politeHost.className = 'toasts toasts-polite';
      politeHost.setAttribute('aria-live', 'polite');
      politeHost.setAttribute('aria-atomic', 'false');
      document.body.appendChild(politeHost);
    }
  }
  if (!assertiveHost) {
    assertiveHost = document.querySelector('.toasts.toasts-assertive');
    if (!assertiveHost) {
      assertiveHost = document.createElement('div');
      assertiveHost.className = 'toasts toasts-assertive';
      assertiveHost.setAttribute('aria-live', 'assertive');
      assertiveHost.setAttribute('aria-atomic', 'false');
      document.body.appendChild(assertiveHost);
    }
  }
  return { politeHost, assertiveHost };
}

/**
 * @param {{ kicker?: string, msg: string, meta?: string, kind?: 'default'|'success'|'alert', hold?: number }} opts
 */
export function toast({ kicker = '', msg, meta = '', kind = 'default', hold = HOLD_MS } = {}) {
  if (!msg) return null;
  const { politeHost, assertiveHost } = ensureHosts();
  const host = kind === 'alert' ? assertiveHost : politeHost;
  const el = document.createElement('div');
  el.className = 'toast' + (kind && kind !== 'default' ? ' ' + kind : '');
  el.innerHTML = `
    ${kicker ? `<div class="toast-kicker">${escapeHtml(kicker)}</div>` : ''}
    <div class="toast-msg">${escapeHtml(msg)}</div>
    ${meta ? `<div class="toast-meta">${escapeHtml(meta)}</div>` : ''}
    <div class="toast-prog" style="animation-duration:${hold}ms"></div>
  `;
  host.appendChild(el);

  const remove = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  };
  const t = setTimeout(remove, hold);
  el.addEventListener('click', () => { clearTimeout(t); remove(); });
  return el;
}
