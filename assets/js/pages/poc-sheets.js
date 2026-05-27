/* =========================================================
   pages/poc-sheets.js
   Google Sheets API 직접 호출 PoC.
   ========================================================= */

import { auth, sheets, SPREADSHEET_ID } from '../api/sheets.js';

// ─── DOM refs ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  signin: $('btn-signin'),
  signout: $('btn-signout'),
  authStatus: $('auth-status'),
  read: $('btn-read'),
  readStatus: $('read-status'),
  append: $('btn-append'),
  appendStatus: $('append-status'),
  nextKey: $('next-key'),
  todayIso: $('today-iso'),
  update: $('btn-update'),
  updateStatus: $('update-status'),
  log: $('log'),
};

// ─── helpers ──────────────────────────────────────────────────────────
function ts() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function log(level, msg, payload) {
  const line = document.createElement('div');
  const tsSpan = `<span class="ts">[${ts()}]</span> `;
  const cls = level === 'ok' ? 'ok' : level === 'err' ? 'err' : '';
  line.innerHTML = `${tsSpan}<span class="${cls}">${msg}</span>`;
  if (payload !== undefined) {
    line.innerHTML += '\n' + escapeHtml(JSON.stringify(payload, null, 2));
  }
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setStatus(el, level, text) {
  el.className = 'poc-status ' + level;
  el.textContent = text;
}

function refreshAuthButtons() {
  const signedIn = auth.isSignedIn();
  els.signin.disabled = signedIn;
  els.signout.disabled = !signedIn;
  els.read.disabled = !signedIn;
  els.append.disabled = !signedIn;
  // update 는 append 가 한 번 성공한 뒤에만 활성화 — 별도 state 로 관리
  if (!signedIn) els.update.disabled = true;
  if (signedIn) {
    setStatus(els.authStatus, 'ok', `로그인됨: ${auth.email() || '(이메일 미상)'}`);
  } else {
    setStatus(els.authStatus, '', '로그인 안 됨');
  }
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let lastAppendedKey = null;

function nextTestKey() {
  return `TEST-${Date.now()}`;
}

function refreshPreview() {
  els.nextKey.textContent = nextTestKey();
  els.todayIso.textContent = todayYmd();
}

// ─── handlers ─────────────────────────────────────────────────────────
async function runFullCheck() {
  log('info', '─── 자동 검증 시작 ───');
  // 1. read
  setStatus(els.readStatus, '', '읽는 중…');
  try {
    const res = await sheets.read(SPREADSHEET_ID, 'plan!A1:Z1000');
    const rows = (res.values || []).length;
    setStatus(els.readStatus, 'ok', `OK — ${rows} 행 (헤더 포함)`);
    log('ok', `1. read plan!A1:Z1000 — ${rows} 행`);
  } catch (e) {
    setStatus(els.readStatus, 'err', 'FAIL: ' + e.message);
    log('err', '1. read 실패', { error: e.message, status: e.status, body: e.body });
    log('err', '─── read 실패로 중단 ───');
    return;
  }
  // 2. append
  setStatus(els.appendStatus, '', 'append 중…');
  const key = nextTestKey();
  const today = todayYmd();
  const row = [key, 'PoC', '', '', '', '', '', today, '', new Date().toISOString()];
  try {
    const res = await sheets.append(SPREADSHEET_ID, 'plan!A1', [row]);
    lastAppendedKey = key;
    setStatus(els.appendStatus, 'ok', `OK — ${key} 행 추가`);
    log('ok', `2. append plan — key=${key}`);
    refreshPreview();
  } catch (e) {
    setStatus(els.appendStatus, 'err', 'FAIL: ' + e.message);
    log('err', '2. append 실패', { error: e.message, status: e.status, body: e.body });
    log('err', '─── append 실패로 중단 ───');
    return;
  }
  // 3. update
  setStatus(els.updateStatus, '', 'update 중…');
  try {
    const readRes = await sheets.read(SPREADSHEET_ID, 'plan!A:A');
    const keys = (readRes.values || []).map((r) => r[0]);
    const idx = keys.indexOf(lastAppendedKey);
    if (idx === -1) throw new Error(`키 ${lastAppendedKey} 를 plan!A 열에서 찾지 못함`);
    const rowNum = idx + 1;
    const range = `plan!B${rowNum}`;
    const res = await sheets.update(SPREADSHEET_ID, range, [['PoC 수정됨']]);
    setStatus(els.updateStatus, 'ok', `OK — ${range} ← "PoC 수정됨"`);
    els.update.disabled = false;
    log('ok', `3. update ${range}`);
  } catch (e) {
    setStatus(els.updateStatus, 'err', 'FAIL: ' + e.message);
    log('err', '3. update 실패', { error: e.message, status: e.status, body: e.body });
    return;
  }
  log('ok', '─── 자동 검증 모두 통과 — read / append / update 3종 ✓ ───');
  log('info', `Sheet 의 파일→버전 기록에서 본인 이름 + "${lastAppendedKey}" 확인하세요.`);
}

els.signin.addEventListener('click', async () => {
  setStatus(els.authStatus, '', '로그인 중…');
  try {
    const res = await auth.signIn();
    log('ok', 'OAuth 토큰 발급 성공', { email: res.email, tokenPrefix: (res.accessToken || '').slice(0, 12) + '…' });
    refreshAuthButtons();
    refreshPreview();
    // 로그인 성공 시 자동으로 read → append → update 순차 검증.
    await runFullCheck();
  } catch (e) {
    setStatus(els.authStatus, 'err', '로그인 실패: ' + e.message);
    log('err', '로그인 실패', { error: e.message });
  }
});

els.signout.addEventListener('click', () => {
  auth.signOut();
  log('info', '로그아웃 + 토큰 revoke');
  refreshAuthButtons();
});

els.read.addEventListener('click', async () => {
  setStatus(els.readStatus, '', '읽는 중…');
  try {
    const res = await sheets.read(SPREADSHEET_ID, 'plan!A1:Z1000');
    const rows = (res.values || []).length;
    setStatus(els.readStatus, 'ok', `OK — ${rows} 행 (헤더 포함)`);
    log('ok', `read plan!A1:Z1000 — ${rows} 행`, res);
  } catch (e) {
    setStatus(els.readStatus, 'err', 'FAIL: ' + e.message);
    log('err', 'read 실패', { error: e.message, status: e.status, body: e.body });
  }
});

els.append.addEventListener('click', async () => {
  setStatus(els.appendStatus, '', 'append 중…');
  const key = nextTestKey();
  const today = todayYmd();
  // plan 시트 컬럼: jira_key, pm, pd, be, fe, me, md, plan_start, plan_end, last_updated_at
  const row = [key, 'PoC', '', '', '', '', '', today, '', new Date().toISOString()];
  try {
    const res = await sheets.append(SPREADSHEET_ID, 'plan!A1', [row]);
    lastAppendedKey = key;
    setStatus(els.appendStatus, 'ok', `OK — ${key} 행 추가`);
    els.update.disabled = false;
    setStatus(els.updateStatus, '', `대기 — ${key} 의 pm 셀 수정 가능`);
    log('ok', `append plan — key=${key}`, res);
    refreshPreview();
  } catch (e) {
    setStatus(els.appendStatus, 'err', 'FAIL: ' + e.message);
    log('err', 'append 실패', { error: e.message, status: e.status, body: e.body });
  }
});

els.update.addEventListener('click', async () => {
  if (!lastAppendedKey) return;
  setStatus(els.updateStatus, '', 'update 중…');
  try {
    // 행 찾기: plan!A:A read → key 일치하는 행 번호 계산.
    const readRes = await sheets.read(SPREADSHEET_ID, 'plan!A:A');
    const keys = (readRes.values || []).map((r) => r[0]);
    const idx = keys.indexOf(lastAppendedKey);
    if (idx === -1) throw new Error(`키 ${lastAppendedKey} 를 plan!A 열에서 찾지 못함`);
    const rowNum = idx + 1; // 1-based, 헤더가 row 1
    // pm 은 B 열
    const range = `plan!B${rowNum}`;
    const res = await sheets.update(SPREADSHEET_ID, range, [['PoC 수정됨']]);
    setStatus(els.updateStatus, 'ok', `OK — ${range} ← "PoC 수정됨"`);
    log('ok', `update ${range}`, res);
  } catch (e) {
    setStatus(els.updateStatus, 'err', 'FAIL: ' + e.message);
    log('err', 'update 실패', { error: e.message, status: e.status, body: e.body });
  }
});

// ─── init ─────────────────────────────────────────────────────────────
refreshAuthButtons();
refreshPreview();
log('info', 'PoC 페이지 로드 완료. "Google 로그인" 부터 시작하세요.');
