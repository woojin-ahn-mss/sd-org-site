/* =========================================================
   drilldown.js — 티켓 목록 모달 (재사용)
   - design 시스템 .modal-backdrop / .modal 사용
   - progress·resource·fasttrack·etr 등에서 공유
   - 표준 모달 동작은 modal.js attachModal 위임
   ========================================================= */

import { jiraKeyHtml } from './jira-link.js';
import { fmtDate } from './format.js';
import { STATUS_GROUPS, statusGroup } from './charts.js';
import { emptyHtml } from './states.js';
import { escapeHtml } from './escape.js';
import { attachModal } from './modal.js';

const TITLE_ID = 'sd-modal-title-' + Math.random().toString(36).slice(2, 8);
let modalEl = null;
let modalCtl = null;

/**
 * 티켓 리스트 모달.
 * @param {Array<any>} items
 * @param {{ kicker?: string, title?: string, maxRows?: number }} opts
 */
export function openDrilldown(items, opts = {}) {
  ensureModal();
  const { kicker = 'TICKETS', maxRows = 100 } = opts;
  const title = opts.title ?? `${items.length}건`;

  modalEl.querySelector('[data-modal-kicker]').textContent = String(kicker).toUpperCase();
  modalEl.querySelector('[data-modal-title]').textContent = title;

  const body = modalEl.querySelector('[data-modal-body]');
  if (!items.length) {
    body.innerHTML = emptyHtml({ msg: '항목 없음' });
  } else {
    body.innerHTML = renderTable(items.slice(0, maxRows)) + (
      items.length > maxRows
        ? `<div class="muted dim-mono mt-12">상위 ${maxRows}건 표시 · 전체 ${items.length}건</div>`
        : ''
    );
  }
  modalCtl.open();
}

export function closeDrilldown() { if (modalCtl) modalCtl.close(); }

function renderTable(items) {
  const rows = items.map(it => {
    const g = STATUS_GROUPS.find(x => x.id === statusGroup(it));
    return `
      <tr>
        <td>${jiraKeyHtml(it.key)}</td>
        <td>${escapeHtml(it.summary || '')}</td>
        <td><span class="dim dim-mono">${escapeHtml(it.project || '—')}</span></td>
        <td><span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(it.status || '—')}</span></td>
        <td><span class="who"><span class="who-dot"></span>${escapeHtml((it.assignee && it.assignee.name) || '—')}</span></td>
        <td class="date num">${it.dueDate ? fmtDate(it.dueDate) : '—'}</td>
      </tr>
    `;
  }).join('');
  return `
    <table class="tbl">
      <thead><tr>
        <th style="width:90px">키</th>
        <th>요약</th>
        <th style="width:90px">프로젝트</th>
        <th style="width:140px">상태</th>
        <th style="width:110px">담당</th>
        <th style="width:100px">기한</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function ensureModal() {
  if (modalEl) return;
  modalEl = document.createElement('div');
  modalEl.className = 'modal-backdrop';
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${TITLE_ID}" style="width:720px;max-width:calc(100vw - 64px)">
      <div class="modal-head">
        <div>
          <div class="modal-kicker" data-modal-kicker></div>
          <h3 class="modal-title" id="${TITLE_ID}" data-modal-title></h3>
        </div>
        <button type="button" class="modal-close" data-modal-close aria-label="닫기">CLOSE</button>
      </div>
      <div class="modal-body" data-modal-body></div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-modal-close>닫기</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);
  modalCtl = attachModal(modalEl);
}
