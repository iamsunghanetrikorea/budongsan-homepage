/* =========================================================
 * 사이트 설정 — 공개 정보만 넣으세요. (비밀 키·개인정보 금지)
 * ========================================================= */
window.SITE_CONFIG = {
  office: {
    legalName: "도안IPARK파인공인중개사사무소",   // 정식 상호
    displayName: "도안IPARK 파인 부동산",         // 홈페이지 표시명
    tagline: "대전 서구 도안동 전문 부동산",
    specialties: "아파트 · 분양권 · 원투룸 · 상가 · 오피스텔 전문",
    phone: "042-545-9114",
    tel: "0425459114",
    address: "대전광역시 서구 도안동로 183, 104-1호",
    addressShort: "대전 서구 도안동로 183, 104-1호",
    // ▼ 법정 표시정보: 실제 증빙(중개사무소 등록증 등) 확인 후 입력. 임의로 채우지 마세요.
    registrationNumber: "",  // 중개사무소 등록번호
    representative: "",      // 대표(개업공인중개사) 성명
    businessNumber: ""       // 사업자등록번호 (선택)
  },

  // 매물 지도·검색 범위 (사무소 주소와 별도 관리)
  searchArea: {
    label: "대전 서구 도안동",
    dong: "도안동",
    center: { lat: 36.3175, lng: 127.3486 },
    zoom: 15
  },

  map: {
    // "osm"  : OpenStreetMap 지도 (무료, API 키 불필요)
    // "none" : 지도 끔 (목록·전화 상담만 표시)
    provider: "osm"
  },

  // 관리자 화면의 [홈페이지에 게시]가 매물 데이터를 올릴 GitHub 저장소 (공개 정보)
  // 토큰(비밀번호 역할)은 여기에 절대 넣지 말고, 관리자 화면의 [GitHub 연결 설정]에서만 입력하세요.
  github: {
    owner: "iamsunghanetrikorea",
    repo: "budongsan-homepage",
    branch: "main",
    pagesUrl: "https://iamsunghanetrikorea.github.io/budongsan-homepage/"
  },

  data: {
    url: "data/properties.json",
    // 로컬(localhost, file)에서 열 때만 예시 매물을 보여줍니다. GitHub Pages 에서는 실제 데이터만 표시.
    demoUrl: "data/properties.sample.json",
    demoMode: "auto" // "auto" | true | false
  }
};
