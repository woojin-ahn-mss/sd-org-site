# data/metrics — 분기별 KPI 입력 가이드

성과 페이지(`pages/performance.html`)가 읽는 **수동 입력** 데이터입니다.
Jira sync 봇이 덮어쓰지 않으니, 분기마다 직접 갱신하세요.

## 파일 위치

`data/metrics/{YYYY-Qn}.json` (예: `2026-Q2.json`).

성과 페이지가 분기 탭에서 해당 파일을 fetch 합니다. **파일 없으면 빈 상태 표시**(launches는 `completed-launches.json` fallback).

## 스키마

```json
{
  "quarter": "2026-Q2",
  "kpis": [
    { "name": "검색 CTR",     "value": 12.4, "unit": "%", "deltaPrev": 0.8,  "spark": [11.0, 11.5, 12.0, 12.4] },
    { "name": "추천 클릭률",   "value": 8.1,  "unit": "%", "deltaPrev": -0.2, "spark": [8.4, 8.2, 8.0, 8.1] },
    { "name": "GMV 기여",     "value": 12.5, "unit": "억", "deltaPrev": 2.1,  "spark": [8, 10, 11, 12.5] }
  ],
  "launches": [
    {
      "ticketKey": "CBP-1234",
      "title": "추천 다양성 v2 출시",
      "launchedAt": "2026-05-15",
      "description": "유저별 카테고리 분포 균형 보정으로 추천 클릭 편중 완화.",
      "impactSummary": "추천 CTR +0.8%p"
    }
  ]
}
```

### 필드

- `quarter` — `"YYYY-Qn"` 형식. 파일명과 일치.
- `kpis[].name` — 한글, 짧게 (예: "검색 CTR")
- `kpis[].value` — 숫자
- `kpis[].unit` — `"%"`, `"억"`, `"건"`, `"ms"` 등 자유
- `kpis[].deltaPrev` — 전 분기 대비 **변화량 (절대값)**, 음수 가능. 0이거나 누락이면 `—` 표시
  - 단위 매핑: `unit: "%"` → 카드의 delta는 `+0.8%p` 식 (퍼센트 포인트)
  - `unit: "건"/"억"/"ms"` 등 → 같은 단위 그대로 (`+2.1억`, `+12건`)
  - 예: `{"value": 12.4, "unit": "%", "deltaPrev": 0.8}` 는 "전 분기 11.6% → 이번 분기 12.4% (+0.8%p)" 를 의미
- `kpis[].spark` *(선택)* — 6~12개 숫자 배열. 분기 내 추세 스파크라인
- `launches[]` — 분기 주요 출시 큐레이션 (3~5개 권장).
  - `ticketKey` — Jira 키 (`CBP-1234`). 자동 deeplink
  - `title` — 보고용 헤드라인 (자주 Jira summary와 다름)
  - `launchedAt` — `"YYYY-MM-DD"` (KST)
  - `description` — 1~2문장 설명
  - `impactSummary` — 한 줄 임팩트 ("검색 CTR +0.8%p", "GMV +12억" 등)

## 운영 팁

- KPI 4개를 권장 (성과 페이지 카드 4개에 맞춤). 첫 카드는 자동으로 **"출시 과제 수"** (jira completed-launches 분기 카운트). KPI 배열에는 나머지 3개만 두면 됨.
- launches는 메시지가 강한 3~5개만 큐레이션. 전체 출시 목록은 `data/jira/completed-launches.json` 으로 자동 집계됨.
- 분기 종료 후 보고가 끝나면 다음 분기 파일로 복사해서 시작.
