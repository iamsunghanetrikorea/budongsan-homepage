/* 로컬 관리자: JSON 불러오기 → 입력/수정/삭제/검증 → JSON 다운로드
 * 서버 없이 동작. 작업 중 데이터는 이 브라우저 localStorage에 임시 보관. */
(function () {
  "use strict";

  var RE = window.RE;
  var CFG = window.SITE_CONFIG;
  var DRAFT_KEY = "doan-admin-draft-v1";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var NUM_FIELDS = ["priceKRW", "depositKRW", "monthlyRentKRW", "maintenanceFeeKRW", "areaM2", "supplyAreaM2", "totalFloors", "rooms", "baths", "latitude", "longitude"];
  var FIELD_ORDER = ["id", "title", "transaction", "propertyType", "priceKRW", "depositKRW", "monthlyRentKRW", "maintenanceFeeKRW",
    "areaM2", "supplyAreaM2", "floor", "totalFloors", "rooms", "baths", "moveInDate", "addressDong", "latitude", "longitude",
    "highlights", "description", "images", "featured", "status", "updatedAt", "lastCheckedAt"];

  var state = { items: [], editingId: null, dirty: false };
  var map, pickMarker;

  /* ---------- 유틸 ---------- */
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function msg(text, isErr) {
    var box = $("#msg");
    box.innerHTML = '<div class="m' + (isErr ? " err" : "") + '">' + RE.escapeHTML(text) + "</div>";
    clearTimeout(msg.t);
    msg.t = setTimeout(function () { box.innerHTML = ""; }, isErr ? 9000 : 4000);
  }

  function nextId() {
    var max = 0;
    state.items.forEach(function (p) {
      var m = /(\d+)$/.exec(p.id || "");
      if (m) max = Math.max(max, Number(m[1]));
    });
    return "DA-" + String(max + 1).padStart(4, "0");
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), items: state.items })); } catch (e) { /* 무시 */ }
  }

  function normalizeOrder(p) {
    var o = {};
    FIELD_ORDER.forEach(function (k) { o[k] = p[k] === undefined ? null : p[k]; });
    Object.keys(p).forEach(function (k) { if (!(k in o) && k.charAt(0) !== "_") o[k] = p[k]; });
    if (!Array.isArray(o.images)) o.images = [];
    if (!Array.isArray(o.highlights)) o.highlights = [];
    o.featured = !!o.featured;
    return o;
  }

  /* ---------- 불러오기 / 내보내기 ---------- */
  function setItems(list, source) {
    if (!Array.isArray(list)) throw new Error("JSON 최상위가 배열이 아닙니다.");
    state.items = list.map(normalizeOrder);
    state.dirty = false;
    closeEditor();
    renderRows();
    saveDraft();
    msg(source + "에서 " + state.items.length + "건을 불러왔습니다.");
  }

  $("#import-file").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    if (state.dirty && !confirm("저장하지 않은 작업이 있습니다. 덮어쓸까요?")) { e.target.value = ""; return; }
    var r = new FileReader();
    r.onload = function () {
      try { setItems(JSON.parse(r.result), file.name); } catch (err) { msg("불러오기 실패: " + err.message, true); }
    };
    r.readAsText(file, "utf-8");
    e.target.value = "";
  });

  $("#load-repo").addEventListener("click", function () {
    if (location.protocol === "file:") {
      msg("파일로 직접 연 경우 브라우저 보안상 자동 읽기가 안 됩니다. [properties.json 불러오기]를 사용하세요.", true);
      return;
    }
    if (state.dirty && !confirm("저장하지 않은 작업이 있습니다. 덮어쓸까요?")) return;
    fetch("../" + CFG.data.url + "?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { setItems(d, "저장소 data/properties.json"); })
      .catch(function (err) { msg("읽기 실패: " + err.message, true); });
  });

  $("#export").addEventListener("click", function () {
    var problems = [];
    state.items.forEach(function (p) {
      var errs = validate(p).filter(function (e) { return !e.warn; });
      if (errs.length && p.status === "published") problems.push(p.id + ": " + errs[0].text);
    });
    if (problems.length) {
      msg("공개 매물에 오류가 있어 내보낼 수 없습니다 → " + problems.slice(0, 3).join(" / "), true);
      return;
    }
    var ids = {};
    var dup = state.items.filter(function (p) { if (ids[p.id]) return true; ids[p.id] = 1; return false; });
    if (dup.length) { msg("중복된 매물번호가 있습니다: " + dup.map(function (p) { return p.id; }).join(", "), true); return; }

    var data = state.items.map(normalizeOrder).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    var blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    downloadBlob(blob, "properties.json");
    state.dirty = false;
    msg("properties.json을 다운로드했습니다. 저장소의 data/ 폴더 파일을 교체한 뒤 GitHub Desktop에서 Commit → Push 하세요.");
  });

  function downloadBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- 목록 ---------- */
  function renderRows() {
    var f = $("#list-filter").value;
    var rows = state.items.filter(function (p) { return !f || p.status === f; })
      .sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
    var counts = { published: 0, hidden: 0, sold: 0 };
    state.items.forEach(function (p) { counts[p.status] = (counts[p.status] || 0) + 1; });
    $("#stats").textContent = "전체 " + state.items.length + " · 공개 " + counts.published + " · 숨김 " + counts.hidden + " · 거래완료 " + counts.sold;
    $("#rows-empty").hidden = rows.length > 0;
    $("#rows").innerHTML = rows.map(function (p) {
      var geoOk = RE.isInDoanDong(p.latitude, p.longitude);
      var tx = RE.TRANSACTIONS[p.transaction];
      return '<tr data-id="' + RE.escapeHTML(p.id) + '"' + (p.id === state.editingId ? ' class="is-editing"' : "") + ">" +
        "<td>" + RE.escapeHTML(p.id) + "</td>" +
        '<td><span class="st st-' + RE.escapeHTML(p.status) + '">' + RE.escapeHTML(RE.STATUSES[p.status] || p.status) + "</span></td>" +
        "<td>" + RE.escapeHTML(tx ? tx.label : "?") + "</td>" +
        "<td>" + RE.escapeHTML(RE.PROPERTY_TYPES[p.propertyType] || "?") + "</td>" +
        '<td class="title">' + RE.escapeHTML(p.title) + (p.featured ? " ⭐" : "") + "</td>" +
        "<td>" + RE.escapeHTML(RE.priceText(p)) + "</td>" +
        "<td>" + (geoOk ? '<span class="ok">✓ 도안동</span>' : '<span class="bad">✗ 좌표</span>') + "</td>" +
        "<td>" + RE.escapeHTML(p.lastCheckedAt || p.updatedAt || "") + "</td>" +
        '<td><button type="button" class="btn btn-line btn-sm" data-act="edit">수정</button> ' +
        '<button type="button" class="btn btn-line btn-sm" data-act="copy">복제</button></td></tr>';
    }).join("");
  }

  $("#list-filter").addEventListener("change", renderRows);
  $("#rows").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var id = btn.closest("tr").getAttribute("data-id");
    var src = state.items.filter(function (p) { return p.id === id; })[0];
    if (!src) return;
    if (btn.getAttribute("data-act") === "edit") openEditor(src);
    else {
      var copy = JSON.parse(JSON.stringify(src));
      copy.id = nextId();
      copy.title = src.title + " (복제)";
      copy.status = "hidden";
      copy.images = [];
      openEditor(copy, true);
    }
  });

  $("#new").addEventListener("click", function () {
    openEditor({
      id: nextId(), title: "", transaction: "sale", propertyType: "apartment", status: "hidden",
      addressDong: CFG.searchArea.dong, images: [], highlights: [], lastCheckedAt: today()
    }, true);
  });

  /* ---------- 편집기 ---------- */
  var form = $("#form");

  function openEditor(p, isNew) {
    state.editingId = p.id;
    state.isNew = !!isNew;
    $("#editor").hidden = false;
    $("#edit-id").textContent = p.id + (isNew ? " (새 매물)" : "");
    $("#delete").hidden = !!isNew;
    form.reset();
    $$("input, select, textarea", form).forEach(function (el) {
      if (!el.name) return;
      var v = p[el.name];
      if (el.type === "checkbox") el.checked = !!v;
      else if (el.name === "images" || el.name === "highlights") el.value = (v || []).join("\n");
      else el.value = v === null || v === undefined ? "" : v;
      el.classList.remove("invalid");
    });
    if (!form.lastCheckedAt.value) form.lastCheckedAt.value = today();
    $("#errors").innerHTML = "";
    syncTxFields();
    updateMoneyHints();
    renderThumbs();
    ensureMap();
    syncMarker(true);
    renderRows();
    $("#editor").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeEditor() {
    state.editingId = null;
    $("#editor").hidden = true;
    renderRows();
  }

  $("#cancel").addEventListener("click", closeEditor);

  function readForm() {
    var p = { id: state.editingId, addressDong: CFG.searchArea.dong };
    $$("input, select, textarea", form).forEach(function (el) {
      if (!el.name) return;
      var v = el.type === "checkbox" ? el.checked : el.value.trim();
      if (el.name === "images" || el.name === "highlights") {
        v = el.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      } else if (NUM_FIELDS.indexOf(el.name) >= 0) {
        v = v === "" ? null : Number(String(v).replace(/[,\s원]/g, ""));
      } else if (v === "") v = null;
      p[el.name] = v;
    });
    // 거래유형과 무관한 가격 필드는 비움
    if (p.transaction === "sale") { p.depositKRW = null; p.monthlyRentKRW = null; }
    if (p.transaction === "jeonse") { p.priceKRW = null; p.monthlyRentKRW = null; }
    if (p.transaction === "monthly") { p.priceKRW = null; }
    return p;
  }

  function isPosInt(v, max) { return typeof v === "number" && isFinite(v) && v > 0 && v <= max && Math.floor(v) === v; }

  /** 오류(err) / 경고(warn) 목록 반환 */
  function validate(p) {
    var out = [];
    function err(field, text) { out.push({ field: field, text: text }); }
    function warn(field, text) { out.push({ field: field, text: text, warn: true }); }

    if (!p.title || p.title.length < 2) err("title", "매물명을 2자 이상 입력하세요.");
    if (!RE.TRANSACTIONS[p.transaction]) err("transaction", "거래유형이 올바르지 않습니다.");
    if (!RE.PROPERTY_TYPES[p.propertyType]) err("propertyType", "매물종류가 올바르지 않습니다.");
    if (!RE.STATUSES[p.status]) err("status", "상태가 올바르지 않습니다.");

    var MAX = 100000000000; // 1,000억
    if (p.transaction === "sale" && !isPosInt(p.priceKRW, MAX)) err("priceKRW", "매매가를 원 단위 숫자로 입력하세요 (예: 750000000).");
    if ((p.transaction === "jeonse" || p.transaction === "monthly") && !(typeof p.depositKRW === "number" && p.depositKRW >= 0 && p.depositKRW <= MAX && (p.transaction === "monthly" || p.depositKRW > 0)))
      err("depositKRW", "보증금을 원 단위 숫자로 입력하세요.");
    if (p.transaction === "monthly" && !isPosInt(p.monthlyRentKRW, 100000000)) err("monthlyRentKRW", "월세를 원 단위 숫자로 입력하세요 (예: 800000).");
    if (p.priceKRW && p.priceKRW < 1000000) warn("priceKRW", "매매가가 100만원 미만입니다. 원 단위가 맞는지 확인하세요.");
    if (p.depositKRW && p.depositKRW < 100000) warn("depositKRW", "보증금이 10만원 미만입니다. 원 단위가 맞는지 확인하세요.");
    if (p.maintenanceFeeKRW !== null && !(p.maintenanceFeeKRW >= 0 && p.maintenanceFeeKRW < 10000000)) err("maintenanceFeeKRW", "관리비 범위를 확인하세요.");

    if (!(typeof p.areaM2 === "number" && p.areaM2 > 0 && p.areaM2 < 100000)) err("areaM2", "전용면적(㎡)을 입력하세요.");
    if (p.supplyAreaM2 !== null && !(p.supplyAreaM2 >= (p.areaM2 || 0) && p.supplyAreaM2 < 100000)) err("supplyAreaM2", "공급면적은 전용면적 이상이어야 합니다.");
    if (p.totalFloors !== null && !isPosInt(p.totalFloors, 200)) err("totalFloors", "총층은 1~200 사이 정수입니다.");
    if (p.floor && /^\d+$/.test(p.floor) && p.totalFloors && Number(p.floor) > p.totalFloors) err("floor", "해당층이 총층보다 큽니다.");
    if (p.rooms !== null && !(p.rooms >= 0 && p.rooms <= 30)) err("rooms", "방 수를 확인하세요.");
    if (p.baths !== null && !(p.baths >= 0 && p.baths <= 20)) err("baths", "욕실 수를 확인하세요.");

    var hasLat = p.latitude !== null, hasLng = p.longitude !== null;
    if (hasLat !== hasLng) err("latitude", "위도·경도를 모두 입력하세요.");
    else if (hasLat) {
      if (!(p.latitude > 33 && p.latitude < 39 && p.longitude > 124 && p.longitude < 132)) err("latitude", "좌표가 대한민국 범위를 벗어났습니다 (위도·경도 순서 확인).");
      else if (!RE.isInDoanDong(p.latitude, p.longitude)) err("latitude", "좌표가 도안동 경계 밖입니다. 도안동 매물만 게시할 수 있습니다.");
    } else if (p.status === "published") {
      warn("latitude", "좌표가 없으면 목록에만 표시되고 지도에는 표시되지 않습니다.");
    }

    (p.images || []).forEach(function (src) {
      if (!RE.isValidImagePath(src)) err("images", "사진 경로 형식 오류: " + src + " (assets/properties/파일명.webp|jpg|png, 영문·숫자·-_ 만)");
    });
    if (p.images && p.images.length > 20) err("images", "사진은 20장 이하로 등록하세요.");

    if (!p.lastCheckedAt || !/^\d{4}-\d{2}-\d{2}$/.test(p.lastCheckedAt)) err("lastCheckedAt", "최종 확인일을 입력하세요.");
    else if (p.status === "published" && (Date.now() - Date.parse(p.lastCheckedAt)) > 30 * 86400000)
      warn("lastCheckedAt", "최종 확인일이 30일 이상 지났습니다. 거래 가능 여부를 재확인하세요.");

    // 개인정보 노출 경고
    var text = [p.title, p.description].concat(p.highlights || []).join(" ");
    if (/\d{2,3}\s*동\s*\d{2,4}\s*호|\d{3,4}\s*호/.test(text)) warn("description", "동·호수로 보이는 정보가 있습니다. 정확한 호수는 공개하지 마세요.");
    if (/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/.test(text)) warn("description", "휴대전화 번호로 보이는 정보가 있습니다. 개인 연락처는 공개하지 마세요.");
    if (/임차인|세입자\s*[가-힣]{2,3}\s*(씨|님)/.test(text)) warn("description", "임차인 정보가 포함되어 있는지 확인하세요.");
    return out;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var p = readForm();
    var res = validate(p);
    $$(".invalid", form).forEach(function (el) { el.classList.remove("invalid"); });
    $("#errors").innerHTML = res.map(function (r) {
      return '<li class="' + (r.warn ? "warn" : "") + '">' + (r.warn ? "⚠ " : "") + RE.escapeHTML(r.text) + "</li>";
    }).join("");
    var errors = res.filter(function (r) { return !r.warn; });
    errors.forEach(function (r) { var el = form.elements[r.field]; if (el && el.classList) el.classList.add("invalid"); });
    if (errors.length) { msg("입력값을 확인하세요 (" + errors.length + "건).", true); return; }

    var idx = -1;
    state.items.forEach(function (x, i) { if (x.id === p.id) idx = i; });
    var prev = idx >= 0 ? state.items[idx] : null;
    p.updatedAt = prev && !priceChanged(prev, p) && prev.status === p.status ? (prev.updatedAt || today()) : today();
    if (!prev) p.updatedAt = today();
    // 추천매물은 하나만
    if (p.featured) state.items.forEach(function (x) { if (x.id !== p.id) x.featured = false; });
    var clean = normalizeOrder(p);
    if (idx >= 0) state.items[idx] = clean; else state.items.push(clean);
    state.isNew = false;
    state.dirty = true;
    saveDraft();
    $("#edit-id").textContent = p.id;
    $("#delete").hidden = false;
    renderRows();
    var warns = res.length - errors.length;
    msg(p.id + " 저장됨" + (warns ? " (경고 " + warns + "건 확인)" : "") + ". 게시하려면 [게시용 JSON 다운로드]를 누르세요.");
  });

  function priceChanged(a, b) {
    return a.priceKRW !== b.priceKRW || a.depositKRW !== b.depositKRW || a.monthlyRentKRW !== b.monthlyRentKRW;
  }

  $("#delete").addEventListener("click", function () {
    var id = state.editingId;
    if (!id || !confirm(id + " 매물을 목록에서 삭제할까요?\n(거래가 끝난 매물은 '거래완료' 상태로 두는 방법도 있습니다)")) return;
    state.items = state.items.filter(function (p) { return p.id !== id; });
    state.dirty = true;
    saveDraft();
    closeEditor();
    msg(id + " 삭제됨. [게시용 JSON 다운로드] 후 커밋해야 홈페이지에 반영됩니다.");
  });

  /* 거래유형별 가격 입력칸 표시 */
  function syncTxFields() {
    var tx = form.transaction.value;
    $$("[data-tx]", form).forEach(function (el) {
      el.hidden = el.getAttribute("data-tx").split(" ").indexOf(tx) === -1;
    });
  }
  form.transaction.addEventListener("change", syncTxFields);

  function updateMoneyHints() {
    ["priceKRW", "depositKRW", "monthlyRentKRW", "maintenanceFeeKRW"].forEach(function (name) {
      var raw = form.elements[name].value.replace(/[,\s원]/g, "");
      var hint = $('[data-hint="' + name + '"]', form);
      hint.textContent = raw && !isNaN(raw) ? "= " + RE.formatKRW(Number(raw)) : "";
    });
  }
  $$("[name=priceKRW],[name=depositKRW],[name=monthlyRentKRW],[name=maintenanceFeeKRW]", form).forEach(function (el) {
    el.addEventListener("input", updateMoneyHints);
  });

  /* ---------- 좌표 선택 지도 (OpenStreetMap / Leaflet) ---------- */
  function ensureMap() {
    if (map || !window.L) {
      if (!window.L) $("#pick-map").textContent = "지도 라이브러리를 불러오지 못했습니다. 위도·경도를 직접 입력하세요.";
      setTimeout(function () { if (map) map.invalidateSize(); }, 50);
      return;
    }
    var c = CFG.searchArea.center;
    map = L.map("pick-map", { center: [c.lat, c.lng], zoom: 15, minZoom: 13 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    var ring = RE.boundaryRing().map(function (pt) { return [pt[1], pt[0]]; });
    var poly = L.polygon(ring, { color: "#1f5fd6", weight: 3, fillOpacity: 0.08 }).addTo(map);
    map.fitBounds(poly.getBounds(), { padding: [10, 10] });
    map.on("click", function (e) {
      form.latitude.value = e.latlng.lat.toFixed(6);
      form.longitude.value = e.latlng.lng.toFixed(6);
      syncMarker(false);
    });
  }

  function syncMarker(pan) {
    var lat = parseFloat(form.latitude.value), lng = parseFloat(form.longitude.value);
    var ok = isFinite(lat) && isFinite(lng);
    var inside = ok && RE.isInDoanDong(lat, lng);
    var st = $("#geo-state");
    st.className = "geo-state " + (inside ? "ok" : ok ? "bad" : "");
    st.textContent = !ok ? "좌표 없음" : inside ? "✓ 도안동 경계 안" : "✗ 도안동 경계 밖 — 게시 불가";
    if (!map) return;
    if (!ok) { if (pickMarker) { pickMarker.remove(); pickMarker = null; } return; }
    if (!pickMarker) pickMarker = L.marker([lat, lng]).addTo(map);
    else pickMarker.setLatLng([lat, lng]);
    if (pan) map.setView([lat, lng], 16);
  }
  form.latitude.addEventListener("input", function () { syncMarker(true); });
  form.longitude.addEventListener("input", function () { syncMarker(true); });

  /* ---------- 사진: WebP 최적화 다운로드 ---------- */
  function renderThumbs() {
    var list = form.images.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    $("#thumbs").innerHTML = list.map(function (src) {
      var ok = RE.isValidImagePath(src);
      return "<figure><img src=\"../" + RE.escapeHTML(src) + "\" alt=\"\" onerror=\"this.style.opacity=.3\"><figcaption class=\"" + (ok ? "" : "bad") + "\">" + RE.escapeHTML(src) + "</figcaption></figure>";
    }).join("");
  }
  form.images.addEventListener("input", renderThumbs);

  function toWebP(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        var cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        // 캔버스 재인코딩으로 EXIF(GPS 등 메타데이터)도 제거됨
        cv.toBlob(function (b) { b ? resolve(b) : reject(new Error("변환 실패")); }, "image/webp", 0.82);
      };
      img.onerror = function () { reject(new Error("이미지를 읽을 수 없음: " + file.name)); };
      img.src = URL.createObjectURL(file);
    });
  }

  $("#photo-input").addEventListener("change", function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = "";
    if (!files.length || !state.editingId) return;
    var existing = form.images.value.split(/\r?\n/).filter(Boolean);
    var start = existing.length + 1;
    var id = state.editingId.replace(/[^A-Za-z0-9_-]/g, "");
    files.reduce(function (chain, file, i) {
      return chain.then(function () {
        return toWebP(file, 1600).then(function (blob) {
          var name = id + "-" + (start + i) + ".webp";
          downloadBlob(blob, name);
          existing.push("assets/properties/" + name);
        });
      });
    }, Promise.resolve()).then(function () {
      form.images.value = existing.join("\n");
      renderThumbs();
      msg(files.length + "장을 WebP로 변환해 다운로드했습니다. 저장소의 assets/properties/ 폴더로 옮겨 주세요.");
    }).catch(function (err) { msg(err.message, true); });
  });

  /* ---------- 시작 ---------- */
  window.addEventListener("beforeunload", function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  try {
    var draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (draft && Array.isArray(draft.items) && draft.items.length) {
      state.items = draft.items.map(normalizeOrder);
      msg("이전 작업(" + new Date(draft.savedAt).toLocaleString("ko-KR") + ")을 복원했습니다. 최신 저장소 파일로 시작하려면 [properties.json 불러오기]를 사용하세요.");
    }
  } catch (e) { /* 무시 */ }
  renderRows();
})();
