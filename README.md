# Search & Discovery 조직 사이트

무신사 Search & Discovery 실의 **로드맵 · 일감 · 리소스 관리** 와 **상위 보고** 를 위한 사이트.

## 상태

🚧 셋업 단계 — 랜딩 페이지 배포 완료. 8개 페이지 풀스펙 구현 진행 예정.

## 구조 (8 페이지, 모두 동등하게 구현)

| # | 페이지 | 핵심 |
|---|---|---|
| 1 | 🏠 홈 | KPI 카드 + 오늘의 액션 + 진입점 |
| 2 | 📋 로드맵 (간트) | 메인주제별 Initiative 타임라인 |
| 3 | 🚀 진행 현황 | 상태 분포 · 흐름 · 지연 |
| 4 | 👥 리소스 | 프로젝트 · 담당자별 부하 |
| 5 | 📊 성과 | 분기별 론치 + 임팩트 카드 |
| 6 | 🛠 로드맵 관리 | 1년 4분기 보드 (Jira + 키워드) |
| 7 | ⚡ 패스트트랙 | ETR + `one` 레이블 (임원 요청) |
| 8 | 📥 ETR | 외부 요청 / 본인 담당 |

## 문서

- [PRD.md](PRD.md) — 풀스펙 제품 요구사항 명세

## 기술 스택

- 정적 HTML / CSS / JS
- GitHub Pages (public, 검색엔진 noindex)
- GitHub Actions 로 매일 06:00 KST Jira sync
- 데이터: JSON in repo (도메인별 파일 분리)
- 테마: 다크 + 라이트 토글

## 접근

URL: https://woojin-ahn-mss.github.io/sd-org-site/
