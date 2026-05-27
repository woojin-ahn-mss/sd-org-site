/* =========================================================
   nav.js — 좌측 사이드바 네비게이션 (PRD 10.1 결정)
   - design/styles.css 의 .sb / .sb-* 클래스 그대로 사용
   - 페이지 8개, 활성 표시, last-sync (meta.json), 테마 토글, 단축키 1~8
   - 768px 이하는 design system이 가로 스크롤 형태로 자동 변환
   ========================================================= */

import { fmtDateTime } from './format.js';
import { bindThemeButtons } from './theme.js';
import { scoped } from './storage.js';

const SIDEBAR_STATE_KEY = 'sidebar.collapsed';

/** 페이지 정의 (디자인 결정: 좌측 사이드바, 카운트 배지) */
export const PAGES = [
  { id: 'home',         num: '01', label: '홈',          path: '' },
  { id: 'roadmap',      num: '02', label: '로드맵',       path: 'pages/roadmap.html' },
  { id: 'progress',     num: '03', label: '진행 현황',     path: 'pages/progress.html' },
  { id: 'resource',     num: '04', label: '리소스',        path: 'pages/resource.html' },
  { id: 'performance',  num: '05', label: '성과',         path: 'pages/performance.html' },
  { id: 'roadmap-plan', num: '06', label: '로드맵 관리',    path: 'pages/roadmap-plan.html' },
  { id: 'fasttrack',    num: '07', label: '패스트트랙',     path: 'pages/fasttrack.html' },
  { id: 'etr',          num: '08', label: 'ETR',         path: 'pages/etr.html' },
  { id: 'poc-sheets',   num: '09', label: '🧪 PoC Sheets', path: 'pages/poc-sheets.html' },
];

/**
 * 현재 페이지에서 사이트 루트까지의 상대경로 prefix 계산.
 *   index.html → ''
 *   pages/roadmap.html → '../'
 */
function rootPrefix() {
  // pathname 의 마지막 세그먼트가 파일이면 디렉터리 깊이 = -1
  const path = location.pathname.replace(/index\.html?$/, '');
  // GitHub Pages 의 base path 도 포함될 수 있으므로 segments 갯수만 본다
  const segs = path.split('/').filter(Boolean);
  // 마지막 세그먼트가 .html 이면 파일 — 깊이에서 제외
  if (segs.length && segs[segs.length - 1].endsWith('.html')) segs.pop();
  // GitHub Pages의 repo prefix(/sd-org-site)는 깊이 1이지만 그건 root 까지의 깊이고,
  // 우리는 "사이트 root 기준" 으로 계산해야 한다.
  // → 단순화: <html> 의 data-depth 속성을 직접 명시하게 함.
  const depth = parseInt(document.documentElement.dataset.depth || '0', 10);
  return '../'.repeat(depth);
}

/**
 * 사이드바 렌더. <body> 첫 자식으로 <div class="app"> 골격을 보장.
 * @param {{
 *   active: string,         // PAGES 의 id
 *   counts?: Record<string, { value: string|number, kind?: 'alert'|'accent' }>,
 *   meta?: { lastSync?: string, nextSync?: string }
 * }} opts
 */
export function renderSidebar(opts = {}) {
  const { active, counts = {}, meta = {} } = opts;
  const root = rootPrefix();

  // 사이드바 HTML
  const links = PAGES.map(p => {
    const isActive = p.id === active;
    const href = root + p.path + (p.path === '' ? 'index.html' : '');
    const badge = counts[p.id];
    const badgeHtml = badge
      ? `<span class="badge ${badge.kind || ''}">${escapeHtml(badge.value)}</span>`
      : `<span class="num">${p.num}</span>`;
    return `
      <a class="sb-link ${isActive ? 'active' : ''}" href="${href}" data-page="${p.id}" accesskey="${p.num.replace(/^0/, '')}">
        <span class="grow">${escapeHtml(p.label)}</span>
        ${badgeHtml}
      </a>`;
  }).join('');

  const html = `
    <aside class="sb">
      <div class="sb-brand">
        <span class="sb-mark"></span>
        <span class="sb-brand-name">S&amp;D Console</span>
        <button type="button" class="sb-toggle" aria-label="사이드바 접기/펼치기" data-sb-toggle title="사이드바 접기/펼치기 ([)">◀</button>
      </div>
      <p class="sb-org">MSS Search &amp; Discovery</p>

      <div class="sb-section">PAGES</div>
      <nav class="sb-list" aria-label="사이트 내비게이션">${links}</nav>

      <div class="sb-foot">
        <p><span class="muted">last sync</span><br>
           <span class="num" data-meta-last-sync>${meta.lastSync ? fmtDateTime(meta.lastSync) : '—'}</span></p>
        <p><span class="muted">next sync</span><br>
           <span class="num" data-meta-next-sync>${meta.nextSync ? fmtDateTime(meta.nextSync) : '—'}</span></p>
        <p>
          <a class="sb-sync-link"
             href="https://github.com/woojin-ahn-mss/docs/actions/workflows/jira-sync.yml"
             target="_blank" rel="noopener noreferrer"
             title="GitHub Actions 에서 'Run workflow' 클릭하면 수동 sync 실행">↻ 수동 sync</a>
        </p>
        <div class="sb-theme" role="group" aria-label="테마">
          <button type="button" data-theme-set="dark">Dark</button>
          <button type="button" data-theme-set="light">Light</button>
        </div>
      </div>
    </aside>
  `;

  // 마운트: <div class="app"> 안의 첫 위치
  let app = document.querySelector('.app');
  if (!app) {
    app = document.createElement('div');
    app.className = 'app';
    // body 의 기존 콘텐츠를 <main class="main"> 으로 감싸기
    const main = document.createElement('main');
    main.className = 'main';
    while (document.body.firstChild) main.appendChild(document.body.firstChild);
    app.appendChild(main);
    document.body.appendChild(app);
  }
  // 기존 사이드바 있으면 교체
  const existing = app.querySelector('.sb');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  const sb = wrapper.firstElementChild;
  if (existing) existing.replaceWith(sb);
  else app.prepend(sb);

  // 키보드 단축키 1~8 (accesskey 도 있지만 모든 브라우저가 같지 않음)
  bindShortcuts();
  bindThemeButtons(sb);
  bindSidebarToggle(app, sb);
}

/** 사이드바 접기/펼치기. localStorage 에 상태 저장. 키보드 단축키 '[' */
function bindSidebarToggle(app, sb) {
  const store = scoped(SIDEBAR_STATE_KEY);
  // 초기 상태 적용
  if (store.get(false)) {
    app.dataset.sidebar = 'collapsed';
    updateToggleIcon(sb, true);
  }
  const btn = sb.querySelector('[data-sb-toggle]');
  if (btn) {
    btn.addEventListener('click', () => toggleSidebar(app, sb));
  }
  // '[' 키로 토글 — 입력 중에는 무시
  if (!sidebarShortcutBound) {
    sidebarShortcutBound = true;
    document.addEventListener('keydown', e => {
      if (e.key !== '[' && e.key !== ']') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      const currentApp = document.querySelector('.app');
      const currentSb = document.querySelector('.sb');
      if (currentApp && currentSb) toggleSidebar(currentApp, currentSb);
    });
  }
}

let sidebarShortcutBound = false;

function toggleSidebar(app, sb) {
  const collapsed = app.dataset.sidebar !== 'collapsed';
  if (collapsed) app.dataset.sidebar = 'collapsed';
  else delete app.dataset.sidebar;
  scoped(SIDEBAR_STATE_KEY).set(collapsed);
  updateToggleIcon(sb, collapsed);
}

function updateToggleIcon(sb, collapsed) {
  const btn = sb.querySelector('[data-sb-toggle]');
  if (btn) btn.textContent = collapsed ? '▶' : '◀';
}


/**
 * meta.json 로드 후 사이드바 last-sync / next-sync 갱신.
 * 페이지에서 사이드바 렌더 직후 호출.
 */
export async function loadAndApplyMeta(rootRel = '') {
  try {
    const url = `${rootRel}data/meta.json`;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    const meta = await res.json();
    applyMeta(meta);
    return meta;
  } catch (_) {
    return null;
  }
}

export function applyMeta(meta) {
  if (!meta) return;
  const last = document.querySelector('[data-meta-last-sync]');
  const next = document.querySelector('[data-meta-next-sync]');
  if (last && meta.lastSync) last.textContent = fmtDateTime(meta.lastSync);
  if (next && meta.nextSync) next.textContent = fmtDateTime(meta.nextSync);
}

let shortcutsBound = false;
function bindShortcuts() {
  if (shortcutsBound) return;
  shortcutsBound = true;
  document.addEventListener('keydown', e => {
    // 입력 중에는 무시
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= 8) {
      const target = document.querySelector(`.sb-link[data-page="${PAGES[n - 1].id}"]`);
      if (target) { e.preventDefault(); target.click(); }
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
