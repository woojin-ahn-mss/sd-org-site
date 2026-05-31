/* =========================================================
   pages/poc-sheets.js — Raw Data
   편집 데이터 원천인 Google Sheet 를 탭별 읽기전용으로 표시.
   - 사용자 본인 OAuth (sheets.js). 백엔드 0개.
   - 시트 목록(탭) 조회 → 탭 선택 → 해당 탭 raw 행을 표로.
   - "스프레드시트 열기" 로 실제 Sheet 새 탭 열기.
   ========================================================= */

import { auth, sheets, SPREADSHEET_ID, AuthRequiredError } from '../api/sheets.js';
import { showLoading, showError, emptyHtml } from '../states.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { scoped } from '../storage.js';
import { toast } from '../toast.js';

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
const TAB_KEY = 'rawData.tab';
const MAX_ROWS = 2000;

const $ = (id) => document.getElementById(id);

const state = {
  rootRel: '',
  signedIn: false,
  email: null,
  tabs: [],          // [{title, index, sheetId, gridProperties}]
  activeTab: null,
};

export async function renderRawData({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  const link = $('sheet-link');
  if (link) link.href = SHEET_URL;

  bindAuthUi();
  renderAuthUi('checking');

  if (auth.isSignedIn()) {
    state.signedIn = true;
    state.email = auth.email();
    renderAuthUi('signedIn');
    await loadTabs();
    return;
  }

  try {
    await Promise.race([
      auth.signIn({ silent: true }),
      new Promise((_, reject) => setTimeout(() => reject(new AuthRequiredError('silent timeout')), 5000)),
    ]);
    state.signedIn = true;
    state.email = auth.email();
    renderAuthUi('signedIn');
    await loadTabs();
  } catch (e) {
    state.signedIn = false;
    renderAuthUi('signedOut');
    showSignedOutHint();
    if (!(e instanceof AuthRequiredError)) console.warn('[raw-data] silent auth', e);
  }
}

/* ─── 탭 목록 + 데이터 ────────────────────────────────────── */

async function loadTabs() {
  const host = $('raw-table');
  showLoading(host, { rows: 4, title: false });
  let meta;
  try {
    meta = await sheets.meta(SPREADSHEET_ID, {
      fields: 'sheets.properties(title,index,sheetId,gridProperties(rowCount,columnCount))',
    });
  } catch (e) {
    if (e instanceof AuthRequiredError) { state.signedIn = false; renderAuthUi('signedOut'); showSignedOutHint(); return; }
    console.error('[raw-data] meta 실패', e);
    showError(host, e);
    return;
  }
  state.tabs = (meta.sheets || []).map(s => s.properties).filter(Boolean)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const tabMeta = $('tab-meta');
  if (tabMeta) tabMeta.textContent = `${state.tabs.length}개 탭`;

  // 활성 탭 결정: 저장값 → 첫 탭
  const saved = scoped(TAB_KEY).get(null);
  state.activeTab = state.tabs.some(t => t.title === saved) ? saved
    : (state.tabs[0] && state.tabs[0].title) || null;

  renderTabs();
  if (state.activeTab) await loadActiveTab();
  else host.innerHTML = emptyHtml({ kicker: 'NO TABS', msg: '시트에 탭이 없습니다.' });
}

function renderTabs() {
  const host = $('sheet-tabs');
  if (!host) return;
  if (!state.tabs.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="filter-row"><span class="flabel">탭</span>` + state.tabs.map(t => {
    const on = t.title === state.activeTab;
    return `<button type="button" class="fchip ${on ? 'on' : ''}" data-tab="${escapeAttr(t.title)}">${escapeHtml(t.title)}</button>`;
  }).join('') + `</div>`;
  host.querySelectorAll('button.fchip').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.activeTab = btn.dataset.tab;
      scoped(TAB_KEY).set(state.activeTab);
      renderTabs();
      await loadActiveTab();
    });
  });
}

/** 시트 탭 이름을 안전한 A1 range 로 (작은따옴표 escape). */
function tabRange(title) {
  const t = String(title).replace(/'/g, "''");
  return `'${t}'!A1:AZ${MAX_ROWS}`;
}

async function loadActiveTab() {
  const host = $('raw-table');
  if (!host || !state.activeTab) return;
  showLoading(host, { rows: 4, title: false });
  try {
    const res = await sheets.read(SPREADSHEET_ID, tabRange(state.activeTab));
    renderTable(host, res.values || []);
  } catch (e) {
    if (e instanceof AuthRequiredError) { state.signedIn = false; renderAuthUi('signedOut'); showSignedOutHint(); return; }
    console.error('[raw-data] read 실패', e);
    showError(host, e);
  }
}

function renderTable(host, values) {
  if (!values.length) {
    host.innerHTML = emptyHtml({ kicker: 'EMPTY', msg: `"${state.activeTab}" 탭에 데이터가 없습니다.` });
    return;
  }
  const header = values[0] || [];
  const body = values.slice(1);
  const colCount = values.reduce((m, r) => Math.max(m, (r || []).length), 0);

  const headCells = ['<th class="rownum">#</th>']
    .concat(Array.from({ length: colCount }, (_, c) =>
      `<th>${escapeHtml(header[c] != null && header[c] !== '' ? header[c] : colLabel(c))}</th>`))
    .join('');

  const bodyRows = body.map((row, i) => {
    const cells = Array.from({ length: colCount }, (_, c) => {
      const v = row ? row[c] : '';
      const empty = v == null || v === '';
      return `<td class="${empty ? 'empty-cell' : ''}">${empty ? '·' : escapeHtml(v)}</td>`;
    }).join('');
    return `<tr><td class="rownum">${i + 2}</td>${cells}</tr>`;
  }).join('');

  host.innerHTML = `
    <div class="sec-head" style="margin-bottom:8px">
      <small><span class="num">${body.length}</span> 행 · <span class="num">${colCount}</span> 열 · 탭 <strong>${escapeHtml(state.activeTab)}</strong> (읽기 전용)</small>
    </div>
    <div class="raw-scroll">
      <table class="raw-tbl">
        <thead><tr>${headCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

/** 0→A, 1→B … (헤더 비었을 때 컬럼 라벨). */
function colLabel(n) {
  let s = '';
  n = Math.floor(n);
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

function showSignedOutHint() {
  const host = $('raw-table');
  if (host) host.innerHTML = emptyHtml({
    kicker: 'LOGIN REQUIRED',
    msg: 'Google 로그인하면 스프레드시트 데이터가 표시됩니다.',
    hint: '우측 상단 "Google 로그인" 클릭',
  });
  const tabs = $('sheet-tabs');
  if (tabs) tabs.innerHTML = '';
}

/* ─── 인증 UI ─────────────────────────────────────────────── */

function bindAuthUi() {
  const signin = $('btn-signin');
  const signout = $('btn-signout');
  const refresh = $('btn-refresh');
  if (signin) signin.addEventListener('click', onSignInClick);
  if (signout) signout.addEventListener('click', onSignOutClick);
  if (refresh) refresh.addEventListener('click', () => loadTabs());
}

async function onSignInClick() {
  renderAuthUi('checking');
  try {
    await auth.signIn();
    state.signedIn = true;
    state.email = auth.email();
    renderAuthUi('signedIn');
    await loadTabs();
  } catch (e) {
    state.signedIn = false;
    renderAuthUi('signedOut');
    showSignedOutHint();
    if (e instanceof AuthRequiredError) {
      toast({ kicker: '로그인 필요', msg: 'popup 이 차단되었을 수 있습니다.', kind: 'alert' });
    } else {
      toast({ kicker: '로그인 실패', msg: e.message || String(e), kind: 'alert' });
    }
  }
}

function onSignOutClick() {
  auth.signOut();
  state.signedIn = false;
  state.email = null;
  state.tabs = [];
  state.activeTab = null;
  renderAuthUi('signedOut');
  showSignedOutHint();
  const tabMeta = $('tab-meta');
  if (tabMeta) tabMeta.textContent = '로그인 후 표시';
}

/** @param {'checking'|'signedIn'|'signedOut'} phase */
function renderAuthUi(phase) {
  const status = $('auth-status');
  const signin = $('btn-signin');
  const signout = $('btn-signout');
  const refresh = $('btn-refresh');
  if (!status) return;
  const show = (el, on) => { if (el) el.hidden = !on; };

  switch (phase) {
    case 'checking':
      status.textContent = '인증 확인 중…';
      show(signin, false); show(signout, false);
      if (refresh) refresh.disabled = true;
      break;
    case 'signedIn':
      status.textContent = `로그인됨${state.email ? ' · ' + state.email : ''}`;
      show(signin, false); show(signout, true);
      if (refresh) refresh.disabled = false;
      break;
    case 'signedOut':
    default:
      status.textContent = '로그인 안 됨';
      show(signin, true); show(signout, false);
      if (refresh) refresh.disabled = true;
      break;
  }
}

export const _internal = { tabRange, colLabel };
