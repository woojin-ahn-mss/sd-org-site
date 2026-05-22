// Realistic Korean dummy data for the S&D dashboard prototype.
// Names/tickets are illustrative for design only.

window.SD_DATA = (() => {
  const PEOPLE = [
    { name: "안우진", initials: "AW", color: "#7c9cff" },
    { name: "김민서", initials: "KM", color: "#9ee37d" },
    { name: "이도윤", initials: "LD", color: "#ffb454" },
    { name: "박서연", initials: "PS", color: "#c4b5fd" },
    { name: "최지훈", initials: "CJ", color: "#f87171" },
    { name: "정하늘", initials: "JH", color: "#5eead4" },
    { name: "한승우", initials: "HS", color: "#fbbf24" },
    { name: "오은채", initials: "OE", color: "#a78bfa" },
    { name: "송재현", initials: "SJ", color: "#60a5fa" },
    { name: "윤다은", initials: "YD", color: "#fb7185" },
  ];

  const SUBJECTS = ["01.추천", "02.검색", "03.랭킹", "04.개인화", "05.디스커버리"];
  const PROJECTS = ["CBP", "PBO", "PEL", "TM", "MSSCXTF", "TF", "SNDPRD", "CMALL"];

  // Initiatives (for Gantt / Home / Progress / Resource)
  const INITIATIVES = [
    // 01.추천
    { key: "CBP-1342", main: "01.추천", project: "CBP", summary: "추천 다양성 알고리즘 v2", priority: "P0", status: "In Progress", stCat: "amber", yq: "2026-Q2", start: "2026-04-01", due: "2026-06-28", assignee: "김민서", labels: ["one","core"] },
    { key: "CBP-1410", main: "01.추천", project: "CBP", summary: "콜드스타트 신규 유저 추천 보강", priority: "P1", status: "검토중", stCat: "amber", yq: "2026-Q3", start: "2026-07-01", due: "2026-09-15", assignee: "이도윤", labels: ["one"] },
    { key: "PBO-882",  main: "01.추천", project: "PBO", summary: "홈피드 모듈 빈도 최적화",  priority: "P2", status: "발의",   stCat: "purple", yq: "2026-Q4", start: null, due: "2026-12-20", assignee: "박서연", labels: [] },
    { key: "TF-512",   main: "01.추천", project: "TF",  summary: "Long-Session 유저 추천 점프",  priority: "P2", status: "대기",   stCat: "slate",  yq: "2026-Q4", start: null, due: null, assignee: "송재현", labels: [] },

    // 02.검색
    { key: "TM-2210",  main: "02.검색", project: "TM",  summary: "검색 의도 분류기 리뉴얼", priority: "P0", status: "In Progress", stCat: "amber", yq: "2026-Q2", start: "2026-04-10", due: "2026-06-30", assignee: "최지훈", labels: ["one","core"] },
    { key: "TM-2255",  main: "02.검색", project: "TM",  summary: "자동완성 한·영 혼합 처리", priority: "P1", status: "In Progress", stCat: "amber", yq: "2026-Q3", start: "2026-06-15", due: "2026-08-30", assignee: "정하늘", labels: [] },
    { key: "PEL-440",  main: "02.검색", project: "PEL", summary: "이미지 검색 베타 오픈",   priority: "P1", status: "대기",   stCat: "slate", yq: "2026-Q3", start: null, due: "2026-09-30", assignee: "한승우", labels: ["one"] },
    { key: "TM-2310",  main: "02.검색", project: "TM",  summary: "롱테일 쿼리 클릭 임팩트 분석", priority: "P2", status: "발의", stCat: "purple", yq: "2026-Q4", start: null, due: null, assignee: "오은채", labels: [] },

    // 03.랭킹
    { key: "MSSCXTF-71", main: "03.랭킹", project: "MSSCXTF", summary: "랭킹 모델 A/B 실험 파이프라인", priority: "P0", status: "In Progress", stCat: "amber", yq: "2026-Q2", start: "2026-03-20", due: "2026-06-10", assignee: "송재현", labels: ["one"] },
    { key: "MSSCXTF-92", main: "03.랭킹", project: "MSSCXTF", summary: "Multi-Stage Ranker 도입", priority: "P1", status: "검토중", stCat: "amber", yq: "2026-Q3", start: "2026-07-01", due: "2026-09-29", assignee: "윤다은", labels: ["one","core"] },
    { key: "TF-501",    main: "03.랭킹", project: "TF",      summary: "리스코어링 후보 큐 최적화", priority: "P2", status: "완료", stCat: "green", yq: "2026-Q2", start: "2026-04-01", due: "2026-05-15", assignee: "김민서", labels: [] },

    // 04.개인화
    { key: "PBO-915",  main: "04.개인화", project: "PBO", summary: "사용자 세그먼트 자동 클러스터링", priority: "P0", status: "In Progress", stCat: "amber", yq: "2026-Q3", start: "2026-05-20", due: "2026-08-25", assignee: "이도윤", labels: ["one"] },
    { key: "PEL-471",  main: "04.개인화", project: "PEL", summary: "성별·연령 외 취향 임베딩 v1", priority: "P1", status: "대기", stCat: "slate", yq: "2026-Q3", start: null, due: "2026-09-15", assignee: "정하늘", labels: [] },
    { key: "CBP-1450", main: "04.개인화", project: "CBP", summary: "재방문 유저 홈 레이아웃 개인화", priority: "P1", status: "발의", stCat: "purple", yq: "2026-Q4", start: null, due: null, assignee: "박서연", labels: ["one"] },

    // 05.디스커버리
    { key: "SNDPRD-22", main: "05.디스커버리", project: "SNDPRD", summary: "신상품 디스커버리 모듈 신설", priority: "P1", status: "In Progress", stCat: "amber", yq: "2026-Q2", start: "2026-04-15", due: "2026-06-30", assignee: "최지훈", labels: [] },
    { key: "SNDPRD-29", main: "05.디스커버리", project: "SNDPRD", summary: "큐레이션 콜렉션 자동 생성", priority: "P2", status: "검토중", stCat: "amber", yq: "2026-Q3", start: "2026-07-10", due: "2026-09-05", assignee: "한승우", labels: [] },
    { key: "CMALL-118", main: "05.디스커버리", project: "CMALL", summary: "트렌드 키워드 위젯 개편", priority: "P2", status: "발의", stCat: "purple", yq: "2026-Q4", start: null, due: null, assignee: "오은채", labels: [] },
  ];

  // ETR fasttrack (임원 요청)
  const FASTTRACK = [
    {
      key: "ETR-3775", summary: "메인 추천 다양성 임팩트 보고", status: "검토완료-우선착수", stCat: "blue",
      reporter: "조만호 의장", created: "2026-05-02", duedate: "2026-06-15",
      progress: { done: 3, total: 5 },
      linked: [
        { key: "CBP-1342", summary: "추천 다양성 알고리즘 v2", status: "In Progress", stCat: "amber", assignee: "김민서", pct: 65 },
        { key: "PBO-915", summary: "사용자 세그먼트 자동 클러스터링", status: "In Progress", stCat: "amber", assignee: "이도윤", pct: 40 },
        { key: "TF-501", summary: "리스코어링 후보 큐 최적화", status: "완료", stCat: "green", assignee: "김민서", pct: 100 },
        { key: "MSSCXTF-71", summary: "랭킹 모델 A/B 실험 파이프라인", status: "완료", stCat: "green", assignee: "송재현", pct: 100 },
        { key: "CBP-1410", summary: "콜드스타트 신규 유저 추천 보강", status: "완료", stCat: "green", assignee: "이도윤", pct: 100 },
      ]
    },
    {
      key: "ETR-3812", summary: "검색 의도 분류기 효과 분석 요청", status: "검토중", stCat: "amber",
      reporter: "조만호 의장", created: "2026-05-08", duedate: "2026-06-30",
      progress: { done: 1, total: 4 },
      linked: [
        { key: "TM-2210", summary: "검색 의도 분류기 리뉴얼", status: "In Progress", stCat: "amber", assignee: "최지훈", pct: 70 },
        { key: "TM-2255", summary: "자동완성 한·영 혼합 처리", status: "In Progress", stCat: "amber", assignee: "정하늘", pct: 30 },
        { key: "MSSCXTF-71", summary: "랭킹 모델 A/B 실험 파이프라인", status: "완료", stCat: "green", assignee: "송재현", pct: 100 },
        { key: "PEL-440", summary: "이미지 검색 베타 오픈", status: "대기", stCat: "slate", assignee: "한승우", pct: 0 },
      ]
    },
    {
      key: "ETR-3856", summary: "Q3 리스트뷰 개인화 강화안",
      status: "발의", stCat: "purple",
      reporter: "박준모 CTO", created: "2026-05-15", duedate: "2026-07-31",
      progress: { done: 0, total: 3 },
      linked: [
        { key: "PEL-471", summary: "성별·연령 외 취향 임베딩 v1", status: "대기", stCat: "slate", assignee: "정하늘", pct: 5 },
        { key: "CBP-1450", summary: "재방문 유저 홈 레이아웃 개인화", status: "발의", stCat: "purple", assignee: "박서연", pct: 0 },
        { key: "MSSCXTF-92", summary: "Multi-Stage Ranker 도입", status: "검토중", stCat: "amber", assignee: "윤다은", pct: 15 },
      ]
    },
    {
      key: "ETR-3901", summary: "이미지 검색 베타 일정 단축 가능성", status: "검토중", stCat: "amber",
      reporter: "한상미 부사장", created: "2026-05-18", duedate: "2026-08-15",
      progress: { done: 0, total: 2 },
      linked: [
        { key: "PEL-440", summary: "이미지 검색 베타 오픈", status: "대기", stCat: "slate", assignee: "한승우", pct: 0 },
        { key: "PEL-471", summary: "성별·연령 외 취향 임베딩 v1", status: "대기", stCat: "slate", assignee: "정하늘", pct: 5 },
      ]
    },
    {
      key: "ETR-3944", summary: "트렌드 키워드 모듈 홈 노출 검토", status: "Tech 검토 대기 중", stCat: "purple",
      reporter: "조만호 의장", created: "2026-05-20", duedate: "2026-09-01",
      progress: { done: 0, total: 1 },
      linked: [
        { key: "CMALL-118", summary: "트렌드 키워드 위젯 개편", status: "발의", stCat: "purple", assignee: "오은채", pct: 0 },
      ]
    },
  ];

  // ETR assigned to me
  const ETR_MINE = [
    { key: "ETR-3958", summary: "외부 파트너 API 변경 영향 검토", status: "발의", stCat: "purple", reporter: "이수민 PM (CRM)", created: "2026-05-21", updated: "2026-05-22", duedate: "2026-06-07", needCheck: true },
    { key: "ETR-3920", summary: "매장 재고 연동 검색 노출 요청", status: "매니저 승인 대기", stCat: "purple", reporter: "강현준 PM (오프라인)", created: "2026-05-19", updated: "2026-05-21", duedate: "2026-06-15", needCheck: true },
    { key: "ETR-3902", summary: "캠페인 페이지 추천 모듈 삽입", status: "Tech 검토 대기 중", stCat: "purple", reporter: "장유리 마케팅", created: "2026-05-17", updated: "2026-05-20", duedate: "2026-06-30", needCheck: true },
    { key: "ETR-3845", summary: "신규 카테고리 랜딩 검색 노출 룰", status: "검토중", stCat: "amber", reporter: "오민혁 PD", created: "2026-05-10", updated: "2026-05-21", duedate: "2026-07-15", needCheck: false },
    { key: "ETR-3801", summary: "글로벌몰 검색 베타 동시 적용", status: "검토중", stCat: "amber", reporter: "Lee Hannah (글로벌)", created: "2026-05-05", updated: "2026-05-19", duedate: "2026-08-01", needCheck: false },
    { key: "ETR-3754", summary: "스토어 라이브 페이지 큐레이션", status: "검토완료-우선착수", stCat: "blue", reporter: "차해린 콘텐츠", created: "2026-04-22", updated: "2026-05-16", duedate: "2026-06-30", needCheck: false },
    { key: "ETR-3701", summary: "이벤트 페이지 인기 키워드 노출", status: "완료", stCat: "green", reporter: "유경민 마케팅", created: "2026-04-10", updated: "2026-05-08", duedate: "2026-05-05", needCheck: false },
    { key: "ETR-3690", summary: "검색결과 UI 시안 검토 요청", status: "완료", stCat: "green", reporter: "임채원 디자이너", created: "2026-04-05", updated: "2026-04-30", duedate: "2026-04-28", needCheck: false },
    { key: "ETR-3621", summary: "취향카테고리 노출 모달 변경", status: "반려", stCat: "red", reporter: "권나윤 PM", created: "2026-03-28", updated: "2026-04-12", duedate: "2026-04-30", needCheck: false },
  ];

  // Completed launches per quarter (for Performance)
  const LAUNCHES = {
    "2026-Q2": [
      { key: "TF-501", title: "리스코어링 후보 큐 최적화", date: "2026-05-12", desc: "랭킹 후보 큐 사이즈 30% 감축, 응답 지연 −18%.", impact: "검색 P95 응답시간 −62ms" },
      { key: "MSSCXTF-71", title: "랭킹 A/B 실험 파이프라인", date: "2026-06-04", desc: "실험 셋업·집계 자동화. 실험당 PM 작업 4h → 30분.", impact: "월 평균 실험 8건 → 24건" },
      { key: "CBP-1342", title: "추천 다양성 알고리즘 v2", date: "2026-06-25", desc: "유저별 카테고리 분포 균형 보정. 클릭 편중 완화.", impact: "추천 CTR +0.8%p" },
      { key: "SNDPRD-22", title: "신상품 디스커버리 모듈 출시", date: "2026-06-28", desc: "홈 두 번째 슬롯 신상 모듈, 룰 기반 큐레이션.", impact: "신상 클릭률 +14%" },
    ],
    "2026-Q1": [
      { key: "TM-2150", title: "검색 자동완성 인덱싱 개편", date: "2026-02-18", desc: "신규 색인 파이프라인 도입.", impact: "자동완성 노출 지연 −80%" },
      { key: "PBO-840", title: "홈피드 v3 베타 릴리즈", date: "2026-03-08", desc: "모듈 구조 리뉴얼·실험 인프라 정비.", impact: "홈 체류시간 +12%" },
      { key: "CBP-1280", title: "추천 모델 학습 주기 단축", date: "2026-03-22", desc: "일간→6시간 주기, 트래픽 변화 반영 속도 개선.", impact: "신규 상품 추천 노출 D+1 → D+0.25" },
    ],
    "2025-Q4": [
      { key: "TM-2050", title: "쿼리 정규화 룰 통합", date: "2025-11-04", desc: "기존 분산 룰 단일 컴포넌트화.", impact: "검색 무결과율 −2.1%p" },
      { key: "PEL-380", title: "취향 카테고리 온보딩 개선", date: "2025-12-10", desc: "신규 유저 첫 화면 개인화 시드 추가.", impact: "신규 D1 리텐션 +3.2%p" },
    ],
    "2025-Q3": [
      { key: "MSSCXTF-50", title: "랭킹 모델 v4 적용", date: "2025-09-15", desc: "Listwise 학습 도입.", impact: "검색 CTR +1.4%p" },
    ],
  };

  const QUARTER_KPIS = {
    "2026-Q2": [
      { name: "출시 과제 수", value: 4, unit: "건", deltaPrev: 1, spark: [2,3,3,4,3,4] },
      { name: "검색 CTR", value: 12.4, unit: "%", deltaPrev: 0.8, spark: [11.0,11.2,11.5,11.7,12.0,12.4] },
      { name: "추천 클릭률", value: 8.1, unit: "%", deltaPrev: -0.2, spark: [8.4,8.3,8.2,8.0,8.0,8.1] },
      { name: "GMV 기여", value: 12.5, unit: "억", deltaPrev: 2.1, spark: [8,9,10.5,10.8,11.4,12.5] },
    ],
    "2026-Q1": [
      { name: "출시 과제 수", value: 3, unit: "건", deltaPrev: 1, spark: [1,1,2,2,2,3] },
      { name: "검색 CTR", value: 11.6, unit: "%", deltaPrev: 0.5, spark: [11.0,11.1,11.2,11.4,11.5,11.6] },
      { name: "추천 클릭률", value: 8.3, unit: "%", deltaPrev: 0.1, spark: [8.0,8.1,8.2,8.2,8.3,8.3] },
      { name: "GMV 기여", value: 10.4, unit: "억", deltaPrev: 1.6, spark: [7,7.5,8.5,9,9.5,10.4] },
    ],
    "2025-Q4": [
      { name: "출시 과제 수", value: 2, unit: "건", deltaPrev: -1, spark: [3,2,2,2,2,2] },
      { name: "검색 CTR", value: 11.1, unit: "%", deltaPrev: 0.3, spark: [10.6,10.7,10.9,11.0,11.0,11.1] },
      { name: "추천 클릭률", value: 8.2, unit: "%", deltaPrev: 0.4, spark: [7.8,7.9,8.0,8.1,8.1,8.2] },
      { name: "GMV 기여", value: 8.8, unit: "억", deltaPrev: -0.4, spark: [9,9.2,9.1,8.9,8.8,8.8] },
    ],
    "2025-Q3": [
      { name: "출시 과제 수", value: 3, unit: "건", deltaPrev: 0, spark: [3,3,3,3,3,3] },
      { name: "검색 CTR", value: 10.8, unit: "%", deltaPrev: 1.4, spark: [9.4,9.6,9.9,10.2,10.5,10.8] },
      { name: "추천 클릭률", value: 7.8, unit: "%", deltaPrev: 0.3, spark: [7.5,7.5,7.6,7.7,7.7,7.8] },
      { name: "GMV 기여", value: 9.2, unit: "억", deltaPrev: 1.1, spark: [8.0,8.2,8.5,8.7,9.0,9.2] },
    ],
  };

  // Roadmap-plan: keyword cards (idea cards user creates)
  const KEYWORD_CARDS = [
    { id: "kw-1", title: "추천 결과 다양성 v3", main: "01.추천", priority: "P1", quarter: "Q3", project: "CBP", notes: "v2 후속 — 다양성-정확성 트레이드오프 자동 조정" },
    { id: "kw-2", title: "검색 결과 페이지 리랭킹", main: "02.검색", priority: "P0", quarter: "Q3", project: "TM", notes: "딥 모델 베이스 리랭커 도입" },
    { id: "kw-3", title: "AI 추천 설명 카드", main: "01.추천", priority: "P2", quarter: "Q4", project: "CBP", notes: '"왜 이 추천?" 라벨 — 클릭 신뢰도 개선' },
    { id: "kw-4", title: "Vector Search 인프라", main: "02.검색", priority: "P1", quarter: "Q4", project: "TM", notes: "이미지·텍스트 통합 임베딩" },
    { id: "kw-5", title: "취향 진단 v2", main: "04.개인화", priority: "P1", quarter: "Q1-2027", project: "PEL", notes: "온보딩 외 재진단 트리거" },
    { id: "kw-6", title: "행동 기반 추천 v3", main: "01.추천", priority: "P0", quarter: "Q1-2027", project: "CBP", notes: "세션 기반 추천 모델" },
    { id: "kw-7", title: "노출-구매 갭 줄이기", main: "03.랭킹", priority: "P2", quarter: null, project: "MSSCXTF", notes: "랭킹 후처리 알고리즘 검증 필요" },
    { id: "kw-8", title: "온/오프라인 통합 검색", main: "05.디스커버리", priority: "P2", quarter: null, project: "SNDPRD", notes: "매장 재고 인덱스 통합 — 사전 조사" },
  ];

  const META = {
    lastSync: "2026-05-22 06:00",
    nextSync: "내일 06:00",
    currentQuarter: "2026-Q2",
    currentDate: "2026-05-22",
    today: { y: 2026, m: 5, d: 22 },
  };

  // Status sets per status name
  const STATUS_STYLES = {
    "발의":   "purple",
    "검토중": "amber",
    "Tech 검토 대기 중": "purple",
    "매니저 승인 대기": "purple",
    "In Progress": "amber",
    "대기": "slate",
    "완료": "green",
    "검토완료-우선착수": "blue",
    "반려": "red",
  };

  return {
    PEOPLE, SUBJECTS, PROJECTS,
    INITIATIVES, FASTTRACK, ETR_MINE,
    LAUNCHES, QUARTER_KPIS, KEYWORD_CARDS,
    META, STATUS_STYLES,
  };
})();
