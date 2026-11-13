/* 지도 어댑터: NAVER Maps JS API v3 → (실패 시) OpenStreetMap/Leaflet
 * 공개 매물 중 도안동 경계 안 좌표만 마커로 표시한다. */
(function (global) {
  "use strict";

  var CFG = global.SITE_CONFIG;
  var RE = global.RE;
  var LEAFLET_VER = "1.9.4";
  var HOME_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3L12 3Z"/></svg>';

  var state = {
    provider: null,
    map: null,
    markers: {},   // id -> { marker, el, property }
    popup: null,
    selectedId: null,
    handlers: {}
  };

  /* ---------- 공통 ---------- */
  function loadScript(src, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      var timer = setTimeout(function () { reject(new Error("timeout: " + src)); }, timeoutMs || 10000);
      s.src = src;
      s.async = true;
      s.onload = function () { clearTimeout(timer); resolve(); };
      s.onerror = function () { clearTimeout(timer); reject(new Error("load error: " + src)); };
      document.head.appendChild(s);
    });
  }

  function loadCSS(href) {
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }

  function markerLabel(p) {
    var tx = RE.TRANSACTIONS[p.transaction] ? RE.TRANSACTIONS[p.transaction].label : "";
    var price;
    if (p.transaction === "monthly") price = RE.formatKRW(p.monthlyRentKRW, { short: true });
    else price = RE.priceText(p, true);
    return tx + " " + price;
  }

  function buildPinEl(p) {
    var el = document.createElement("div");
    el.className = "pin pin--" + p.transaction;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", p.title + " " + RE.TRANSACTIONS[p.transaction].label + " " + RE.priceText(p));
    el.innerHTML = '<span class="pin-label">' + HOME_ICON + RE.escapeHTML(markerLabel(p)) + '</span><span class="pin-dot"></span>';
    el.addEventListener("click", function (e) { e.stopPropagation(); select(p.id, { fromMap: true }); });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.id, { fromMap: true }); }
    });
    return el;
  }

  function popupHTML(p) {
    var img = (p.images && p.images[0]) || RE.placeholderImage(p.propertyType);
    var meta = [RE.areaText(p), RE.floorText(p)].filter(Boolean).join(" · ");
    return '<div class="map-popup">' +
      '<img src="' + RE.escapeHTML(img) + '" alt="" loading="lazy" onerror="this.src=\'' + RE.placeholderImage(p.propertyType) + '\'">' +
      '<div class="map-popup-body">' +
      '<span class="tag tag--' + p.transaction + '">' + RE.TRANSACTIONS[p.transaction].label + '</span> ' +
      '<span class="muted">' + RE.escapeHTML(RE.PROPERTY_TYPES[p.propertyType] || "") + '</span>' +
      '<p class="map-popup-price">' + RE.escapeHTML(RE.priceText(p)) + '</p>' +
      '<p class="map-popup-title">' + RE.escapeHTML(p.title) + '</p>' +
      '<p class="map-popup-meta">' + RE.escapeHTML(meta) + '</p>' +
      '<button type="button" class="btn btn-green" data-detail-id="' + RE.escapeHTML(p.id) + '">상세보기</button>' +
      '</div></div>';
  }

  function ringLatLng() {
    return RE.boundaryRing().map(function (pt) { return { lat: pt[1], lng: pt[0] }; });
  }

  function paddedBounds() {
    var b = RE.boundaryBBox();
    var padLat = (b.maxLat - b.minLat) * 0.6, padLng = (b.maxLng - b.minLng) * 0.6;
    return { south: b.minLat - padLat, west: b.minLng - padLng, north: b.maxLat + padLat, east: b.maxLng + padLng };
  }

  function centroid() {
    var c = CFG.searchArea.center;
    return { lat: c.lat, lng: c.lng };
  }

  // 도안동 바깥을 어둡게 처리할 외곽 사각형 (경계를 구멍으로 사용)
  var WORLD = [
    { lat: 37.5, lng: 126.0 }, { lat: 37.5, lng: 128.8 },
    { lat: 35.2, lng: 128.8 }, { lat: 35.2, lng: 126.0 }
  ];

  /* ---------- NAVER ---------- */
  function initNaver(el) {
    var clientId = CFG.map.naverClientId;
    if (!clientId) return Promise.reject(new Error("NAVER Client ID 미설정"));
    return new Promise(function (resolve, reject) {
      var settled = false;
      global.navermap_authFailure = function () {
        if (!settled) { settled = true; reject(new Error("NAVER 지도 인증 실패 (Client ID·서비스 URL 확인)")); }
        else if (state.handlers.onError) state.handlers.onError("네이버 지도 인증에 실패했습니다.");
      };
      var param = CFG.map.naverKeyParam || "ncpKeyId";
      loadScript("https://oapi.map.naver.com/openapi/v3/maps.js?" + param + "=" + encodeURIComponent(clientId), 10000)
        .then(function () {
          if (settled) return;
          var nv = global.naver && global.naver.maps;
          if (!nv) throw new Error("NAVER 지도 객체 없음");
          var b = paddedBounds();
          var c = centroid();
          var map = new nv.Map(el, {
            center: new nv.LatLng(c.lat, c.lng),
            zoom: CFG.searchArea.zoom || 15,
            minZoom: 13,
            maxBounds: new nv.LatLngBounds(new nv.LatLng(b.south, b.west), new nv.LatLng(b.north, b.east)),
            zoomControl: true,
            zoomControlOptions: { position: nv.Position.RIGHT_BOTTOM, style: nv.ZoomControlStyle.SMALL },
            scaleControl: true,
            mapDataControl: false,
            logoControlOptions: { position: nv.Position.BOTTOM_LEFT }
          });
          var ring = ringLatLng().map(function (p) { return new nv.LatLng(p.lat, p.lng); });
          new nv.Polygon({
            map: map,
            paths: [WORLD.map(function (p) { return new nv.LatLng(p.lat, p.lng); }), ring],
            fillColor: "#1b2733", fillOpacity: 0.18, strokeOpacity: 0, clickable: false
          });
          new nv.Polygon({
            map: map, paths: [ring],
            fillColor: "#5b7cfa", fillOpacity: 0.1,
            strokeColor: "#1f5fd6", strokeWeight: 3, strokeOpacity: 0.9, clickable: false
          });
          var bb = RE.boundaryBBox();
          map.fitBounds(new nv.LatLngBounds(new nv.LatLng(bb.minLat, bb.minLng), new nv.LatLng(bb.maxLat, bb.maxLng)), { top: 20, right: 20, bottom: 20, left: 20 });
          new nv.Marker({
            map: map, position: new nv.LatLng(c.lat, c.lng), clickable: false, zIndex: 1,
            icon: { content: '<div class="dong-label">' + RE.escapeHTML(CFG.searchArea.dong) + '</div>', anchor: new nv.Point(0, 0) }
          });
          state.popup = new nv.InfoWindow({
            content: "", borderWidth: 0, backgroundColor: "transparent", disableAnchor: true,
            pixelOffset: new nv.Point(0, -52), disableAutoPan: false
          });
          nv.Event.addListener(map, "click", function () { state.popup.close(); });
          settled = true;
          state.map = map;
          state.provider = "naver";
          resolve("naver");
        })
        .catch(function (err) { if (!settled) { settled = true; reject(err); } });
    });
  }

  var naverAdapter = {
    addMarker: function (p, el) {
      var nv = global.naver.maps;
      return new nv.Marker({
        map: state.map,
        position: new nv.LatLng(p.latitude, p.longitude),
        icon: { content: el, anchor: new nv.Point(0, 0) },
        zIndex: 100
      });
    },
    removeMarker: function (m) { m.setMap(null); },
    openPopup: function (m, html) { state.popup.setContent(html); state.popup.open(state.map, m); },
    closePopup: function () { if (state.popup) state.popup.close(); },
    panTo: function (p) { state.map.panTo(new global.naver.maps.LatLng(p.latitude, p.longitude)); },
    setZIndex: function (m, z) { m.setZIndex(z); },
    relayout: function () {
      var el = state.map.getElement();
      state.map.setSize(new global.naver.maps.Size(el.offsetWidth, el.offsetHeight));
    },
    credit: "지도: NAVER Maps"
  };

  /* ---------- Leaflet / OSM ---------- */
  function initLeaflet(el) {
    var base = "https://unpkg.com/leaflet@" + LEAFLET_VER + "/dist/";
    loadCSS(base + "leaflet.css");
    return loadScript(base + "leaflet.js", 10000).then(function () {
      var L = global.L;
      if (!L) throw new Error("Leaflet 로드 실패");
      var b = paddedBounds();
      var c = centroid();
      var map = L.map(el, {
        center: [c.lat, c.lng],
        zoom: CFG.searchArea.zoom || 15,
        minZoom: 13,
        maxZoom: 19,
        maxBounds: [[b.south, b.west], [b.north, b.east]],
        maxBoundsViscosity: 1.0,
        zoomControl: false
      });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }).addTo(map);
      var ring = ringLatLng().map(function (p) { return [p.lat, p.lng]; });
      L.polygon([WORLD.map(function (p) { return [p.lat, p.lng]; }), ring], {
        stroke: false, fillColor: "#1b2733", fillOpacity: 0.18, interactive: false
      }).addTo(map);
      var dongPoly = L.polygon(ring, {
        color: "#1f5fd6", weight: 3, opacity: 0.9, fillColor: "#5b7cfa", fillOpacity: 0.1, interactive: false
      }).addTo(map);
      map.fitBounds(dongPoly.getBounds(), { padding: [20, 20] });
      L.marker([c.lat, c.lng], {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: "pin-host", html: '<div class="dong-label">' + RE.escapeHTML(CFG.searchArea.dong) + '</div>', iconSize: [0, 0] })
      }).addTo(map);
      state.popup = L.popup({ offset: L.point(0, -52), closeButton: true, autoPanPadding: L.point(20, 60), maxWidth: 260, minWidth: 250 });
      state.map = map;
      state.provider = "leaflet";
      return "leaflet";
    });
  }

  var leafletAdapter = {
    addMarker: function (p, el) {
      var L = global.L;
      return L.marker([p.latitude, p.longitude], {
        icon: L.divIcon({ className: "pin-host", html: el, iconSize: [0, 0] }),
        keyboard: false,
        zIndexOffset: 100
      }).addTo(state.map);
    },
    removeMarker: function (m) { m.remove(); },
    openPopup: function (m, html) { state.popup.setLatLng(m.getLatLng()).setContent(html).openOn(state.map); },
    closePopup: function () { state.map.closePopup(); },
    panTo: function (p) { state.map.panTo([p.latitude, p.longitude]); },
    setZIndex: function (m, z) { m.setZIndexOffset(z); },
    relayout: function () { state.map.invalidateSize(); },
    credit: "지도: © OpenStreetMap contributors"
  };

  function adapter() { return state.provider === "naver" ? naverAdapter : leafletAdapter; }

  /* ---------- 공개 API ---------- */
  function init(el, handlers) {
    state.handlers = handlers || {};
    var mode = (CFG.map && CFG.map.provider) || "auto";
    var hasNaver = !!(CFG.map && CFG.map.naverClientId);

    // 팝업 안 '상세보기' 버튼 (이벤트 위임)
    el.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-detail-id]");
      if (btn && state.handlers.onDetail) state.handlers.onDetail(btn.getAttribute("data-detail-id"));
    });

    if (mode === "none") return Promise.reject(new Error("지도 사용 안 함"));
    if (mode === "leaflet" || (mode === "auto" && !hasNaver)) return initLeaflet(el);
    return initNaver(el).catch(function (err) {
      console.warn("[map] NAVER 지도 실패:", err.message);
      if (mode === "naver") throw err;
      el.innerHTML = "";
      return initLeaflet(el);
    });
  }

  function setProperties(list) {
    if (!state.map) return;
    var a = adapter();
    Object.keys(state.markers).forEach(function (id) { a.removeMarker(state.markers[id].marker); });
    state.markers = {};
    a.closePopup();
    list.forEach(function (p) {
      // 이중 안전장치: 경계 밖 좌표는 절대 마커로 만들지 않음
      if (!RE.isInDoanDong(p.latitude, p.longitude)) return;
      var el = buildPinEl(p);
      state.markers[p.id] = { marker: a.addMarker(p, el), el: el, property: p };
    });
    if (state.selectedId && state.markers[state.selectedId]) highlight(state.selectedId);
  }

  function highlight(id) {
    var a = adapter();
    Object.keys(state.markers).forEach(function (k) {
      var on = k === id;
      state.markers[k].el.classList.toggle("is-selected", on);
      a.setZIndex(state.markers[k].marker, on ? 1000 : 100);
    });
  }

  function select(id, opts) {
    opts = opts || {};
    state.selectedId = id;
    var entry = state.markers[id];
    if (!state.map || !entry) return;
    var a = adapter();
    highlight(id);
    if (opts.pan) a.panTo(entry.property);
    a.openPopup(entry.marker, popupHTML(entry.property));
    if (opts.fromMap && state.handlers.onSelect) state.handlers.onSelect(id);
  }

  function relayout() { if (state.map) adapter().relayout(); }

  global.MapView = {
    init: init,
    setProperties: setProperties,
    select: select,
    relayout: relayout,
    highlight: function (id) { if (state.map && state.markers[id]) highlight(id); },
    hasMarker: function (id) { return !!state.markers[id]; },
    credit: function () { return state.provider ? adapter().credit : ""; },
    provider: function () { return state.provider; }
  };
})(window);
