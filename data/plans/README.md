# data/plans — 키워드 카드 (로드맵 관리)

`pages/roadmap-plan.html` 의 **수동 입력 카드** 데이터. Jira 카드는 `data/jira/initiatives.json` 에서 자동 생성.

## 파일 위치

`data/plans/roadmap-{year}.json` (예: `roadmap-2026.json`).

페이지가 연도 셀렉터에서 해당 파일을 fetch. **파일 없거나 비어 있으면 키워드 카드 없음** 상태.

## 운영 워크플로

1. 페이지에서 "+ 키워드 카드" 로 카드 추가 → **localStorage 에 즉시 저장** (네임스페이스 `sd.roadmapPlan.cards.{year}`).
2. 카드 드래그앤드롭으로 분기 이동 → 키워드 카드는 localStorage 자동 저장, Jira 카드는 토스트로 "Jira 의 Year/Quarter 필드도 업데이트" 안내.
3. 작업이 끝나면 "↓ JSON Export" 로 `roadmap-{year}.json` 다운로드 → repo `data/plans/` 에 commit → 영구화.

**우선순위 규칙 (중요):**
- **localStorage 가 항상 SoT (Source of Truth)**. 파일은 *첫 로드 시드* + *백업/공유본*.
- 파일이 갱신돼도 LS 에 데이터가 있으면 페이지는 LS 만 사용 (다른 팀원이 commit 한 카드를 못 봄).
- 새 파일 반영하려면: 브라우저에서 LS 키 `sd.roadmapPlan.cards.{year}` 를 직접 삭제 후 새로고침. (Reload-from-file 버튼 follow-up)
- 다중 브라우저/기기 작업 시 LS 가 분리되므로 Export → commit 으로 동기화 필수.

## 스키마

```json
{
  "schemaVersion": 1,
  "year": 2026,
  "cards": [
    {
      "id": "kw-1716334800",
      "type": "keyword",
      "year": 2026,
      "quarter": "Q3",
      "title": "추천 결과 다양성 v3",
      "mainSubject": "01.추천",
      "priority": "P1",
      "projectKey": "CBP",
      "notes": "v2 후속 — 다양성-정확성 트레이드오프 자동 조정",
      "createdAt": "2026-05-22T15:00:00+09:00",
      "updatedAt": "2026-05-22T15:00:00+09:00"
    }
  ]
}
```

- `schemaVersion` — 현재 `1`. 필드가 추가/변경되면 증가. Export 시 자동으로 들어감.

### 필드

- `id` — 페이지가 자동 생성 (`kw-` + timestamp). 직접 입력 시 unique 보장.
- `type` — 항상 `"keyword"`. Jira 카드(`"jira"`)는 자동 생성되며 이 파일에는 저장 안 됨.
- `year` — 4자리 정수. 페이지 연도 셀렉터와 일치해야 노출.
- `quarter` — `"Q1" | "Q2" | "Q3" | "Q4" | null`. null 이면 좌측 "미배치" 풀에 표시.
- `title` — 한 줄 헤드라인 (50자 권장).
- `mainSubject` *(선택)* — 디자인 시스템의 메인주제 라벨 (`"01.추천"`/`"02.검색"`/`"03.랭킹"`/`"04.개인화"`/`"05.디스커버리"` 등). 카드 좌측 색 막대에 매핑.
- `priority` *(선택)* — `"P0" | "P1" | "P2" | "P3"`.
- `projectKey` *(선택)* — Jira project key (`"CBP"` 등). 형식 `^[A-Z][A-Z0-9]{1,11}$` (대문자 시작 영숫자 2~12자). 잘못된 값은 저장 거부.
- `notes` *(선택)* — 보조 메모, 펼침 영역.
- `createdAt`, `updatedAt` — ISO 8601 with offset.

## 주의

- 위 "운영 워크플로" 의 우선순위 규칙 재확인: **LS 가 SoT**.
- 카드 ID 는 `crypto.randomUUID()` 기반 (`kw-<uuid>`) — 다중 브라우저에서 동시 추가해도 충돌 X.
