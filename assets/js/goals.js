/* =========================================================
   goals.js — Goal (목표) 도메인 모델 + 저장소 헬퍼
   - 목표: 자유 텍스트 제목 + 월 범위 (startMonth/endMonth) + 카드 매핑
   - 카드-목표 관계: 1:N (카드 하나에 목표 최대 1개)
   - localStorage SoT, 키워드 카드와 동일한 패턴
     · roadmapPlan.goals.{year}      = [Goal, ...]
     · roadmapPlan.cardGoals.{year}  = { cardId: goalId, ... }  // jira·키워드 통합
   ========================================================= */

import { scoped } from './storage.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** @typedef {Object} Goal
 *  @property {string} id
 *  @property {string} title
 *  @property {string} description
 *  @property {string} startMonth  'YYYY-MM'
 *  @property {string} endMonth    'YYYY-MM' (inclusive)
 *  @property {string} createdAt
 *  @property {string} updatedAt
 */

export function newGoalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'goal-' + crypto.randomUUID();
  }
  return 'goal-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function isValidMonth(s) {
  return typeof s === 'string' && MONTH_RE.test(s);
}

/** startMonth <= endMonth 보장. 둘 다 valid 라야 true. */
export function isValidPeriod(start, end) {
  return isValidMonth(start) && isValidMonth(end) && start <= end;
}

/** 사용 가능한 목표 색상 팔레트 — 10개, 디자인 시스템 토큰 재사용 (새 색 정의 X). */
export const GOAL_COLORS = [
  { key: 'accent',        label: 'Gold',         var: '--accent' },
  { key: 'accent-strong', label: 'Bright Gold',  var: '--accent-strong' },
  { key: 'success',       label: 'Green',        var: '--success' },
  { key: 'info',          label: 'Blue',         var: '--info' },
  { key: 'alert',         label: 'Red',          var: '--alert' },
  { key: 'srch',          label: 'Cream',        var: '--subj-srch' },
  { key: 'rank',          label: 'Orange',       var: '--subj-rank' },
  { key: 'pers',          label: 'Tan',          var: '--subj-pers' },
  { key: 'disc',          label: 'Gray',         var: '--subj-disc' },
  { key: 'misc',          label: 'Sage',         var: '--subj-misc' },
];

export function normalizeGoal(g) {
  const now = new Date().toISOString();
  const colorKey = typeof g.color === 'string' && GOAL_COLORS.some(c => c.key === g.color)
    ? g.color : 'accent';
  return {
    id: g.id || newGoalId(),
    title: g.title || '',
    description: g.description || '',
    startMonth: g.startMonth || '',
    endMonth: g.endMonth || '',
    color: colorKey,                                       // 막대/카드 색
    order: typeof g.order === 'number' ? g.order : null,  // 사용자 D&D 순서
    createdAt: g.createdAt || now,
    updatedAt: g.updatedAt || now,
  };
}

/** 'YYYY-MM' → Date(시작일 1일). */
export function monthToDate(month) {
  if (!isValidMonth(month)) return null;
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

/** 'YYYY-MM' → 다음달 1일 (exclusive end). */
export function monthToEndDate(month) {
  if (!isValidMonth(month)) return null;
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 1);
}

/**
 * 목표를 간트 축 위의 가로 위치로 변환.
 * @returns {{leftFrac:number, widthFrac:number}|null} 축 범위와 겹치지 않으면 null.
 */
export function goalToAxisBar(goal, axisStart, axisEnd) {
  const s = monthToDate(goal.startMonth);
  const e = monthToEndDate(goal.endMonth);
  if (!s || !e) return null;
  const totalMs = axisEnd - axisStart;
  if (e <= axisStart || s >= axisEnd) return null;
  const sClamped = Math.max(s, axisStart);
  const eClamped = Math.min(e, axisEnd);
  return {
    leftFrac: (sClamped - axisStart) / totalMs,
    widthFrac: (eClamped - sClamped) / totalMs,
  };
}

/** 'YYYY-MM' 라벨로 사람이 읽기 좋게 (예: 2026.05). */
export function fmtMonth(month) {
  if (!isValidMonth(month)) return '—';
  return month.replace('-', '.');
}

/** 기간 라벨 (예: '2026.05 ~ 2026.09'). */
export function fmtPeriod(g) {
  return `${fmtMonth(g.startMonth)} ~ ${fmtMonth(g.endMonth)}`;
}

/* ----- 저장소 ----- */

/** scoped store 페어 — 한 년도 분량의 goals + cardGoals 묶음. */
export function goalsStoreFor(year) {
  return {
    goals: scoped(`roadmapPlan.goals.${year}`),
    cardGoals: scoped(`roadmapPlan.cardGoals.${year}`),
  };
}

/** 현재 LS 의 goals[] 와 cardGoals{} 동시 로드. 없으면 [] / {}. */
export function loadAll(year) {
  const { goals, cardGoals } = goalsStoreFor(year);
  return {
    goals: (goals.get([]) || []).map(normalizeGoal),
    cardGoals: cardGoals.get({}) || {},
  };
}

/** 정렬:
 *  1) order 필드가 있으면 그것 우선 (사용자 D&D 순서)
 *  2) order 없는 항목은 startMonth asc, endMonth asc, title asc 로 뒤에 붙음.
 */
export function sortGoals(goals) {
  return [...goals].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Infinity;
    const bo = typeof b.order === 'number' ? b.order : Infinity;
    if (ao !== bo) return ao - bo;
    if (a.startMonth !== b.startMonth) return (a.startMonth || '').localeCompare(b.startMonth || '');
    if (a.endMonth !== b.endMonth) return (a.endMonth || '').localeCompare(b.endMonth || '');
    return (a.title || '').localeCompare(b.title || '', 'ko');
  });
}

/** goals 배열의 현재 순서대로 order 필드를 0..N-1 로 재할당 (mutate). */
export function reassignOrder(goals) {
  goals.forEach((g, i) => { g.order = i; });
  return goals;
}

/** 현재 연도 (테스트 용으로 분리). */
export function currentYear(now = new Date()) {
  return now.getFullYear();
}

/* test export */
export const _internal = {
  MONTH_RE,
};
