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

  var state = { items: [], editingId: null, dirty: false, baseSha: null, pending: {} };
  var map, pickMarker;

  /* ---------- 유틸 ---------- */
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function msg(text, isErr, sticky, link) {
    var box = $("#msg");
    box.innerHTML = '<div class="m' + (isErr ? " err" : "") + '">' + RE.escapeHTML(text) +
      (link ? ' <a href="' + RE.escapeHTML(link.href) + '" target="_blank" rel="noopener">' + RE.escapeHTML(link.text) + "</a>" : "") + "</div>";
    clearTimeout(msg.t);
    if (!sticky) msg.t = setTimeout(function () { box.innerHTML = ""; }, isErr ? 12000 : 5000);
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
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), items: state.items, baseSha: state.baseSha, dirty: state.dirty })); } catch (e) { /* 무시 */ }
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
    state.baseSha = null;
    state.pending = {};
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

  /** 게시 가능 여부: 문제가 있으면 오류 문구 반환 */
  function checkPublishable() {
    var problems = [];
    state.items.forEach(function (p) {
      var errs = validate(p).filter(function (e) { return !e.warn; });
      if (errs.length && p.status === "published") problems.push(p.id + ": " + errs[0].text);
    });
    if (problems.length) return "공개 매물에 오류가 있습니다 → " + problems.slice(0, 3).join(" / ");
    var ids = {};
    var dup = state.items.filter(function (p) { if (ids[p.id]) return true; ids[p.id] = 1; return false; });
    if (dup.length) return "중복된 매물번호가 있습니다: " + dup.map(function (p) { return p.id; }).join(", ");
    return null;
  }

  function exportData() {
    return state.items.map(normalizeOrder).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  }

  $("#export").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(exportData(), null, 2) + "\n"], { type: "application/json" });
    downloadBlob(blob, "properties.json");
    msg("백업용 properties.json을 다운로드했습니다. (홈페이지 반영은 [홈페이지에 게시]로 합니다)");
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
      var pending = state.pending[src];
      var url = pending ? URL.createObjectURL(pending) : "../" + src;
      var live = (CFG.github && CFG.github.pagesUrl || "") + src;
      return "<figure><img src=\"" + RE.escapeHTML(url) + "\" alt=\"\" data-live=\"" + RE.escapeHTML(live) + "\" " +
        "onerror=\"if(this.dataset.live&&this.src!==this.dataset.live){this.src=this.dataset.live}else{this.style.opacity=.3}\">" +
        "<figcaption class=\"" + (ok ? "" : "bad") + "\">" + (pending ? "⬆ 게시 대기 · " : "") + RE.escapeHTML(src) + "</figcaption></figure>";
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
          var name = id + "-" + Date.now().toString(36) + "-" + (start + i) + ".webp";
          var path = "assets/properties/" + name;
          state.pending[path] = blob;
          if (!ghToken()) downloadBlob(blob, name);
          existing.push(path);
        });
      });
    }, Promise.resolve()).then(function () {
      form.images.value = existing.join("\n");
      renderThumbs();
      state.dirty = true;
      msg(ghToken()
        ? files.length + "장을 최적화했습니다. [검증 후 저장] → [홈페이지에 게시]를 누르면 함께 올라갑니다."
        : files.length + "장을 WebP로 변환해 다운로드했습니다. GitHub 연결 전이므로 저장소의 assets/properties/ 폴더로 직접 옮겨야 합니다.");
    }).catch(function (err) { msg(err.message, true); });
  });


  /* ---------- GitHub 직접 게시 ---------- */
  var GH = CFG.github || {};
  var API = "https://api.github.com";
  var TOKEN_KEY = "doan-admin-gh-token";
  var DATA_PATH = CFG.data.url; // data/properties.json

  function ghToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function setToken(t, remember) {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
    } catch (e) { /* 저장 불가 환경 */ }
    updateGhState();
  }

  function repoPath() { return "/repos/" + encodeURIComponent(GH.owner) + "/" + encodeURIComponent(GH.repo); }

  function ghErrorText(status, data) {
    var detail = data && data.message ? " (" + data.message + ")" : "";
    if (status === 401) return "토큰이 올바르지 않거나 만료되었습니다. [GitHub 연결 설정]에서 토큰을 다시 입력하세요.";
    if (status === 403) return "권한이 없습니다. 토큰의 저장소 선택과 Contents 'Read and write' 권한을 확인하세요." + detail;
    if (status === 404) return "저장소를 찾을 수 없거나 토큰에 이 저장소 접근 권한이 없습니다." + detail;
    if (status === 409 || status === 422) return "그 사이 저장소가 변경되었습니다. 잠시 후 다시 [홈페이지에 게시]를 눌러 주세요." + detail;
    return "GitHub 오류 " + status + detail;
  }

  function gh(method, path, body) {
    var headers = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    var t = ghToken();
    if (t) headers.Authorization = "Bearer " + t;
    if (body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" })
      .catch(function () { throw new Error("인터넷 연결을 확인하세요. (GitHub에 접속할 수 없음)"); })
      .then(function (r) {
        return r.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* 무시 */ }
          if (!r.ok) { var err = new Error(ghErrorText(r.status, data)); err.status = r.status; throw err; }
          return data;
        });
      });
  }

  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function b64ToUtf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1]); };
      r.onerror = function () { reject(new Error("사진을 읽을 수 없습니다.")); };
      r.readAsDataURL(blob);
    });
  }

  function updateGhState() {
    var on = !!ghToken();
    var el = $("#gh-state");
    el.textContent = on ? "● GitHub 연결됨" : "○ GitHub 미연결";
    el.classList.toggle("on", on);
  }

  /* 저장소에서 불러오기 */
  function ghLoad(silent) {
    if (state.dirty && !confirm("게시하지 않은 작업이 있습니다. 저장소의 데이터로 덮어쓸까요?")) return Promise.resolve();
    msg("저장소에서 매물을 불러오는 중…", false, true);
    return gh("GET", repoPath() + "/contents/" + DATA_PATH + "?ref=" + encodeURIComponent(GH.branch))
      .then(function (d) {
        if (!d || !d.content) throw new Error("매물 파일 내용을 읽을 수 없습니다.");
        setItems(JSON.parse(b64ToUtf8(d.content)), "GitHub 저장소(홈페이지 현재 데이터)");
        state.baseSha = d.sha;
      })
      .catch(function (e) { msg("불러오기 실패: " + e.message, true, !silent); });
  }

  function commitMessage(data) {
    var pub = data.filter(function (p) { return p.status === "published"; }).length;
    return "매물 업데이트: 전체 " + data.length + "건 (공개 " + pub + "건) — 관리자 화면에서 게시";
  }

  /* 홈페이지에 게시: 매물 데이터 + 새 사진을 커밋 1개로 올림 */
  function ghPublish() {
    if (!ghToken()) { openGhDialog(); msg("먼저 GitHub 연결(토큰)을 설정하세요.", true); return; }
    if (state.editingId && !$("#editor").hidden && !confirm("편집 중인 매물은 [검증 후 저장]을 눌러야 게시에 포함됩니다. 저장된 내용만 게시할까요?")) return;
    var problem = checkPublishable();
    if (problem) { msg(problem, true, true); return; }
    if (!state.items.length && !confirm("매물이 0건입니다. 홈페이지의 매물을 모두 비울까요?")) return;

    var btn = $("#gh-publish");
    btn.disabled = true;
    var data = exportData();
    var json = JSON.stringify(data, null, 2) + "\n";
    var branch = encodeURIComponent(GH.branch);
    var headSha, baseTree, remoteSha, newDataSha, uploads = [];

    msg("게시 준비 중… (저장소 상태 확인)", false, true);
    gh("GET", repoPath() + "/git/ref/heads/" + branch)
      .then(function (ref) { headSha = ref.object.sha; return gh("GET", repoPath() + "/git/commits/" + headSha); })
      .then(function (c) { baseTree = c.tree.sha; return gh("GET", repoPath() + "/git/trees/" + baseTree + "?recursive=1"); })
      .then(function (tree) {
        var existing = {};
        tree.tree.forEach(function (e) { if (e.type === "blob") existing[e.path] = e.sha; });
        remoteSha = existing[DATA_PATH] || null;
        if (state.baseSha && remoteSha && state.baseSha !== remoteSha) {
          throw new Error("다른 곳(다른 PC 등)에서 매물 데이터가 먼저 바뀌었습니다. 덮어쓰지 않도록 게시를 멈췄습니다. " +
            "[더보기 → 백업 JSON 다운로드]로 지금 작업을 보관한 뒤 [저장소에서 불러오기]로 최신 데이터를 받아 다시 반영하세요.");
        }
        if (!state.baseSha && !confirm("홈페이지의 매물 데이터를 이 화면의 " + data.length + "건으로 바꿉니다. 계속할까요?\n(다른 곳에서 바뀐 내용이 있다면 사라집니다. 가능하면 [저장소에서 불러오기]로 시작하세요)")) {
          var cancel = new Error("게시를 취소했습니다."); cancel.cancelled = true; throw cancel;
        }
        var needed = {};
        data.forEach(function (p) { (p.images || []).forEach(function (src) { needed[src] = true; }); });
        var missing = Object.keys(needed).filter(function (src) { return !state.pending[src] && !existing[src]; });
        if (missing.length) {
          throw new Error("올라가 있지 않은 사진이 있습니다: " + missing.slice(0, 3).join(", ") +
            (missing.length > 3 ? " 외 " + (missing.length - 3) + "개" : "") + " — 해당 매물에서 사진을 다시 선택하거나 경로를 지우세요.");
        }
        uploads = Object.keys(state.pending).filter(function (src) { return needed[src]; });
        return uploads.reduce(function (chain, src, i) {
          return chain.then(function (entries) {
            msg("사진 올리는 중… (" + (i + 1) + "/" + uploads.length + ")", false, true);
            return blobToB64(state.pending[src])
              .then(function (b64) { return gh("POST", repoPath() + "/git/blobs", { content: b64, encoding: "base64" }); })
              .then(function (b) { entries.push({ path: src, mode: "100644", type: "blob", sha: b.sha }); return entries; });
          });
        }, Promise.resolve([]));
      })
      .then(function (entries) {
        msg("매물 데이터 올리는 중…", false, true);
        return gh("POST", repoPath() + "/git/blobs", { content: utf8ToB64(json), encoding: "base64" }).then(function (b) {
          newDataSha = b.sha;
          if (newDataSha === remoteSha && !entries.length) {
            var same = new Error("홈페이지와 비교해 바뀐 내용이 없습니다."); same.cancelled = true; throw same;
          }
          entries.push({ path: DATA_PATH, mode: "100644", type: "blob", sha: newDataSha });
          return gh("POST", repoPath() + "/git/trees", { base_tree: baseTree, tree: entries });
        });
      })
      .then(function (t) { return gh("POST", repoPath() + "/git/commits", { message: commitMessage(data), tree: t.sha, parents: [headSha] }); })
      .then(function (c) {
        return gh("PATCH", repoPath() + "/git/refs/heads/" + branch, { sha: c.sha, force: false }).then(function () { return c.sha; });
      })
      .then(function (commitSha) {
        state.baseSha = newDataSha;
        state.pending = {};
        state.dirty = false;
        saveDraft();
        renderThumbs();
        msg("게시했습니다. 홈페이지에 반영 중… (보통 1~3분)", false, true);
        watchDeploy(commitSha, Date.now());
      })
      .catch(function (e) {
        if (e.cancelled) msg(e.message);
        else msg("게시 실패: " + e.message, true, true);
      })
      .then(function () { btn.disabled = false; });
  }

  /* 배포(GitHub Actions) 진행 상황 확인 */
  function watchDeploy(sha, startedAt) {
    var site = { href: GH.pagesUrl, text: "홈페이지 열기" };
    if (Date.now() - startedAt > 6 * 60 * 1000) {
      msg("게시는 완료됐습니다. 홈페이지 반영이 늦어지고 있으니 잠시 후 새로고침해 보세요.", false, true, site);
      return;
    }
    gh("GET", repoPath() + "/actions/runs?head_sha=" + sha + "&per_page=1")
      .then(function (d) {
        var run = d && d.workflow_runs && d.workflow_runs[0];
        if (run && run.status === "completed") {
          if (run.conclusion === "success") msg("✓ 홈페이지에 반영되었습니다. 열려 있는 홈페이지는 새로고침하세요.", false, true, site);
          else msg("배포 중 문제가 생겼습니다 (" + run.conclusion + "). 데이터는 올라갔으니 잠시 후 다시 게시하거나 담당자에게 문의하세요.", true, true, { href: run.html_url, text: "배포 기록 보기" });
          return;
        }
        msg("게시했습니다. 홈페이지 반영 중… (" + (run ? (run.status === "queued" ? "대기" : "배포 진행") : "시작 대기") + ")", false, true);
        setTimeout(function () { watchDeploy(sha, startedAt); }, 6000);
      })
      .catch(function () {
        // Actions 읽기 권한이 없는 토큰이면 상태 확인 생략
        msg("게시했습니다. 1~3분 뒤 홈페이지를 새로고침하면 반영됩니다.", false, true, site);
      });
  }

  /* 연결 설정 창 */
  function openGhDialog() {
    var dlg = $("#gh-dialog");
    $("#gh-repo-name").textContent = GH.owner + "/" + GH.repo + " (" + GH.branch + ")";
    $("#gh-token").value = "";
    $("#gh-token").placeholder = ghToken() ? "저장된 토큰 있음 — 바꾸려면 새 토큰 입력" : "github_pat_...";
    $("#gh-test-result").textContent = "";
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }

  $("#gh-state").addEventListener("click", openGhDialog);
  $("#gh-settings").addEventListener("click", function () { $(".more").open = false; openGhDialog(); });
  $("#gh-load").addEventListener("click", function () {
    if (!GH.owner) { msg("js/config.js의 github 설정이 비어 있습니다.", true); return; }
    ghLoad(false);
  });
  $("#gh-publish").addEventListener("click", ghPublish);
  $("#gh-forget").addEventListener("click", function () {
    setToken("", false);
    $("#gh-test-result").textContent = "이 PC에서 토큰을 삭제했습니다.";
  });
  $("#gh-save").addEventListener("click", function () {
    var input = $("#gh-token").value.trim();
    var out = $("#gh-test-result");
    if (input) {
      if (!/^(github_pat_|ghp_)[A-Za-z0-9_]+$/.test(input)) { out.className = "gh-test-result bad"; out.textContent = "토큰 형식이 아닙니다. github_pat_ 로 시작하는 값을 그대로 붙여넣으세요."; return; }
      setToken(input, $("#gh-remember").checked);
    }
    if (!ghToken()) { out.className = "gh-test-result bad"; out.textContent = "토큰을 입력하세요."; return; }
    out.className = "gh-test-result"; out.textContent = "연결 확인 중…";
    gh("GET", repoPath())
      .then(function (repo) {
        if (repo.permissions && repo.permissions.push === false) throw new Error("이 계정은 저장소에 쓰기 권한이 없습니다.");
        out.className = "gh-test-result ok";
        out.textContent = "✓ 연결되었습니다: " + repo.full_name + ". 이제 [홈페이지에 게시]를 사용할 수 있습니다. (쓰기 권한은 첫 게시 때 최종 확인됩니다)";
        $("#gh-token").value = "";
        if (!state.items.length && !state.dirty) ghLoad(true);
      })
      .catch(function (e) { out.className = "gh-test-result bad"; out.textContent = "✗ " + e.message; });
  });

  /* ---------- 시작 ---------- */
  window.addEventListener("beforeunload", function (e) {
    if (state.dirty || Object.keys(state.pending).length) { e.preventDefault(); e.returnValue = ""; }
  });

  try {
    var draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (draft && draft.dirty !== false && Array.isArray(draft.items) && draft.items.length) {
      state.items = draft.items.map(normalizeOrder);
      state.baseSha = draft.baseSha || null;
      state.dirty = true;
      msg("게시하지 않은 이전 작업(" + new Date(draft.savedAt).toLocaleString("ko-KR") + ")을 복원했습니다. 이어서 [홈페이지에 게시]하거나, 버리려면 [저장소에서 불러오기]를 누르세요. (사진은 다시 선택해야 할 수 있습니다)", false, true);
    }
  } catch (e) { /* 무시 */ }
  renderRows();
  updateGhState();
  if (ghToken() && !state.items.length) ghLoad(true);
})();
