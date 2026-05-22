# Search & Discovery 조직 사이트 — PRD

| 항목 | 값 |
|---|---|
| 작성일 | 2026-05-22 |
| 작성자 | 우진 (Search & Discovery 실장) |
| 상태 | v0.1 — 합의된 결정 정리, MVP 착수 전 |
| 배포 | musinsa GitHub Org / Private Pages (사내 한정) |

---

## 1. Overview

### 목적
Search & Discovery 실의 **로드맵 관리 · 일감 관리 · 리소스 관리** 를 한 곳에서 운영하고, 필요 시 상위 보고용으로 꺼내 쓰는 사이트.

### 1차 청중
실장(본인) — 매일 운영 / 주·월간 의사결정용

### 2차 청중
경영진(조만호 의장 등) — 보고 시점에 공유

### 핵심 가치
1. Jira에 흩어진 정보를 **한 화면에서 한눈에**
2. 자료 만들 때마다 새로 그리는 부담 제거 (대시보드가 항상 최신)
3. **1년치 로드맵 기획** 을 시각적으로 관리하는 작업대 제공

---

## 2. 사이트 구조 (8개 페이지)

| # | 페이지 | 핵심 역할 | 사용 빈도 | 우선순위 |
|---|---|---|---|---|
| 1 | 🏠 홈 | 오늘/이번주 핵심 요약 — 사이트의 시작점 | ★★★ | P1 (v2) |
| 2 | 📋 로드맵 (간트) | 메인주제별 전체 Initiative 타임라인 | ★★★ | **P0 (MVP)** |
| 3 | 🚀 진행 현황 | Jira 상태 분포 / 지연 / 흐름 | ★★ | P2 |
| 4 | 👥 리소스 | 프로젝트별·담당자별 부하 / 분배 | ★★ | P2 |
| 5 | 📊 성과 | 분기별 론치 + 임팩트 카드 (보고용) | ★★ | P1 (v2) |
| 6 | 🛠 로드맵 관리 | 1년치 로드맵 기획 작업대 | ★★ | P1 (v2) |
| 7 | ⚡ 패스트트랙 | 임원 요청(ETR + `one` 레이블) 추적 | ★★ | **P0 (MVP)** |
| 8 | 📥 ETR | 외부 조직 요청 / 본인 담당 | ★★ | **P0 (MVP)** |

### MVP 범위 (Phase 1)
2, 7, 8 (로드맵 / 패스트트랙 / ETR) — 가장 가치 큰 3개로 시작.

### v2 범위 (Phase 2)
1, 5, 6 (홈 / 성과 / 로드맵 관리)

### v3 범위 (Phase 3)
3, 4 (진행 현황 / 리소스) — 운영하면서 필요성 재평가

---

## 3. 기술 & 호스팅

### 호스팅
- **musinsa GitHub Organization 의 Private Repo + GitHub Pages**
- 사내 한정 접근 (musinsa GitHub 계정 보유자만 열람)
- 별도 인증 코드 불필요

### 데이터 동기화
- **GitHub Actions** 로 **매일 06:00 KST** Jira API 호출 → JSON 갱신 → 자동 commit
- Jira PAT 는 **GitHub Secrets** 에 저장
- 페이지에 "마지막 동기화: YYYY-MM-DD HH:mm" 표시

### 데이터 저장
- **JSON in repo** (도메인별 파일 분리)
- localStorage 는 **개인 환경설정(필터·컬럼 토글)만**
- Supabase 등 외부 DB 사용 안 함 (사내 한정 호스팅이라 단순화 가능)

### 폴더 구조

```
sd-org-site/
├── index.html                    # 홈 (v2)
├── pages/
│   ├── roadmap.html              # 로드맵 간트 (MVP)
│   ├── fasttrack.html            # 패스트트랙 (MVP)
│   ├── etr.html                  # ETR (MVP)
│   ├── performance.html          # 성과 (v2)
│   ├── roadmap-plan.html         # 로드맵 관리 (v2)
│   ├── progress.html             # 진행 현황 (v3)
│   └── resource.html             # 리소스 (v3)
├── assets/
│   ├── css/
│   └── js/
├── data/
│   ├── jira/
│   │   ├── initiatives.json      # 자동 (Actions)
│   │   ├── etr-fasttrack.json    # 자동
│   │   ├── etr-assigned.json     # 자동
│   │   └── all-tickets.json      # 자동
│   ├── plans/
│   │   └── roadmap-2026.json     # 수동 (v2에서 정의)
│   ├── metrics/
│   │   └── 2026-Q2.json          # 수동 (v2에서 정의)
│   └── meta.json                  # last-updated
└── .github/workflows/
    └── jira-sync.yml              # 매일 06:00 KST
```

---

## 4. 페이지별 상세 — MVP 3개

### 4.1 로드맵 (간트) — `pages/roadmap.html`

#### 데이터 소스
```jql
project IN (TM, MSSCXTF, PEL, CBP, PBO, TF)
AND issuetype = Initiative
AND "sub group[select list (multiple choices)]" = "MSS-P Discovery & Engagement"
```

#### 레이아웃
- 상단: 필터바
- 좌측: 행 그룹 (메인주제별 접기/펼치기)
- 우측: 간트 차트 영역

#### 시간 축 (토글)
- **분기 보기**: 6분기 한 화면 (현재 분기 중심 ±2~3분기)
- **월 보기**: 12개월 가로 스크롤

#### 행 그룹핑
- **메인주제** 기준 고정 (예: "01.추천", "02.검색", ...)
- 그룹 접기/펼치기 가능

#### 컬럼 (좌측 메타 영역, 사용자가 토글)
기본 표시:
1. **티켓 키** (클릭 시 새 탭으로 Jira 이동) — 항상 ON, 숨김 불가 권장
2. 우선순위
3. 상태
4. 기한

기본 숨김 (필요 시 ON):
5. 레이블
6. 담당자
7. 시작일
8. Year-Quarter

#### 간트 바 렌더링 규칙

| 보기 | 기준 | 동작 |
|---|---|---|
| 분기 보기 | `cf[14521]` (Year/Quarter) | 해당 분기 셀 단일 채우기 |
| 월 보기 (시작일 O) | 시작일 ~ 기한 | 가로 span |
| 월 보기 (시작일 X) | 기한만 존재 | 기한 기준 왼쪽 14일 그라데이션 페이드 |
| 월 보기 (둘 다 X) | — | 표시 안 함 / 회색 처리 (TBD) |

#### 필터 (상단 노출)
- 프로젝트 (다중)
- 메인주제 (다중)
- 레이블 (다중)
- 기간 (이번 분기 / 다음 분기 / 6분기 / 커스텀)

#### 필터 (고급 메뉴 접힘)
- 상태 (다중)
- 담당자 (다중)
- 우선순위 (다중)

#### 인터랙션
- 티켓 키 클릭 → Jira 이슈로 이동 (새 탭)
- 컬럼 토글 메뉴 (테이블 헤더 우측 톱니바퀴)
- 필터 적용 후 URL 쿼리스트링 저장 → 북마크 가능

---

### 4.2 패스트트랙 — `pages/fasttrack.html`

#### 데이터 소스
```jql
project = ETR AND labels = "one" ORDER BY created DESC
```
+ 각 이슈의 **연결 티켓** (issue links) 조회 (별도 호출)

#### 레이아웃
- **1행 = 1 ETR 티켓**
- 행 클릭 → 펼침/접기 (인라인 expand)
- 펼치면 그 ETR에 연결된 티켓 미니 리스트 노출

#### 행 컬럼
| 컬럼 | 내용 |
|---|---|
| ETR 키 | 클릭 시 Jira 이동 |
| 요청자 (Reporter) | 임원 이름 |
| 요약 | ETR 티켓 summary |
| ETR 상태 | 자체 상태 (검토중/검토완료-우선착수/완료 등) |
| 진척률 | 연결 티켓 진행 게이지 (예: 3/5) |
| 요청일 / 마감 | created / duedate |

#### 펼침 영역 (연결 티켓)
- 각 연결 티켓: 키 / 요약 / 상태 / 담당자 / 진행 바
- 클릭 시 Jira 이동

#### 정렬 / 필터
- 기본 정렬: 최근 생성 순
- 필터: 상태 / 요청자

---

### 4.3 ETR (외부 요청, 본인 담당) — `pages/etr.html`

#### 데이터 소스
```jql
project = ETR AND assignee = currentUser() ORDER BY updated DESC
```

#### 레이아웃 (2 섹션)

**상단 — "지금 확인 필요" 강조 박스**
- 조건: status IN ("발의", "매니저 승인 대기", "Tech 검토 대기 중")
- 강조 색상 (주황 / 빨강) + 카드형
- 각 카드: 키 / 요약 / 상태 / 요청자 / 생성일

**하단 — 전체 담당 티켓 리스트**
- 테이블 형태
- 컬럼: 키 / 요약 / 상태 / 요청자 / 마감 / 최근 업데이트
- 상태 필터 (전체 / 진행중 / 완료 / 반려)

#### 인터랙션
- 카드/행 클릭 → Jira 이동
- 상단 박스에 "N건 확인 필요" 뱃지

---

## 5. 디자인 가이드 (참고)

- **다크 테마** (기존 `2026-Q2-*.html` 자료들과 일관성)
- 톤: 깔끔, 데이터 우선, 장식 최소
- 폰트: Pretendard / 시스템 폰트
- 상단에 **마지막 동기화 시각** 항상 표시
- 사이드바 또는 상단 탭으로 페이지 간 이동

---

## 6. Phase별 계획

### Phase 1 — MVP (2~3주)
**목표**: 매일 들어가서 보는 운영 대시보드 완성

- [ ] GitHub 조직 내 private repo 셋업 (`musinsa/sd-org-site` 또는 협의)
- [ ] GitHub Pages 활성화
- [ ] GitHub Actions: Jira sync 워크플로우 (`.github/workflows/jira-sync.yml`)
- [ ] PAT(Personal Access Token) → GitHub Secrets 등록
- [ ] 데이터 스키마 확정 + JSON 빌드 스크립트
- [ ] **페이지 3개 구현**: 로드맵 / 패스트트랙 / ETR
- [ ] 공통 레이아웃 (상단 네비, 다크 테마, last-updated)

### Phase 2 — 확장 (Phase 1 안정화 후 4~6주차)
- [ ] 🏠 홈 페이지 (KPI 카드 + 임박 마감)
- [ ] 📊 성과 페이지 (분기별 론치 카드 + 지표)
- [ ] 🛠 로드맵 관리 페이지 (분기 4컬럼 보드, localStorage 기반)

### Phase 3 — 운영 안정화 후 (필요 시)
- [ ] 🚀 진행 현황
- [ ] 👥 리소스
- [ ] 로드맵 관리에 JSON Export 기능 추가 (다중 디바이스 대비)

---

## 7. 미정 / 다음 라운드에서 정할 것

### Phase 2 들어가기 전 필요한 결정
- **홈**: 어떤 KPI/숫자를 보여줄지 (P0 처리율? 이번 분기 진척률? 임박 마감 N건?)
- **성과**: 어떤 지표(검색 CTR / 추천 클릭률 / GMV 등)를 어떤 출처에서 가져올지
- **로드맵 관리**: 키워드 카드의 정확한 데이터 모델 (제목 / 메모 / 분기 / 메인주제 / 우선순위?)

### Phase 1 진행 중 확인할 것
- musinsa GitHub Org의 Private Pages 사용 가능 여부 (사내 개발팀/SRE에 문의)
- 메인주제 커스텀 필드 ID 확인 (Jira에서 정확한 cf[xxxxx] 값)
- Year/Quarter 필드 ID 확인 (`cf[14521]` 가정)
- 페이지네이션 처리 (ETR 50건 이상일 때)

### 호스팅 옵션 fallback
musinsa GitHub Org의 Private Pages 사용이 어렵다면:
- Option B: Public Pages + Google OAuth 게이트 (@musinsa.com 도메인만) — MUNO-SEAT 패턴
- Option C: 사내 호스팅 (Confluence 임베드 / 사내망 서버)

---

## 8. 비기능 요구사항

| 항목 | 기준 |
|---|---|
| 페이지 로드 | 2초 이내 (JSON 1MB 가정) |
| 동기화 지연 | 최대 24시간 (매일 새벽 1회) |
| 브라우저 | Chrome / Safari 최신 버전 (모바일은 v3에서 고려) |
| 데이터 정합성 | "전체 교체" 전략 (머지 X) — Jira가 SoT |
| 백업 / 롤백 | Git 히스토리로 자동 |

---

## 9. 참고

- 기존 분기 자료: `docs/docs/2026-Q2-kanban.html`, `docs/docs/2026-Q2-one-priority.html`
- 관련 스킬: `/kanban`, `/roadmap`, `/search-docs` (CLAUDE.md 참조)
- 무신사 Jira cloudId: `23c14e7d-74ed-40b6-a0bb-fbc1f6351b84`
- 무신사 Jira 대시보드: https://jira.team.musinsa.com/jira/dashboards/16964
- 사내 Supabase 운영 사례 (참고만): MUNO-SEAT, Claude Skill Stats
