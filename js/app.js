/* 공개 사이트: 데이터 로드 · 필터/정렬 · 카드 목록 · 상세 모달 · 지도 동기화 */
(function (global) {
  "use strict";

  var CFG = global.SITE_CONFIG;
  var RE = global.RE;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var ICON_CHECK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1.2 13.6 6-6-1.4-1.4-4.6 4.6-2.2-2.2-1.4 1.4 3.6 3.6Z"/></svg>';
  var ICON_ARROW = '<svg class="ico card-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7-1.4-1.4 5.6-5.6-5.6-5.6L9 5Z"/></svg>';
  var ICON_PHONE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/></svg>';

  var state = {
    all: [],
    filtered: [],
    selectedId: null,
    mapReady: false,
    filters: { transaction: "all", propertyType: "all", keyword: "", priceMax: "", area: "", days: "" },
    sort: "recent"
  };

  /* ---------- 설정값 반영 ---------- */
  function getPath(obj, path) {
    return path.split(".").reduce(function (o, k) { return o ? o[k] : undefined; }, obj);
  }

  function applyConfig() {
    $$("[data-cfg]").forEach(function (el) {
      var v = getPath(CFG, el.getAttribute("data-cfg"));
      if (v) el.textContent = v;
    });
    $$("[data-cfg-tel]").forEach(function (el) { el.setAttribute("href", "tel:" + CFG.office.tel); });
    var legal = $("#footer-legal");
    var extra = [
      ["중개사무소 등록번호", CFG.office.registrationNumber],
      ["대표 공인중개사", CFG.office.representative],
      ["사업자등록번호", CFG.office.businessNumber]
    ];
    extra.forEach(function (pair) {
      if (!pair[1]) return;
      var li = document.createElement("li");
      li.textContent = pair[0] + ": " + pair[1];
      legal.appendChild(li);
    });
  }

  /* ---------- 데이터 ---------- */
  function isLocal() {
    var h = location.hostname;
    return location.protocol === "file:" || h === "localhost" || h === "127.0.0.1" || h === "" || h.endsWith(".local");
  }

  function useDemo() {
    var m = CFG.data.demoMode;
    if (m === true || m === false) return m;
    return isLocal();
  }

  function fetchJSON(url) {
    var sep = url.indexOf("?") >= 0 ? "&" : "?";
    // GitHub Pages 캐시(최대 10분)를 피하기 위해 매 요청마다 버전 파라미터 부여
    return fetch(url + sep + "v=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function loadData() {
    var demo = useDemo();
    var p = demo
      ? fetchJSON(CFG.data.demoUrl)
        .catch(function () { return fetchJSON(CFG.data.url); })
      : fetchJSON(CFG.data.url);
    return p.then(function (data) {
      if (!Array.isArray(data)) throw new Error("properties.json 형식 오류 (배열이 아님)");
      return data;
    });
  }

  /** 공개 + 도안동만. 좌표가 있으면 경계 검증 필수, 경계 밖이면 목록에서도 제외. */
  function sanitize(list) {
    var dong = CFG.searchArea.dong;
    return list.filter(function (p) {
      if (!p || p.status !== "published") return false;
      if (!RE.TRANSACTIONS[p.transaction]) return false;
      if (p.addressDong && p.addressDong !== dong) return false;
      var hasCoord = p.latitude !== null && p.latitude !== undefined && p.latitude !== "" &&
        p.longitude !== null && p.longitude !== undefined && p.longitude !== "";
      if (hasCoord && !RE.isInDoanDong(p.latitude, p.longitude)) {
        console.warn("[data] 도안동 경계 밖 좌표로 제외:", p.id);
        return false;
      }
      p._onMap = hasCoord;
      p.images = (p.images || []).filter(RE.isValidImagePath);
      return true;
    });
  }

  /* ---------- 필터/정렬 ---------- */
  function applyFilters() {
    var f = state.filters;
    var kw = f.keyword.trim().toLowerCase();
    var now = Date.now();
    var areaRange = f.area ? f.area.split("-").map(Number) : null;

    state.filtered = state.all.filter(function (p) {
      if (f.transaction !== "all" && p.transaction !== f.transaction) return false;
      if (f.propertyType !== "all" && p.propertyType !== f.propertyType) return false;
      if (f.priceMax) {
        var v = p.transaction === "sale" ? p.priceKRW : p.depositKRW;
        if (Number(v) > Number(f.priceMax)) return false;
      }
      if (areaRange) {
        var a = Number(p.areaM2) || 0;
        if (a < areaRange[0] || a >= areaRange[1]) return false;
      }
      if (f.days) {
        var t = Date.parse(p.updatedAt);
        if (!t || now - t > Number(f.days) * 86400000) return false;
      }
      if (kw) {
        var hay = [p.title, p.description, RE.PROPERTY_TYPES[p.propertyType], RE.TRANSACTIONS[p.transaction].label, (p.highlights || []).join(" ")]
          .join(" ").toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });

    var s = state.sort;
    state.filtered.sort(function (a, b) {
      if (s === "price-asc") return RE.priceValue(a) - RE.priceValue(b);
      if (s === "price-desc") return RE.priceValue(b) - RE.priceValue(a);
      if (s === "area-desc") return (b.areaM2 || 0) - (a.areaM2 || 0);
      if (s === "area-asc") return (a.areaM2 || 0) - (b.areaM2 || 0);
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || String(b.id).localeCompare(String(a.id));
    });

    renderList();
    if (state.mapReady) global.MapView.setProperties(state.filtered.filter(function (p) { return p._onMap; }));
  }

  /* ---------- 렌더링 ---------- */
  function thumb(p) {
    return (p.images && p.images[0]) || RE.placeholderImage(p.propertyType);
  }

  function imgTag(src, cls, type, alt) {
    return '<img class="' + cls + '" src="' + RE.escapeHTML(src) + '" alt="' + RE.escapeHTML(alt || "") + '" loading="lazy" ' +
      'onerror="this.onerror=null;this.src=\'' + RE.placeholderImage(type) + '\'">';
  }

  function metaParts(p) {
    var parts = [RE.areaText(p), RE.floorText(p)];
    var rooms = RE.roomsText(p);
    if (rooms) parts.push(rooms);
    else if (p.highlights && p.highlights[0]) parts.push(p.highlights[0]);
    return parts.filter(Boolean);
  }

  function renderList() {
    var ul = $("#cards");
    ul.setAttribute("aria-busy", "false");
    $("#result-count").textContent = state.filtered.length;
    $("#list-empty").hidden = state.filtered.length > 0;
    ul.innerHTML = state.filtered.map(function (p) {
      var tx = RE.TRANSACTIONS[p.transaction];
      return '<li class="card' + (p.id === state.selectedId ? " is-selected" : "") + '" data-id="' + RE.escapeHTML(p.id) + '">' +
        '<button type="button" class="card-btn" aria-label="' + RE.escapeHTML(p.title + " 상세보기") + '">' +
        imgTag(thumb(p), "card-thumb", p.propertyType, "") +
        '<span class="card-body">' +
        '<span class="card-tags"><span class="tag tag--' + p.transaction + '">' + tx.label + '</span>' +
        RE.escapeHTML(RE.PROPERTY_TYPES[p.propertyType] || "") + '</span>' +
        '<span class="card-title"">' + RE.escapeHTML(p.title) + '</span>' +
        '<span class="card-price"">' + RE.escapeHTML(RE.priceText(p)) + '</span>' +
        '<span class="card-meta">' + metaParts(p).map(function (m) { return "<span>" + RE.escapeHTML(m) + "</span>"; }).join("") + '</span>' +
        '</span>' + ICON_ARROW + '</button></li>';
    }).join("");
  }

  function renderFeatured() {
    var box = $("#featured");
    var p = state.all.filter(function (x) { return x.featured; })[0];
    if (!p) { box.hidden = true; return; }
    var points = (p.highlights || []).slice(0, 3);
    box.innerHTML =
      imgTag(thumb(p), "", p.propertyType, p.title + " 사진") +
      '<div><div class="card-tags"><span class="tag tag--featured">추천매물</span>' + RE.escapeHTML(RE.PROPERTY_TYPES[p.propertyType] || "") + '</div>' +
      '<h2 class="featured-title">' + RE.escapeHTML(p.title) + '</h2>' +
      '<p class="featured-price">' + RE.escapeHTML(RE.priceText(p)) + '</p>' +
      '<p class="card-meta">' + metaParts(p).map(function (m) { return "<span>" + RE.escapeHTML(m) + "</span>"; }).join("") + '</p></div>' +
      '<div class="featured-side">' +
      (points.length ? '<ul class="featured-points">' + points.map(function (t) { return "<li>" + ICON_CHECK + RE.escapeHTML(t) + "</li>"; }).join("") + "</ul>" : "") +
      '<button type="button" class="btn btn-line" data-open="' + RE.escapeHTML(p.id) + '">상세보기 ' + ICON_ARROW.replace("card-arrow", "") + '</button></div>';
    box.hidden = false;
  }

  /* ---------- 선택 / 동기화 ---------- */
  function setSelected(id, opts) {
    opts = opts || {};
    state.selectedId = id;
    $$("#cards .card").forEach(function (li) { li.classList.toggle("is-selected", li.getAttribute("data-id") === id); });
    if (opts.scrollCard) {
      var li = $('#cards .card[data-id="' + cssEscape(id) + '"]');
      var list = $("#cards");
      if (li && list.scrollHeight > list.clientHeight + 4) {
        list.scrollTo({ top: li.offsetTop - list.offsetTop - 8, behavior: "smooth" });
      }
    }
    if (opts.syncMap && state.mapReady && global.MapView.hasMarker(id)) global.MapView.select(id, { pan: true });
  }

  function cssEscape(s) { return global.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }

  function findById(id) {
    for (var i = 0; i < state.all.length; i++) if (state.all[i].id === id) return state.all[i];
    return null;
  }

  /* ---------- 상세 모달 ---------- */
  var lastFocus = null;

  function openDetail(id) {
    var p = findById(id);
    if (!p) return;
    lastFocus = document.activeElement;
    var dlg = $("#detail");
    var imgs = p.images && p.images.length ? p.images : [RE.placeholderImage(p.propertyType)];
    var tx = RE.TRANSACTIONS[p.transaction];
    var rows = [
      ["거래유형", tx.label],
      ["매물종류", RE.PROPERTY_TYPES[p.propertyType]],
      ["가격", RE.priceText(p)],
      ["면적", RE.areaText(p)],
      ["층", RE.floorText(p)],
      ["방 / 욕실", RE.roomsText(p)],
      ["관리비", p.maintenanceFeeKRW ? "월 " + RE.formatKRW(p.maintenanceFeeKRW) : ""],
      ["입주 가능일", p.moveInDate],
      ["위치", "대전 서구 " + (p.addressDong || CFG.searchArea.dong) + " (상세 위치는 상담 시 안내)"],
      ["매물번호", p.id],
      ["최종 확인일", p.lastCheckedAt || p.updatedAt]
    ].filter(function (r) { return r[1]; });

    $("#detail-body").innerHTML =
      '<button type="button" class="detail-close" data-close aria-label="닫기">×</button>' +
      '<div class="detail-gallery" data-index="0">' +
      imgTag(imgs[0], "", p.propertyType, p.title + " 사진 1") +
      (imgs.length > 1 ? '<button type="button" class="gallery-nav gallery-prev" data-gal="-1" aria-label="이전 사진">‹</button>' +
        '<button type="button" class="gallery-nav gallery-next" data-gal="1" aria-label="다음 사진">›</button>' +
        '<span class="gallery-count">1 / ' + imgs.length + '</span>' : "") +
      '</div>' +
      '<div class="detail-content">' +
      '<div class="card-tags"><span class="tag tag--' + p.transaction + '">' + tx.label + '</span>' + RE.escapeHTML(RE.PROPERTY_TYPES[p.propertyType] || "") + '</div>' +
      '<h2 id="detail-title">' + RE.escapeHTML(p.title) + '</h2>' +
      '<p class="detail-price">' + RE.escapeHTML(RE.priceText(p)) + '</p>' +
      '<dl class="detail-table">' + rows.map(function (r) { return "<dt>" + RE.escapeHTML(r[0]) + "</dt><dd>" + RE.escapeHTML(r[1]) + "</dd>"; }).join("") + '</dl>' +
      (p.description ? '<p class="detail-desc">' + RE.escapeHTML(p.description) + '</p>' : "") +
      '<div class="detail-actions">' +
      '<a class="btn btn-green btn-lg" href="tel:' + CFG.office.tel + '">' + ICON_PHONE + ' 전화 문의 ' + RE.escapeHTML(CFG.office.phone) + '</a>' +
      (p._onMap && state.mapReady ? '<button type="button" class="btn btn-line" data-show-map="' + RE.escapeHTML(p.id) + '">지도에서 위치 보기</button>' : "") +
      '</div>' +
      '<p class="detail-note">매물번호 <strong>' + RE.escapeHTML(p.id) + '</strong>를 말씀해 주시면 빠르게 안내해 드립니다. 가격·조건은 변동될 수 있습니다.</p>' +
      '</div>';

    var gal = $(".detail-gallery", dlg);
    $$("[data-gal]", dlg).forEach(function (b) {
      b.addEventListener("click", function () {
        var i = (Number(gal.getAttribute("data-index")) + Number(b.getAttribute("data-gal")) + imgs.length) % imgs.length;
        gal.setAttribute("data-index", i);
        var im = $("img", gal);
        im.src = imgs[i];
        im.alt = p.title + " 사진 " + (i + 1);
        $(".gallery-count", gal).textContent = (i + 1) + " / " + imgs.length;
      });
    });

    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    $(".detail-close", dlg).focus();
    history.replaceState(null, "", "#property=" + encodeURIComponent(p.id));
  }

  function closeDetail() {
    var dlg = $("#detail");
    if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
  }

  /* ---------- 이벤트 ---------- */
  function bindEvents() {
    $$(".chips").forEach(function (group) {
      var key = group.getAttribute("data-filter");
      group.addEventListener("click", function (e) {
        var btn = e.target.closest(".chip");
        if (!btn) return;
        $$(".chip", group).forEach(function (c) {
          var on = c === btn;
          c.classList.toggle("is-active", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        state.filters[key] = btn.getAttribute("data-value");
        applyFilters();
      });
    });

    var kwTimer;
    $("#keyword").addEventListener("input", function (e) {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(function () { state.filters.keyword = e.target.value; applyFilters(); }, 180);
    });
    $("#sort").addEventListener("change", function (e) { state.sort = e.target.value; applyFilters(); });
    $("#f-price-max").addEventListener("change", function (e) { state.filters.priceMax = e.target.value; applyFilters(); });
    $("#f-area").addEventListener("change", function (e) { state.filters.area = e.target.value; applyFilters(); });
    $("#f-date").addEventListener("change", function (e) { state.filters.days = e.target.value; applyFilters(); });
    $("#f-reset").addEventListener("click", function () {
      state.filters = { transaction: "all", propertyType: "all", keyword: "", priceMax: "", area: "", days: "" };
      $$(".chips .chip").forEach(function (c) {
        var on = c.getAttribute("data-value") === "all";
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
      $("#keyword").value = ""; $("#f-price-max").value = ""; $("#f-area").value = ""; $("#f-date").value = "";
      applyFilters();
    });

    // 카드: 클릭 → 지도 선택 + 상세, 호버 → 지도 마커 강조
    var cards = $("#cards");
    cards.addEventListener("click", function (e) {
      var li = e.target.closest(".card");
      if (!li) return;
      var id = li.getAttribute("data-id");
      setSelected(id, { syncMap: true });
      openDetail(id);
    });
    cards.addEventListener("mouseover", function (e) {
      var li = e.target.closest(".card");
      if (!li || !state.mapReady) return;
      var id = li.getAttribute("data-id");
      if (global.MapView.hasMarker(id)) global.MapView.highlight(id);
    });

    document.addEventListener("click", function (e) {
      var open = e.target.closest("[data-open]");
      if (open) { openDetail(open.getAttribute("data-open")); return; }
      var showMap = e.target.closest("[data-show-map]");
      if (showMap) {
        var id = showMap.getAttribute("data-show-map");
        closeDetail();
        $("#map-panel").scrollIntoView({ behavior: "smooth", block: "center" });
        setSelected(id, { syncMap: true, scrollCard: true });
      }
    });

    var dlg = $("#detail");
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg || e.target.closest("[data-close]")) closeDetail();
    });
    dlg.addEventListener("close", function () {
      if (location.hash.indexOf("#property=") === 0) history.replaceState(null, "", location.pathname + location.search);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    });

    // 지도 확대
    var panel = $("#map-panel"), expand = $("#map-expand");
    function setExpanded(on) {
      panel.classList.toggle("is-expanded", on);
      expand.setAttribute("aria-pressed", on ? "true" : "false");
      expand.setAttribute("aria-label", on ? "지도 원래 크기로" : "지도 크게 보기");
      document.body.style.overflow = on ? "hidden" : "";
      setTimeout(global.MapView.relayout, 50);
    }
    expand.addEventListener("click", function () { setExpanded(!panel.classList.contains("is-expanded")); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("is-expanded") && !dlg.open) setExpanded(false);
    });

    // 메뉴 활성 표시
    var navLinks = $$(".main-nav a");
    if ("IntersectionObserver" in global) {
      var targets = ["#top", "#search", "#location"].map(function (s) { return $(s); });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var id = "#" + en.target.id;
          navLinks.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === id); });
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      targets.forEach(function (t) { if (t) io.observe(t); });
    }
  }

  /* ---------- 지도 ---------- */
  function initMap() {
    var status = $("#map-status");
    global.MapView.init($("#map"), {
      onSelect: function (id) { setSelected(id, { scrollCard: true }); },
      onDetail: function (id) { openDetail(id); },
      onError: function (msg) { showMapError(msg); }
    }).then(function () {
      state.mapReady = true;
      status.hidden = true;
      $("#map-credit").textContent = global.MapView.credit();
      if (state.all.length) applyFilters();
    }).catch(function (err) {
      console.warn("[map]", err);
      showMapError(err && err.message);
    });
  }

  function showMapError() {
    var status = $("#map-status");
    status.hidden = false;
    status.innerHTML = '<div><p><strong>지도를 불러오지 못했습니다.</strong></p>' +
      '<p>매물 목록과 전화 상담은 정상적으로 이용하실 수 있습니다.</p>' +
      '<a class="btn btn-green" href="#listings">매물 목록 보기</a></div>';
  }

  /* ---------- 시작 ---------- */
  function start() {
    applyConfig();
    bindEvents();
    initMap();
    loadData().then(function (raw) {
      state.all = sanitize(raw);
      renderFeatured();
      applyFilters();
      var m = location.hash.match(/^#property=(.+)$/);
      if (m) openDetail(decodeURIComponent(m[1]));
    }).catch(function (err) {
      console.error("[data]", err);
      $("#cards").innerHTML = "";
      $("#cards").setAttribute("aria-busy", "false");
      $("#list-error").hidden = false;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(window);
