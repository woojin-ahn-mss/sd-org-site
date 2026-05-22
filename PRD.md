# Search & Discovery 조직 사이트 — PRD

| 항목 | 값 |
|---|---|
| 작성일 | 2026-05-22 |
| 버전 | v0.2 (풀스펙) |
| 작성자 | 우진 (Search & Discovery 실장) |
| 배포 | https://woojin-ahn-mss.github.io/sd-org-site/ (public) |
| Repo | https://github.com/woojin-ahn-mss/sd-org-site |

---

## 1. Overview

### 목적
Search & Discovery 실의 **로드맵 관리 · 일감 관리 · 리소스 관리 · 상위 보고** 를 한 곳에서 수행하는 운영 사이트.

### 청중
- **1차**: 실장(본인) — 매일 운영 도구
- **2차**: 경영진 — 보고 시점 공유

### 핵심 가치
1. Jira에 흩어진 정보를 한 화면에서 한눈에
2. 보고 자료를 매번 새로 그리는 부담 제거 (사이트가 항상 최신)
3. 1년치 로드맵 기획을 시각적으로 관리하는 작업대 제공
4. 외부 요청·임원 요청 추적을 빠짐없이

### 범위 (8 페이지 모두 구현)

| # | 페이지 | 한 줄 설명 |
|---|---|---|
| 1 | 🏠 홈 | 오늘/이번주 핵심 + 사이트 진입점 |
| 2 | 📋 로드맵 (간트) | 메인주제별 Initiative 타임라인 |
| 3 | 🚀 진행 현황 | 상태 분포·흐름·지연·리스크 |
| 4 | 👥 리소스 | 프로젝트·담당자별 부하 |
| 5 | 📊 성과 | 분기별 론치 + 임팩트 카드 (보고용) |
| 6 | 🛠 로드맵 관리 | 1년 4분기 보드 (Jira + 키워드) |
| 7 | ⚡ 패스트트랙 | ETR + `one` 레이블 (임원 요청 추적) |
| 8 | 📥 ETR | 외부 요청 / 본인 담당 |

---

## 2. 기술 & 호스팅

### 호스팅
- **GitHub Pages (Public)** — `woojin-ahn-mss/sd-org-site` repo, main 브랜치 / 루트
- URL: https://woojin-ahn-mss.github.io/sd-org-site/
- 검색엔진 크롤링 차단(`<meta name="robots" content="noindex">` + `robots.txt`)

### 데이터 동기화
- **GitHub Actions** 로 **매일 06:00 KST** Jira API 호출 → JSON 갱신 → 자동 commit
- Jira PAT 는 **GitHub Secrets** 에 저장
- 모든 페이지 상단에 "마지막 동기화: YYYY-MM-DD HH:mm" 표시

### 데이터 저장
- **JSON in repo** (도메인별 파일 분리, 전체 교체 전략 — 머지 없음)
- localStorage 는 **개인 환경설정(필터·컬럼 토글)만**

### 폴더 구조

```
sd-org-site/
├── index.html                    # 홈
├── pages/
│   ├── roadmap.html              # 로드맵 (간트)
│   ├── progress.html             # 진행 현황
│   ├── resource.html             # 리소스
│   ├── performance.html          # 성과
│   ├── roadmap-plan.html         # 로드맵 관리
│   ├── fasttrack.html            # 패스트트랙
│   └── etr.html                  # ETR
├── assets/
│   ├── css/main.css              # 공통 다크 테마 + 컴포넌트
│   ├── js/
│   │   ├── nav.js                # 상단 네비게이션
│   │   ├── filters.js            # 공통 필터 컴포넌트
│   │   ├── jira-link.js          # 키 → Jira deeplink
│   │   ├── gantt.js              # 간트 렌더링
│   │   ├── kanban.js             # 로드맵 관리 보드
│   │   └── charts.js             # 도넛/바/스택 차트
├── data/
│   ├── jira/
│   │   ├── initiatives.json      # 자동 — 로드맵/홈/리소스/진행현황
│   │   ├── all-tickets.json      # 자동 — 리소스/진행현황/홈
│   │   ├── etr-fasttrack.json    # 자동 — 패스트트랙
│   │   ├── etr-assigned.json     # 자동 — ETR
│   │   └── completed-launches.json  # 자동 — 성과
│   ├── plans/
│   │   └── roadmap-2026.json     # 수동/Export — 로드맵 관리
│   ├── metrics/
│   │   └── 2026-Q2.json          # 수동 — 성과 페이지 지표
│   └── meta.json                  # last-updated, 동기화 결과
└── .github/workflows/
    └── jira-sync.yml              # 매일 06:00 KST
```

---

## 3. 공통 디자인 규칙

### 테마 (다크 + 라이트 둘 다 지원)
- **다크 테마**: 배경 `#080808` / 텍스트 `#e8e8e8` / 카드 `#131313` / 보더 `#1f1f1f` / 액센트 `#b19eff`
- **라이트 테마**: 배경 `#fafafa` / 텍스트 `#1a1a1a` / 카드 `#ffffff` / 보더 `#e5e7eb` / 액센트 `#6d4eff`
- **토글**: 상단 네비 우측 아이콘 (☀️/🌙). localStorage에 사용자 선택 저장 (`theme=dark|light`)
- **초기값**: OS 설정 따름 (`prefers-color-scheme`) → 사용자 토글 시 그 값 우선
- **구현**: CSS custom properties (`--bg`, `--text`, ...) 로 토큰화. `[data-theme="light"]` 셀렉터로 라이트 값 오버라이드
- 모든 페이지에서 동일한 토글 위치·동작

### 색상 토큰 (테마 무관)
- 상태:
  - Backlog/대기: slate
  - In Progress/검토중: amber
  - Done/완료: green
  - Blocked/지연: red
  - 발의/대기: purple
- 우선순위: P0 빨강 / P1 주황 / P2 노랑 / P3 회색
- 각 토큰은 다크/라이트 모두에서 적절히 조정된 hex 값 매핑 (라이트 모드는 채도 낮춘 변형)

### 기타
- 폰트: Pretendard 우선, 시스템 폰트 fallback
- 상단 고정 네비: 8개 페이지 탭 + 마지막 동기화 표시 + 테마 토글 + 검색
- 모든 Jira 키는 클릭 시 새 탭으로 Jira 이동
- 카드/표 hover 시 1px 보더 색 변경

---

## 4. 페이지 상세 스펙

### 4.1 🏠 홈 — `index.html`

**목적**: 매일 들어가서 오늘/이번주 상황 파악 + 8개 페이지 진입점

#### 상단 KPI 카드 (가로 6개)
1. **이번 분기 진척률** — One 레이블 Initiative 중 완료 비율 (게이지 + 숫자)
2. **P0 처리율** — 분기 내 P0 티켓 중 Done 비율
3. **임박 마감 N건** — 다음 7일 안에 마감인 본인 담당 티켓 수
4. **확인 필요 N건** — ETR 페이지의 "확인 필요" 상태 카운트
5. **패스트트랙 진행 중** — ETR+one 중 In Progress / 전체
6. **마지막 동기화** — 시각 + 다음 동기화까지 남은 시간

#### 중단 — 오늘의 액션 위젯 (3 컬럼)
- **확인 필요 (ETR)**: 상위 5건 미리보기 → 클릭 시 ETR 페이지
- **패스트트랙 최근 업데이트**: 상위 5건 미리보기 → 패스트트랙 페이지
- **이번 주 마감**: 상위 5건 (날짜순) → 로드맵 페이지

#### 하단 — 8 페이지 카드 그리드
- 각 페이지로 가는 카드. 아이콘 + 이름 + 한 줄 설명
- 클릭 시 해당 페이지로 이동

#### 데이터 소스
- `data/jira/initiatives.json`
- `data/jira/all-tickets.json`
- `data/jira/etr-assigned.json`
- `data/jira/etr-fasttrack.json`
- `data/meta.json`

---

### 4.2 📋 로드맵 (간트) — `pages/roadmap.html`

**목적**: S&D 실 전체 Initiative 의 분기·월 단위 타임라인 한눈에

#### 데이터 소스 (JQL)
```jql
project IN (TM, MSSCXTF, PEL, CBP, PBO, TF)
AND issuetype = Initiative
AND "sub group[select list (multiple choices)]" = "MSS-P Discovery & Engagement"
```

#### 레이아웃
- 상단: 필터바 (상시 노출 4개 + 고급 메뉴 3개)
- 좌측: 행 메타 (티켓 키 / 우선순위 / 상태 / 기한 + 컬럼 토글로 추가)
- 우측: 간트 차트 (메인주제 그룹별 접기/펼치기)

#### 시간 축 (토글)
- **분기 보기**: 6분기 한 화면 (현재 분기 ±2~3)
- **월 보기**: 12개월 가로 스크롤

#### 행 그룹핑
- **메인주제** 기준 고정 ("01.추천", "02.검색" 등)
- 그룹 접기/펼치기 + 그룹 내 티켓 수 표시

#### 컬럼 (사용자가 토글, 톱니바퀴 메뉴)
| 컬럼 | 기본 | 비고 |
|---|---|---|
| 티켓 키 | ★ 항상 ON | 클릭 → Jira 새 탭 |
| 우선순위 | ON | P0~P3 배지 |
| 상태 | ON | 색상 칩 |
| 기한 | ON | YYYY-MM-DD |
| 레이블 | OFF | 다중 칩 |
| 담당자 | OFF | 아바타 + 이름 |
| 시작일 | OFF | YYYY-MM-DD |
| Year-Quarter | OFF | 예: 2026-Q2 |

#### 간트 바 렌더링
| 보기 | 기준 | 동작 |
|---|---|---|
| 분기 보기 | `cf[14521]` (Year/Quarter) | 해당 분기 셀 단일 채우기 |
| 월 보기 (시작일 O) | 시작일 ~ 기한 | 가로 span |
| 월 보기 (시작일 X) | 기한만 존재 | 기한 기준 왼쪽 14일 그라데이션 페이드 |
| 둘 다 X | — | 회색 점으로 행 끝에 표시 |

#### 필터 (상단 노출)
- 프로젝트 (다중) · 메인주제 (다중) · 레이블 (다중) · 기간

#### 필터 (고급 / 접힘)
- 상태 (다중) · 담당자 (다중) · 우선순위 (다중)

#### 인터랙션
- URL 쿼리스트링 동기화 (북마크 가능)
- 컬럼/필터 상태 localStorage 저장

---

### 4.3 🚀 진행 현황 — `pages/progress.html`

**목적**: 일감의 상태 분포·흐름·지연을 빠르게 파악, 운영 보드

#### 데이터 소스
```jql
project IN (TM, MSSCXTF, PEL, CBP, PBO, TF, SNDPRD, CMALL)
AND "sub group[select list (multiple choices)]" = "MSS-P Discovery & Engagement"
AND statusCategory != Done
```
+ 완료/론치완료는 별도 집계 (statusCategory = Done)

#### 상단 — 4 카드
1. **전체 진행 중**: 합계 + 전주 대비 증감
2. **이번 주 신규 발의**: 카운트
3. **이번 주 완료**: 카운트
4. **지연 (마감 초과)**: 카운트 + 강조 색

#### 중단 — 상태 분포 (도넛 차트 + 막대)
- 상태별 카운트: 발의 / 검토중 / In Progress / 대기 / 완료 / 반려 등
- 클릭 시 해당 상태 티켓 리스트로 드릴다운

#### 중단 — 프로젝트별 흐름 (스택 바)
- 가로축: 프로젝트 (CBP/PBO/PEL/TM/...)
- 세로축: 티켓 수
- 색상: 상태별 스택

#### 하단 — 리스크 리스트 (3 섹션)
1. **지연 티켓** — 마감 초과한 진행 중 티켓
2. **임박 마감 (7일 이내)** — 본인 담당 우선 위로
3. **장기 정체** — In Progress 상태 30일+ 유지

#### 컬럼 (리스크 리스트 공통)
키 / 요약 / 프로젝트 / 상태 / 담당자 / 기한 / 정체 일수

---

### 4.4 👥 리소스 — `pages/resource.html`

**목적**: 프로젝트별·담당자별 일감 분배 균형 파악, 과부하 / 빈 자리 조정

#### 데이터 소스
- 진행 현황과 동일 (statusCategory != Done)

#### 상단 — 프로젝트별 부하 (가로 막대)
- 프로젝트 (CBP/PBO/PEL/TM/MSSCXTF/TF/SNDPRD/CMALL)
- 진행 중 티켓 수 + 담당자 수
- 우선순위 분포 (P0/P1 비중)

#### 중단 — 담당자별 분포 (히트맵)
- 행: 담당자 (가나다순)
- 열: 프로젝트
- 셀: 진행 중 티켓 수 (색 강도)
- 빈 칸은 해당 담당자가 그 프로젝트에 일감 없음

#### 하단 — 과부하 알림 (테이블)
- 조건: 한 사람이 **5건 이상 In Progress** OR **3건 이상 P0/P1**
- 컬럼: 담당자 / 진행 중 합 / P0 / P1 / 가장 임박 마감
- 강조: 5건 = 노랑 / 8건 이상 = 빨강

#### 인터랙션
- 담당자 클릭 → 그 사람 담당 티켓 모달
- 프로젝트 클릭 → 그 프로젝트 티켓 모달

---

### 4.5 📊 성과 — `pages/performance.html`

**목적**: 분기별 출시 + 임팩트 한 화면 — 상위 보고용

#### 데이터 소스
- `data/jira/completed-launches.json` (statusCategory = Done, 최근 4분기)
- `data/metrics/2026-Q2.json` (수동 입력 지표)

#### 상단 — 분기 셀렉터
- 탭: 2025-Q3 / Q4 / 2026-Q1 / Q2 (현재)
- 선택 시 하단 콘텐츠 전환

#### 상단 — 분기 임팩트 카드 (4개)
지표별 큰 숫자 + 전 분기 대비 화살표
1. **출시 과제 수** (이번 분기 Done Initiative 수)
2. **검색 CTR** (대표 지표 1)
3. **추천 클릭률** (대표 지표 2)
4. **GMV 기여 / 매출 임팩트** (대표 지표 3)

> 지표 종류는 수동 입력 — `data/metrics/{quarter}.json` 의 스키마로 관리

#### 중단 — 분기 하이라이트 (큰 카드)
- 분기의 주요 론치 3~5개를 카드형으로 시각적으로 강조
- 각 카드: 제목 / 출시일 / 짧은 설명 / 임팩트 한 줄 / Jira 키
- 보고용 강조 톤 (그라데이션, 큰 폰트)

#### 하단 — 전체 출시 타임라인
- 가로 타임라인 (분기 4개월 X축)
- 각 출시를 점/카드로 표시
- 호버 시 상세 툴팁

#### Export
- 분기별 화면 PDF/이미지 출력 버튼 (브라우저 인쇄 + 인쇄용 스타일)

---

### 4.6 🛠 로드맵 관리 — `pages/roadmap-plan.html`

**목적**: 1년치 로드맵을 우진님이 직접 짜는 캔버스 — Jira 티켓 + 키워드 카드 혼합

#### 레이아웃
- 상단: 연도 선택 (2026 / 2027 …) + "+ 키워드 카드" 버튼 + Export 버튼
- 본문: **분기 4컬럼 보드** (Q1 / Q2 / Q3 / Q4 가로)
- 좌측 사이드바: 미배치 카드 풀 (Year/Quarter 미할당 Jira 티켓 + 신규 키워드)

#### 카드 종류

**A. Jira 티켓 카드** (실선 보더)
- 자동 수집: One 레이블 Initiative 중 `cf[14521]` 값이 해당 연도 분기인 것
- 표시: 티켓 키 + 요약 + 메인주제 칩 + 우선순위
- 편집 불가 (Jira 데이터 read-only)
- 드래그로 분기 이동은 가능하지만 Jira에 안 반영 (사용자가 손으로 업데이트)
- 이동 시 안내: "Jira의 Year/Quarter 필드도 업데이트하세요" 토스트

**B. 키워드 카드** (점선 보더)
- 사용자가 직접 추가하는 아이디어 카드
- 필드: 제목 / 메모 / 메인주제 / 우선순위 / (연결 가능) 예상 프로젝트
- localStorage 저장, "Export to JSON" 으로 `data/plans/roadmap-2026.json` 갱신용 JSON 다운로드

#### 카드 데이터 모델
```json
{
  "id": "kw-1716334800",
  "type": "keyword",
  "year": 2026,
  "quarter": "Q3",
  "title": "추천 다양성 알고리즘 v2",
  "mainSubject": "01.추천",
  "priority": "P1",
  "projectKey": "CBP",
  "notes": "최근 클릭 편중 문제 해결",
  "createdAt": "2026-05-22T15:00:00+09:00",
  "updatedAt": "2026-05-22T15:00:00+09:00"
}
```

Jira 카드는 type: "jira"이며 Jira 데이터에서 자동 생성:
```json
{
  "id": "jira-CBP-1234",
  "type": "jira",
  "year": 2026,
  "quarter": "Q3",
  "ticketKey": "CBP-1234",
  "summary": "...",
  "mainSubject": "...",
  "priority": "P0",
  "status": "..."
}
```

#### 인터랙션
- 드래그 앤 드롭으로 분기 이동
- 키워드 카드 클릭 → 인라인 편집
- Export 버튼 → `roadmap-{year}.json` 다운로드 → 사용자가 repo에 commit
- 필터: 메인주제 / 우선순위 / 프로젝트
- 색상: 메인주제별 카드 좌측 5px 색 막대

---

### 4.7 ⚡ 패스트트랙 — `pages/fasttrack.html`

**목적**: 임원 요청 (ETR + `one` 레이블) 진행 상황을 한눈에, 보고 적합

#### 데이터 소스
```jql
project = ETR AND labels = "one" ORDER BY created DESC
```
+ 각 ETR 이슈의 **연결 티켓** 별도 조회 (issue links)

#### 레이아웃
- **1행 = 1 ETR**
- 행 클릭 → 인라인 펼치기 → 연결 티켓 미니 리스트

#### 행 컬럼
| 컬럼 | 내용 |
|---|---|
| ETR 키 | 클릭 → Jira 새 탭 |
| 요청자 | Reporter (임원 이름) |
| 요약 | ETR summary |
| ETR 상태 | 자체 상태 칩 |
| 진척률 | 연결 티켓 진행 게이지 (3/5 처럼 분수 + 막대) |
| 요청일 | created |
| 마감 | duedate |

#### 펼침 영역
- 연결 티켓 미니 카드 리스트
- 각: 티켓 키 / 요약 / 상태 / 담당자 / 진행 막대
- 클릭 → Jira 새 탭

#### 상단 — 요약 카드
- 전체 패스트트랙 수
- 진행 중 / 완료 / 대기 분포
- 임원별 요청 수 (요청자 그룹핑)

#### 필터
- 상태 / 요청자 / 기간 (최근 1개월 / 3개월 / 전체)

---

### 4.8 📥 ETR — `pages/etr.html`

**목적**: 외부 조직 요청 (ETR) 중 본인 담당 추적 + "확인 필요" 즉시 식별

#### 데이터 소스
```jql
project = ETR AND assignee = currentUser() ORDER BY updated DESC
```

#### 레이아웃 (2 섹션)

**상단 — "지금 확인 필요" 강조 박스**
- 조건: `status IN ("발의", "매니저 승인 대기", "Tech 검토 대기 중")`
- 카드형 (한 줄 또는 그리드)
- 강조 색: 주황 (`#fbbf24`) + 좌측 강조 막대
- 카드 내용: 키 / 요약 / 상태 칩 / 요청자 / 생성일 / "확인하러 가기" 버튼

**하단 — 전체 담당 티켓 리스트** (테이블)
- 컬럼: 키 / 요약 / 상태 / 요청자 / 마감 / 최근 업데이트
- 상태 필터: 전체 / 진행 중 / 완료 / 반려
- 정렬: 최근 업데이트순 (기본) / 마감 가까운 순 / 생성일순

#### 상단 메타
- 본인 담당 총 N건 / 확인 필요 N건 / 진행 중 N건 (배지)
- 페이지 제목 옆에 알림 배지 (`N건 확인 필요`)

#### 인터랙션
- 카드/행 클릭 → Jira 새 탭
- 페이지네이션 (50건 단위)

---

## 5. 구현 작업 분해 (구현 순서 제안 — 라벨 X)

> 우선순위/단계 구분 없이 모두 동등하게 구현 대상. 아래는 의존성 순서일 뿐.

### 인프라 작업
- [x] GitHub repo 생성 (`woojin-ahn-mss/sd-org-site`)
- [x] GitHub Pages 활성화 (public, main / root)
- [x] 다크 테마 랜딩 페이지 배포 (현재 index.html)
- [ ] `<meta name="robots" content="noindex">` + `robots.txt` 추가
- [ ] 공통 CSS / JS 골격 (`assets/css/main.css`, `assets/js/nav.js`)
- [ ] 상단 네비게이션 컴포넌트 (8 페이지 탭 + 마지막 동기화 표시)
- [ ] `data/meta.json` 스키마 정의

### Jira sync 자동화
- [ ] Jira PAT 발급 + GitHub Secret 등록 (`JIRA_TOKEN`)
- [ ] `.github/workflows/jira-sync.yml` 작성 (매일 06:00 KST cron)
- [ ] Python 스크립트 — JQL → JSON 빌더 (도메인별 5개 파일 생성)
- [ ] 동기화 결과 `data/meta.json` 업데이트
- [ ] 첫 실행 검증

### 페이지 구현 (의존성 순)
1. **홈** — 다른 페이지로 가는 진입점이라 골격 먼저 (KPI 카드는 데이터 준비 후 채움)
2. **로드맵 (간트)** — 가장 핵심 + 다른 페이지의 데이터 형식 검증
3. **ETR** — 본인 운영 즉시 가치
4. **패스트트랙** — ETR 페이지 패턴 재사용
5. **진행 현황** — 차트 컴포넌트 도입 (재사용됨)
6. **리소스** — 진행 현황의 차트 라이브러리 재사용
7. **성과** — 수동 지표 입력 스키마 확정 후
8. **로드맵 관리** — 드래그앤드롭 라이브러리 + localStorage 저장 로직

### 검증·정리
- [ ] 각 페이지 모바일(태블릿 정도) 대응 점검
- [ ] Print 스타일 (성과 페이지 PDF 출력용)
- [ ] 권한 노출 점검 (public이라 민감 데이터 마스킹 필요한지 재검토)
- [ ] 외부 검색엔진 인덱싱 차단 검증

---

## 6. 데이터 스키마 핵심 (요약)

### `data/jira/initiatives.json`
```json
{
  "lastSync": "2026-05-22T06:00:00+09:00",
  "count": 84,
  "items": [
    {
      "key": "CBP-1234",
      "url": "https://jira.team.musinsa.com/browse/CBP-1234",
      "summary": "...",
      "issueType": "Initiative",
      "project": "CBP",
      "status": "In Progress",
      "statusCategory": "indeterminate",
      "priority": "P0",
      "assignee": { "name": "...", "email": "..." },
      "reporter": { "name": "...", "email": "..." },
      "labels": ["one", "..."],
      "mainSubject": "01.추천",
      "yearQuarter": "2026-Q2",
      "startDate": "2026-04-01",
      "dueDate": "2026-06-30",
      "created": "2026-03-15T...",
      "updated": "2026-05-20T..."
    }
  ]
}
```

### `data/jira/etr-fasttrack.json`
```json
{
  "lastSync": "...",
  "items": [
    {
      "key": "ETR-3775",
      "summary": "...",
      "status": "검토완료-우선착수",
      "reporter": {...},
      "created": "...",
      "duedate": "...",
      "linkedTickets": [
        { "key": "CBP-1234", "summary": "...", "status": "Done" },
        { "key": "TM-5678", "summary": "...", "status": "In Progress" }
      ],
      "progress": { "done": 3, "total": 5 }
    }
  ]
}
```

### `data/metrics/2026-Q2.json` (수동)
```json
{
  "quarter": "2026-Q2",
  "kpis": [
    { "name": "검색 CTR", "value": 12.4, "unit": "%", "deltaPrev": 0.8 },
    { "name": "추천 클릭률", "value": 8.1, "unit": "%", "deltaPrev": -0.2 },
    { "name": "GMV 기여", "value": 12.5, "unit": "억", "deltaPrev": 2.1 }
  ],
  "launches": [
    {
      "ticketKey": "CBP-1234",
      "title": "추천 다양성 v2 출시",
      "launchedAt": "2026-05-15",
      "description": "...",
      "impactSummary": "검색 CTR +0.8%p"
    }
  ]
}
```

### `data/plans/roadmap-2026.json` (수동)
키워드 카드 배열. 위 4.6 데이터 모델 참조.

---

## 7. 비기능 요구사항

| 항목 | 기준 |
|---|---|
| 페이지 로드 | 2초 이내 (JSON 1~2MB 가정) |
| 동기화 지연 | 최대 24시간 (매일 새벽 1회 cron) |
| 브라우저 | Chrome / Safari 최신 (모바일은 태블릿까지 지원) |
| 데이터 정합성 | 전체 교체 전략 (Jira가 SoT) |
| 백업 / 롤백 | Git 히스토리 자동 |
| 검색엔진 노출 | 차단 (noindex + robots.txt) |

---

## 8. 미정 / 결정 필요

> 풀스펙 구현 진행하면서 함께 정해야 할 디테일. 작업을 늦추지는 않음.

- 홈 KPI 카드 6개 중 "이번 분기 진척률" 의 정확한 산식 (Done 수 / 전체? 가중치?)
- 성과 페이지의 지표 종류 확정 (검색 CTR / 추천 CTR / GMV 외에 어떤 게 핵심?)
- 진행 현황의 "장기 정체" 기준 (30일? 60일?)
- 리소스의 "과부하" 기준값 (현재 5건 / 8건은 가설, 운영하며 조정)
- 로드맵 관리에서 키워드 카드 → 실제 Jira 티켓화 시 워크플로우 (수동 / 자동 생성?)
- Jira 커스텀 필드 정확한 ID (메인주제 cf 번호, Year/Quarter cf[14521] 확인)
- 패스트트랙 "연결 티켓" 의 link type 어떤 걸로 잡을지 (relates / blocks / implements 중)

---

## 9. 참고

- 무신사 Jira cloudId: `23c14e7d-74ed-40b6-a0bb-fbc1f6351b84`
- 무신사 Jira 대시보드: https://jira.team.musinsa.com/jira/dashboards/16964
- 기존 분기 자료: `docs/docs/2026-Q2-kanban.html`, `docs/docs/2026-Q2-one-priority.html`
- 관련 스킬: `/kanban`, `/roadmap`, `/search-docs`
