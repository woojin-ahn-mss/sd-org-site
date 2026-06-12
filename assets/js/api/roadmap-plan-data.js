/* =========================================================
   roadmap-plan-data.js — Supabase 가 SoT 인 roadmap-plan 데이터 레이어
   PRD docs/supabase-migration §4, §6.3 — Objective → Subject(주제) → Card(키워드)
   Jira 티켓의 subject 매핑(ticket_subjects) + 분기 override(ticket_overrides).

   Sheets 판(_rowNum/헤더 기반)을 대체. **export 시그니처는 그대로 보존**하여
   페이지(roadmap-plan.js) 변경을 최소화한다.

   호출 패턴:
     await auth.ensureSignedIn();
     await verifySchema();             // 연결 확인 (Sheets 헤더 검증을 대체)
     const data = await loadAll(2026); // { objectives, subjects, cards, overrides }
     await createObjective({ name: '검색 품질', color: 'accent' });

   id:
     - Postgres uuid PK (gen_random_uuid). 클라이언트는 생성하지 않고 insert 후 반환받음.
   컬럼명 매핑:
     - DB(snake_case) ↔ 페이지(camelCase): start_month↔startMonth, main_subject↔mainSubject, project_key↔projectKey.
   ========================================================= */

import { supabase, unwrap } from './supabase.js';

/* ─── 호환용: 시트 시절 명칭/에러 (페이지가 import) ───────── */
export class SchemaMismatchError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'SchemaMismatchError';
    this.detail = detail;
  }
}

/** 연결/스키마 확인. Sheets 의 헤더 검증을 대체 — 테이블 read 가능 여부만 확인. */
export async function verifySchema() {
  try {
    unwrap(await supabase.from('objectives').select('id').limit(1));
    return true;
  } catch (e) {
    throw new SchemaMismatchError('Supabase 스키마/연결 확인 실패: ' + (e.message || e), { cause: e });
  }
}

/* ─── subject_id 멀티값 헬퍼 (pure, 페이지·테스트 사용) ──────
   UI 입력은 단일/콤마구분/배열 모두 허용. 저장은 ticket_subjects 행으로. */
export function parseSubjectIds(v) {
  const raw = Array.isArray(v) ? v : (v == null ? [] : String(v).split(','));
  const out = [];
  for (const s of raw) {
    const id = String(s).trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
export function joinSubjectIds(v) {
  return parseSubjectIds(v).join(',');
}

/* ─── 컬럼명 매핑 (DB snake ↔ app camel) ──────────────────── */
function mapKeys(obj, mapping) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[mapping[k] || k] = v;
  return out;
}
const SUBJ_S2C = { start_month: 'startMonth', end_month: 'endMonth' };
const SUBJ_C2S = { startMonth: 'start_month', endMonth: 'end_month' };
const CARD_S2C = { main_subject: 'mainSubject', project_key: 'projectKey' };
const CARD_C2S = { mainSubject: 'main_subject', projectKey: 'project_key' };

const subjFromDb = (r) => mapKeys(r, SUBJ_S2C);
const cardFromDb = (r) => mapKeys(r, CARD_S2C);

/* insert/update 시 테이블에 실제 존재하는 컬럼만 추려 보냄 (불필요 키·_rowNum 차단). */
const OBJ_COLS  = ['name', 'color', 'description', 'display_order'];
const SUBJ_COLS = ['objective_id', 'name', 'description', 'start_month', 'end_month', 'display_order'];
const CARD_COLS = ['subject_id', 'year', 'quarter', 'title', 'notes', 'main_subject', 'priority', 'project_key'];

function pick(obj, cols) {
  const out = {};
  for (const c of cols) if (obj[c] !== undefined) out[c] = obj[c];
  return out;
}

/* ─── 정렬/정규화 (pure) ──────────────────────────────────── */
function orderVal(obj) {
  const n = parseInt(obj.display_order, 10);
  return Number.isFinite(n) ? n : 9999;
}
function normalizeYear(v) {
  if (typeof v === 'number') return v;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/* ─── 전체 read ───────────────────────────────────────────── */

/**
 * 5 테이블(objectives, subjects, cards, ticket_overrides, ticket_subjects) 병렬 read →
 * 페이지가 기대하던 형태로 조립. `overrides` 는 ticket_overrides(quarter) + ticket_subjects(subject_id)
 * 를 (jira_key) 기준으로 합쳐 콤마구분 subject_id 를 가진 행으로 재구성 (Sheets 시절 shape 보존).
 *
 * @param {number} year
 * @returns {Promise<{ objectives:Object[], subjects:Object[], cards:Object[], overrides:Object[] }>}
 */
export async function loadAll(year) {
  const y = normalizeYear(year);
  // 진짜 병렬: 쿼리 promise 들을 먼저 만들고 Promise.all 후 unwrap.
  const res = await Promise.all([
    supabase.from('objectives').select('*'),
    supabase.from('subjects').select('*'),
    supabase.from('cards').select('*').eq('year', y),
    supabase.from('ticket_overrides').select('*').eq('year', y),
    supabase.from('ticket_subjects').select('*').eq('year', y),
  ]);
  const [objs, subs, cards, ovs, tss] = res.map(unwrap);

  const objectives = objs.slice().sort((a, b) => orderVal(a) - orderVal(b));
  const subjects = subs.map(subjFromDb).sort((a, b) => orderVal(a) - orderVal(b));
  const cardList = cards.map(cardFromDb);

  // overrides 재구성: jira_key → { jira_key, year, quarter, subject_id(콤마) }
  const map = new Map();
  for (const o of ovs) {
    if (!o.quarter) continue;  // quarter 없는 override 행은 정보가 없음 (RPC 도 생성 안 함) — skip
    map.set(o.jira_key, { jira_key: o.jira_key, year: y, quarter: o.quarter, subject_id: '' });
  }
  for (const t of tss) {
    const e = map.get(t.jira_key) || { jira_key: t.jira_key, year: y, quarter: '', subject_id: '' };
    const ids = e.subject_id ? e.subject_id.split(',') : [];
    ids.push(t.subject_id);
    e.subject_id = ids.join(',');
    map.set(t.jira_key, e);
  }
  const overrides = [...map.values()];

  return { objectives, subjects, cards: cardList, overrides };
}

/* ─── Objective CRUD ─────────────────────────────────────── */

export async function createObjective(input) {
  const row = pick({
    name: input.name || '',
    color: input.color || 'accent',
    description: input.description || '',
    display_order: Number.isFinite(input.display_order) ? input.display_order : 0,
  }, OBJ_COLS);
  return unwrap(await supabase.from('objectives').insert(row).select().single());
}

export async function updateObjective(obj, patch = {}) {
  const row = pick(patch, OBJ_COLS);
  unwrap(await supabase.from('objectives').update(row).eq('id', obj.id));
  return { ...obj, ...patch };
}

/** 삭제 가능 여부 client 사전검증 (FK restrict 가 최종 차단). */
export function validateObjectiveDelete(id, subjects) {
  if (!Array.isArray(subjects)) return { ok: true };
  const using = subjects.filter(s => s.objective_id === id);
  if (using.length) {
    return { ok: false, reason: `이 Objective 에 속한 주제(${using.length}개)가 있습니다. 먼저 주제를 이동하거나 삭제하세요.`, using };
  }
  return { ok: true };
}

export async function deleteObjective(obj) {
  unwrap(await supabase.from('objectives').delete().eq('id', obj.id));
}

/* ─── Subject CRUD ───────────────────────────────────────── */

export async function createSubject(input) {
  const db = mapKeys(input, SUBJ_C2S);
  const row = pick({
    objective_id: db.objective_id || null,
    name: db.name || '',
    description: db.description || '',
    start_month: db.start_month || null,
    end_month: db.end_month || null,
    display_order: Number.isFinite(db.display_order) ? db.display_order : 0,
  }, SUBJ_COLS);
  const created = unwrap(await supabase.from('subjects').insert(row).select().single());
  return subjFromDb(created);
}

export async function updateSubject(subj, patch = {}) {
  const row = pick(mapKeys(patch, SUBJ_C2S), SUBJ_COLS);
  unwrap(await supabase.from('subjects').update(row).eq('id', subj.id));
  return { ...subj, ...patch };
}

/** cards/overrides 가 가리키는 subject 면 삭제 차단.
 *  cards 는 DB FK(restrict)도 차단하지만, ticket 매핑은 FK 가 cascade 라 client 에서만 막는다(매핑 유실 방지).
 *  jiraTickets(라이브 풀)가 주어지면, 풀에 더 이상 존재하지 않는 티켓의 고아 매핑은 차단 대상에서 제외한다
 *  — 카드의 "티켓 N" 표시와 동일 기준으로 맞춰, 표시 0인데 삭제만 막히는 불일치 방지. */
export function validateSubjectDelete(id, cards, overrides, jiraTickets) {
  const cardUsing = (cards || []).filter(c => c.subject_id === id);
  const liveKeys = Array.isArray(jiraTickets) ? new Set(jiraTickets.map(t => String(t.key))) : null;
  const ovUsing = (overrides || []).filter(o =>
    parseSubjectIds(o.subject_id).includes(id) &&
    (!liveKeys || liveKeys.has(String(o.jira_key))));
  if (cardUsing.length || ovUsing.length) {
    return { ok: false, reason: `이 주제에 속한 카드(${cardUsing.length}) / 티켓 매핑(${ovUsing.length})이 있습니다. 먼저 정리하세요.`, cardUsing, ovUsing };
  }
  return { ok: true };
}

export async function deleteSubject(subj) {
  unwrap(await supabase.from('subjects').delete().eq('id', subj.id));
}

/* ─── Card CRUD (키워드 카드) ───────────────────────────── */

export async function createCard(input) {
  const db = mapKeys(input, CARD_C2S);
  const row = pick({
    subject_id: db.subject_id || null,
    year: normalizeYear(db.year) ?? new Date().getFullYear(),
    quarter: db.quarter || '',
    title: db.title || '',
    notes: db.notes || '',
    main_subject: db.main_subject || '',
    priority: db.priority || '',
    project_key: db.project_key || '',
  }, CARD_COLS);
  const created = unwrap(await supabase.from('cards').insert(row).select().single());
  return cardFromDb(created);
}

export async function updateCard(card, patch = {}) {
  const row = pick(mapKeys(patch, CARD_C2S), CARD_COLS);
  unwrap(await supabase.from('cards').update(row).eq('id', card.id));
  return { ...card, ...patch };
}

export async function deleteCard(card) {
  unwrap(await supabase.from('cards').delete().eq('id', card.id));
}

/* ─── Jira 티켓 매핑 (분기 override + 주제) — RPC 원자 처리 ── */

/**
 * jira_key 의 분기 override + 주제 매핑을 한 번에 갱신 (set_ticket_mapping RPC).
 * @param {string} jiraKey
 * @param {{year:number, subject_id?:string|string[], quarter?:string}} patch
 * @param {Object[]} [_currentOverrides] (호환용, 미사용 — 서버 upsert)
 * @returns {Promise<{jira_key, year, subject_id, quarter}|null>}
 */
export async function setTicketMapping(jiraKey, patch, _currentOverrides) {
  const year = normalizeYear(patch.year) ?? new Date().getFullYear();
  const subjectIds = parseSubjectIds(patch.subject_id);
  const quarter = patch.quarter || '';
  unwrap(await supabase.rpc('set_ticket_mapping', {
    p_jira_key: jiraKey,
    p_year: year,
    p_quarter: quarter,
    p_subject_ids: subjectIds,
  }));
  if (!subjectIds.length && !quarter) return null;
  return { jira_key: jiraKey, year, subject_id: subjectIds.join(','), quarter };
}

export async function clearTicketOverride(jiraKey, year = new Date().getFullYear()) {
  return setTicketMapping(jiraKey, { year, subject_id: '', quarter: '' });
}

/* ─── Jira 티켓에 override 결합 (pure, 테스트 대상) ─────── */

/**
 * Jira 티켓 배열에 overrides 의 subject_id/quarter 를 덮어씌움.
 * @param {Object[]} jiraTickets
 * @param {Object[]} overrides loadAll 의 overrides (year 필터 적용됨)
 * @param {number} year
 */
export function joinTicketsWithOverrides(jiraTickets, overrides, year) {
  if (!Array.isArray(jiraTickets)) return [];
  const idx = new Map();
  for (const o of (overrides || [])) {
    if (o.jira_key) idx.set(String(o.jira_key), o);
  }
  return jiraTickets.map(t => {
    const o = idx.get(String(t.key));
    const baseQuarter = parseQuarterFromYearQuarter(t.yearQuarter, year);
    if (!o) {
      return { ...t, subject_id: '', subjectIds: [], quarter: baseQuarter, baseQuarter, _override: false };
    }
    const subjectIds = parseSubjectIds(o.subject_id);
    return {
      ...t,
      subject_id: subjectIds.join(','),
      subjectIds,
      quarter: o.quarter || baseQuarter,
      baseQuarter,
      _override: !!(subjectIds.length || (o.quarter && o.quarter !== baseQuarter)),
    };
  });
}

/** "2026-Q3" → 해당 연도면 'Q3', 아니면 ''. */
function parseQuarterFromYearQuarter(yq, year) {
  if (typeof yq !== 'string') return '';
  const m = /^(\d{4})-(Q[1-4])$/.exec(yq.trim());
  if (!m) return '';
  if (parseInt(m[1], 10) !== year) return '';
  return m[2];
}

/* ─── test export ─────────────────────────────────────────── */
export const _internal = {
  orderVal, normalizeYear, parseQuarterFromYearQuarter,
  parseSubjectIds, joinSubjectIds,
  mapKeys, pick, subjFromDb, cardFromDb,
  SUBJ_C2S, SUBJ_S2C, CARD_C2S, CARD_S2C,
};
