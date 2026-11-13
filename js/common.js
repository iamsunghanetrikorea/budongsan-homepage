/* 공개 사이트와 관리자 화면이 함께 쓰는 공통 유틸 */
(function (global) {
  "use strict";

  var TRANSACTIONS = {
    sale: { label: "매매", color: "sale" },
    jeonse: { label: "전세", color: "jeonse" },
    monthly: { label: "월세", color: "monthly" }
  };

  var PROPERTY_TYPES = {
    apartment: "아파트",
    officetel: "오피스텔",
    house: "주택·빌라",
    commercial: "상가",
    land: "토지",
    etc: "기타"
  };

  var STATUSES = {
    published: "공개",
    hidden: "숨김",
    sold: "거래완료"
  };

  /** 520000000 -> "5억 2,000만원" */
  function formatKRW(won, opts) {
    if (won === null || won === undefined || won === "" || isNaN(won)) return "-";
    won = Number(won);
    var short = opts && opts.short;
    var eok = Math.floor(won / 100000000);
    var man = Math.round((won % 100000000) / 10000);
    if (short) {
      if (eok > 0) {
        var dec = man ? (man / 10000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "").slice(1) : "";
        return eok + (dec ? dec : "") + "억";
      }
      return man.toLocaleString("ko-KR") + "만";
    }
    var parts = [];
    if (eok > 0) parts.push(eok + "억");
    if (man > 0) parts.push(man.toLocaleString("ko-KR") + "만");
    if (!parts.length) return won.toLocaleString("ko-KR") + "원";
    return parts.join(" ") + "원";
  }

  /** 거래유형별 가격 문자열 */
  function priceText(p, short) {
    if (p.transaction === "sale") return formatKRW(p.priceKRW, { short: short });
    if (p.transaction === "jeonse") return formatKRW(p.depositKRW, { short: short });
    if (p.transaction === "monthly") {
      if (short) return formatKRW(p.depositKRW, { short: true }) + "/" + formatKRW(p.monthlyRentKRW, { short: true });
      return "보증금 " + formatKRW(p.depositKRW) + " / 월 " + formatKRW(p.monthlyRentKRW);
    }
    return "-";
  }

  /** 정렬·필터용 대표 금액 */
  function priceValue(p) {
    if (p.transaction === "sale") return Number(p.priceKRW) || 0;
    if (p.transaction === "jeonse") return Number(p.depositKRW) || 0;
    // 월세: 보증금 + 월세×100 (전월세 전환 대략값, 정렬용)
    return (Number(p.depositKRW) || 0) + (Number(p.monthlyRentKRW) || 0) * 100;
  }

  function areaText(p) {
    var ex = p.areaM2 ? Number(p.areaM2).toFixed(1).replace(/\.0$/, "") + "㎡" : "";
    var pyeong = p.areaM2 ? " (" + (p.areaM2 / 3.3058).toFixed(1) + "평)" : "";
    if (p.supplyAreaM2) {
      return Number(p.supplyAreaM2).toFixed(1).replace(/\.0$/, "") + "㎡(전용 " + ex + ")";
    }
    return ex ? "전용 " + ex + pyeong : "-";
  }

  function floorText(p) {
    if (!p.floor || p.floor === "-") return "";
    var f = /^\d+$/.test(String(p.floor)) ? p.floor + "층" : String(p.floor);
    return p.totalFloors ? f + " / " + p.totalFloors + "층" : f;
  }

  function roomsText(p) {
    if (!p.rooms && !p.baths) return "";
    return "방" + (p.rooms || 0) + " / 욕실" + (p.baths || 0);
  }

  /* ---------- 도안동 경계 검증 ---------- */
  function boundaryRing() {
    return (global.DOAN_BOUNDARY && global.DOAN_BOUNDARY.ring) || [];
  }

  function boundaryBBox() {
    var ring = boundaryRing();
    var b = { minLng: 180, minLat: 90, maxLng: -180, maxLat: -90 };
    ring.forEach(function (pt) {
      b.minLng = Math.min(b.minLng, pt[0]); b.maxLng = Math.max(b.maxLng, pt[0]);
      b.minLat = Math.min(b.minLat, pt[1]); b.maxLat = Math.max(b.maxLat, pt[1]);
    });
    return b;
  }

  /** ray-casting point-in-polygon. 경계 데이터가 없으면 false (안전측) */
  function isInDoanDong(lat, lng) {
    lat = Number(lat); lng = Number(lng);
    if (!isFinite(lat) || !isFinite(lng)) return false;
    var ring = boundaryRing();
    if (ring.length < 3) return false;
    // 보조 검증: bbox
    var b = boundaryBBox();
    if (lng < b.minLng || lng > b.maxLng || lat < b.minLat || lat > b.maxLat) return false;
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function escapeHTML(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /** 이미지 상대경로 허용 규칙: assets/properties/ 아래, 안전한 확장자 */
  function isValidImagePath(path) {
    return /^assets\/properties\/[A-Za-z0-9_\-\/]+\.(webp|jpe?g|png)$/i.test(path) && path.indexOf("..") === -1;
  }

  function placeholderImage(type) {
    var known = ["apartment", "officetel", "house", "commercial", "land"];
    return "assets/placeholders/" + (known.indexOf(type) >= 0 ? type : "etc") + ".svg";
  }

  global.RE = {
    TRANSACTIONS: TRANSACTIONS,
    PROPERTY_TYPES: PROPERTY_TYPES,
    STATUSES: STATUSES,
    formatKRW: formatKRW,
    priceText: priceText,
    priceValue: priceValue,
    areaText: areaText,
    floorText: floorText,
    roomsText: roomsText,
    isInDoanDong: isInDoanDong,
    boundaryBBox: boundaryBBox,
    boundaryRing: boundaryRing,
    escapeHTML: escapeHTML,
    isValidImagePath: isValidImagePath,
    placeholderImage: placeholderImage
  };
})(window);
