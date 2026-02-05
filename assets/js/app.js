/* =========================================================
   0) エラー見える化（真っ黒になった時に原因が分かる）
========================================================= */
window.addEventListener("error", (e) => {
  console.error("JS Error:", e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("Promise Rejection:", e.reason);
});

/* =========================================================
   1) パネル最小化（存在チェック付き）
========================================================= */
(() => {
  const panel = document.getElementById("panel");
  const panelToggle = document.getElementById("panelToggle");
  if (!panel || !panelToggle) return;

  const saved = localStorage.getItem("panelCollapsed");
  if (saved === "1") {
    panel.classList.add("collapsed");
    panelToggle.textContent = "＋";
    panelToggle.setAttribute("aria-expanded", "false");
  }

  panelToggle.addEventListener("click", () => {
    const isCollapsed = panel.classList.toggle("collapsed");
    panelToggle.textContent = isCollapsed ? "＋" : "－";
    panelToggle.setAttribute("aria-expanded", String(!isCollapsed));
    localStorage.setItem("panelCollapsed", isCollapsed ? "1" : "0");
  });
})();

/* =========================================================
   2) Leafletが読み込めてるか確認（黒画面対策）
========================================================= */
if (!window.L) {
  alert("Leafletが読み込めていません。index.html の <link>/<script> を確認してください。");
  throw new Error("Leaflet not loaded");
}

/* =========================================================
   3) 地図のベース
========================================================= */
const map = L.map("map", { center: [36.055, 139.07], zoom: 13 });

/* ===== レイヤ順固定：Pane（上→下） ===== */
map.createPane("basemapPane");   map.getPane("basemapPane").style.zIndex = 200;
map.createPane("ecodrrPane");    map.getPane("ecodrrPane").style.zIndex = 450;
map.createPane("districtPane");  map.getPane("districtPane").style.zIndex = 650;
map.createPane("pointsPane");    map.getPane("pointsPane").style.zIndex = 700;

/* パネル内クリックで地図が動かない */
const panelEl = document.getElementById("panel");
if (panelEl) L.DomEvent.disableClickPropagation(panelEl);

/* =========================================================
   4) 背景レイヤ（OSM / 地理院標準 / 地理院航空写真）
========================================================= */
const baseOSM = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  pane: "basemapPane",
  attribution: "&copy; OpenStreetMap contributors"
});

const baseGSIStd = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
  maxZoom: 18,
  pane: "basemapPane",
  attribution: "出典：国土地理院（地理院タイル）"
});

const baseGSIAerial = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", {
  maxZoom: 18,
  pane: "basemapPane",
  attribution: "出典：国土地理院（地理院タイル）"
});

/* 背景はパネルで確実に切替 */
const baseSelect = document.getElementById("baseSelect");
const baseOpacityEl = document.getElementById("baseOpacity");

function setBaseLayer(key) {
  map.removeLayer(baseOSM);
  map.removeLayer(baseGSIStd);
  map.removeLayer(baseGSIAerial);

  if (key === "osm") baseOSM.addTo(map);
  if (key === "gsiStd") baseGSIStd.addTo(map);
  if (key === "gsiAir") baseGSIAerial.addTo(map);

  localStorage.setItem("baseKey", key);
}

const savedBaseKey = localStorage.getItem("baseKey") || "gsiStd";
setBaseLayer(savedBaseKey);
if (baseSelect) baseSelect.value = savedBaseKey;

if (baseSelect) baseSelect.addEventListener("change", (e) => setBaseLayer(e.target.value));

if (baseOpacityEl) {
  baseOpacityEl.addEventListener("input", (e) => {
    const v = Number(e.target.value);
    baseOSM.setOpacity(v);
    baseGSIStd.setOpacity(v);
    baseGSIAerial.setOpacity(v);
  });
}

/* =========================================================
   5) UI要素
========================================================= */
const prefTabs = document.getElementById("prefTabs");
const cityTabs = document.getElementById("cityTabs");
const districtList = document.getElementById("districtList");
const legendsDiv = document.getElementById("legends");

/* =========================================================
   6) 凡例
========================================================= */
const tileKeyToLabel = {
  twi: "TWI（湿潤度）",
  hand: "HAND（鉛直距離）",
  tikei: "地形・地質等から期待される雨水浸透機能",
  keikan: "自然的景観",
  suiden: "水田占有率"
};

function pathToLegend(url) {
  const idx = url.indexOf("{z}");
  if (idx !== -1) return url.slice(0, idx) + "hanrei.png";
  return url.replace(/\{z\}\/\{x\}\/\{y\}\.(png|jpg).*$/, "hanrei.png")
            .replace(/\/\d+\/\d+\/\d+\.(png|jpg).*$/, "/hanrei.png");
}

function refreshLegends() {
  if (!legendsDiv) return;
  legendsDiv.innerHTML = "";

  Object.entries(layerDefs).forEach(([key, ids]) => {
    const chk = document.getElementById(ids.chk);
    if (!chk || !chk.checked) return;

    const src = pathToLegend(tileLayers[key]._url || "");
    const wrap = document.createElement("div");
    wrap.className = "legend-item";

    const img = document.createElement("img");
    img.src = src;
    img.alt = `${tileKeyToLabel[key]} 凡例`;
    img.loading = "lazy";
    img.className = "legend-img";

    const cap = document.createElement("div");
    cap.className = "legend-cap";
    cap.textContent = tileKeyToLabel[key];

    wrap.append(img, cap);
    legendsDiv.append(wrap);
  });
}

/* =========================================================
   7) カタログ（pref/city）と市域マスク
========================================================= */
let CATALOG = null;
let currentPref = null;
let currentCity = null;
let cityMaskGeo = null;

/* =========================================================
   8) マスク付きタイルレイヤ（ECODRR）
========================================================= */
if (!window.MaskedTileLayer) {
  alert("MaskedTileLayerが見つかりません。assets/js/masked-tile.js の読み込みを確認してください。");
  throw new Error("MaskedTileLayer not loaded");
}

const tileLayers = {
  twi:    new MaskedTileLayer("", { pane: "ecodrrPane" }),
  hand:   new MaskedTileLayer("", { pane: "ecodrrPane" }),
  tikei:  new MaskedTileLayer("", { pane: "ecodrrPane" }),
  keikan: new MaskedTileLayer("", { pane: "ecodrrPane" }),
  suiden: new MaskedTileLayer("", { pane: "ecodrrPane" })
};

const layerDefs = {
  twi:    { chk: "twiToggle",    op: "twiOpacity",    h: "twiHue",    s: "twiSat",    b: "twiBri" },
  hand:   { chk: "handToggle",   op: "handOpacity",   h: "handHue",   s: "handSat",   b: "handBri" },
  tikei:  { chk: "tikeiToggle",  op: "tikeiOpacity",  h: "tikeiHue",  s: "tikeiSat",  b: "tikeiBri" },
  keikan: { chk: "keikanToggle", op: "keikanOpacity", h: "keikanHue", s: "keikanSat", b: "keikanBri" },
  suiden: { chk: "suidenToggle", op: "suidenOpacity", h: "suidenHue", s: "suidenSat", b: "suidenBri" }
};

function setTilesUIEnabled(enabled) {
  Object.values(layerDefs).forEach(({ chk, op, h, s, b }) => {
    [chk, op, h, s, b].map(id => document.getElementById(id))
      .forEach(el => { if (el) el.disabled = !enabled; });
  });
}

Object.entries(layerDefs).forEach(([key, ids]) => {
  const lay = tileLayers[key];
  const chk = document.getElementById(ids.chk);
  const op  = document.getElementById(ids.op);
  const h   = document.getElementById(ids.h);
  const s   = document.getElementById(ids.s);
  const b   = document.getElementById(ids.b);
  if (!chk || !op || !h || !s || !b) return;

  const applyAll = () => {
    lay.setOpacity(Number(op.value));
    lay.setFilter(Number(h.value), Number(s.value), Number(b.value));
  };

  chk.addEventListener("change", () => {
    if (chk.checked) { lay.addTo(map); applyAll(); }
    else map.removeLayer(lay);
    refreshLegends();
  });

  [op, h, s, b].forEach(el => el.addEventListener("input", () => {
    if (!map.hasLayer(lay)) return;
    applyAll();
  }));
});

/* =========================================================
   9) 地区（区境・ポイント）
========================================================= */
let activeDistricts = {};

function ecColor(v) {
  return v > 0.2 ? "#800026" :
         v > 0.15 ? "#E31A1C" :
         v > 0.10 ? "#FD8D3C" : "#FED976";
}

let pointMode = "ec";
let monoColor = "#ffaa00";
let pointSize = 8;

document.querySelectorAll("input[name='ptMode']").forEach(r => {
  r.addEventListener("change", (e) => {
    pointMode = e.target.value;
    Object.values(activeDistricts).forEach(d => updatePointsStyle(d.pointsLayer));
  });
});

const pointColorEl = document.getElementById("pointColor");
if (pointColorEl) pointColorEl.addEventListener("input", (e) => {
  monoColor = e.target.value;
  if (pointMode === "mono") Object.values(activeDistricts).forEach(d => updatePointsStyle(d.pointsLayer));
});

const pointSizeEl = document.getElementById("pointSize");
if (pointSizeEl) pointSizeEl.addEventListener("input", (e) => {
  pointSize = Number(e.target.value);
  Object.values(activeDistricts).forEach(d => updatePointsStyle(d.pointsLayer, true));
});

function updatePointsStyle(layer, sizeOnly=false) {
  if (!layer) return;
  layer.eachLayer(m => {
    const ec = m.feature?.properties?.EC;
    const fill = (pointMode === "ec") ? ecColor(ec) : monoColor;
    const style = sizeOnly ? { radius: pointSize } : { radius: pointSize, fillColor: fill };
    if (m.setStyle) m.setStyle(style);
  });
}

function buildDiagnosisUrl(id, pointsSrc) {
  const base = "soil.html";
  const q1 = `id=${encodeURIComponent(String(id))}`;
  const q2 = pointsSrc ? `&src=${encodeURIComponent(pointsSrc)}` : "";
  return `${base}?${q1}${q2}`;
}

function buildDiagnosisPopupHtml(feature, pointsSrc) {
  const props = feature.properties || {};
  const id = props.field_id ?? props.soil_id ?? props.id;
  const place = props["場所名"] ?? "";
  const ec = props.EC ?? "";
  if (!id) return `<div><b>IDが見つかりません</b></div>`;

  const url = buildDiagnosisUrl(id, pointsSrc);
  return `
    <div style="min-width:240px; line-height:1.6;">
      <div><b>${id}</b></div>
      <div style="font-size:12px; color:#555;">${place}</div>
      <div style="margin-top:6px;">EC: <b>${ec}</b></div>
      <div style="margin-top:10px;">
        <a href="${url}" target="_blank" rel="noopener"
           style="display:inline-block; padding:8px 12px; background:#0a66c2; color:#fff; border-radius:6px; text-decoration:none;">
          診断を見る
        </a>
      </div>
    </div>`;
}

function addDistrictRow(cityKey, dist) {
  if (!districtList) return;

  const row = document.createElement("div");
  row.className = "dist-row";

  const label = document.createElement("div");
  label.textContent = dist.display;
  row.append(label);
  row.append(document.createElement("div"));
  row.append(document.createElement("div"));

  const controls = document.createElement("div");
  controls.style.gridColumn = "1 / -1";
  controls.style.display = "grid";
  controls.style.gridTemplateColumns = "auto auto 1fr";
  controls.style.alignItems = "center";
  controls.style.gap = "8px";
  controls.style.marginTop = "2px";

  const boundaryToggle = document.createElement("input");
  boundaryToggle.type = "checkbox"; boundaryToggle.checked = true;

  const pointsToggle = document.createElement("input");
  pointsToggle.type = "checkbox"; pointsToggle.checked = true;

  const bWrap = document.createElement("label");
  bWrap.className = "small";
  bWrap.append(boundaryToggle, document.createTextNode(" 区境"));

  const pWrap = document.createElement("label");
  pWrap.className = "small";
  pWrap.append(pointsToggle, document.createTextNode(" ポイント"));

  const fitBtn = document.createElement("button");
  fitBtn.className = "fit-btn";
  fitBtn.textContent = "範囲へ";

  controls.append(bWrap, pWrap, fitBtn);
  row.append(controls);
  districtList.append(row);

  const state = { boundaryLayer: null, boundaryBounds: null, pointsLayer: null };
  activeDistricts[dist.key] = state;

  fetch(dist.boundary, { cache: "no-store" })
    .then(r => r.json())
    .then(js => {
      if (state.boundaryLayer) map.removeLayer(state.boundaryLayer);
      state.boundaryLayer = L.geoJSON(js, {
        pane: "districtPane",
        style: { color: "#ffdist.boundary, e));

  fetch(dist.points, { cache: "no-store" })
    .then(r => r.json())
    .then(js => {
      if (state.pointsLayer) map.removeLayer(state.pointsLayer);

      state.pointsLayer = L.geoJSON(js, {
        pointToLayer: (f, latlng) => {
          const col = (pointMode === "ec") ? ecColor(f.properties?.EC) : monoColor;
          const marker = L.circleMarker(latlng, {
            pane: "pointsPane",
            radius: pointSize, fillColor: col, color: "#000", weight: 1, fillOpacity: 0.9
          });
          marker.bindPopup(buildDiagnosisPopupHtml(f, dist.points));
          return marker;
        }
      });
      if (pointsToggle.checked) state.pointsLayer.addTo(map);
    })
    .catch(e => console.warn("points 読み込み失敗:", dist.points, e));

  boundaryToggle.addEventListener("change", () => {
    if (!state.boundaryLayer) return;
    boundaryToggle.checked ? state.boundaryLayer.addTo(map) : map.removeLayer(state.boundaryLayer);
  });

  pointsToggle.addEventListener("change", () => {
    if (!state.pointsLayer) return;
    pointsToggle.checked ? state.pointsLayer.addTo(map) : map.removeLayer(state.pointsLayer);
  });

  fitBtn.addEventListener("click", () => {
    if (state.boundaryBounds && state.boundaryBounds.isValid()) map.fitBounds(state.boundaryBounds.pad(0.1));
  });
}

/* =========================================================
   10) タブ（pref/city）
========================================================= */
function renderPrefTabs() {
  if (!prefTabs || !CATALOG) return;
  prefTabs.innerHTML = "";
  Object.keys(CATALOG).forEach(prefKey => {
    const pref = CATALOG[prefKey];
    const btn = document.createElement("div");
    btn.className = "tab" + (prefKey === currentPref ? " active" : "");
    btn.textContent = pref.display ?? prefKey;
    btn.addEventListener("click", () => selectPref(prefKey));
    prefTabs.append(btn);
  });
}

function renderCityTabs() {
  if (!cityTabs || !CATALOG || !currentPref) return;
  cityTabs.innerHTML = "";
  const cities = CATALOG[currentPref].cities || {};
  Object.keys(cities).forEach(cityKey => {
    const city = cities[cityKey];
    const btn = document.createElement("div");
    btn.className = "tab" + (cityKey === currentCity ? " active" : "");
    btn.textContent = city.display ?? cityKey;
    btn.addEventListener("click", () => selectCity(cityKey));
    cityTabs.append(btn);
  });
}

function selectPref(prefKey) {
  currentPref = prefKey;
  renderPrefTabs();
  const firstCity = Object.keys(CATALOG[prefKey].cities || {})[0];
  if (firstCity) selectCity(firstCity);
}

function selectCity(cityKey) {
  currentCity = cityKey;
  renderCityTabs();

  const city = CATALOG[currentPref].cities[cityKey];
  if (!city) return;

  map.setView(city.center, city.zoom);
  setTilesUIEnabled(false);

  fetch(city.cityMask, { cache: "no-store" })
    .then(r => r.json())
    .then(geo => {
      cityMaskGeo = geo;
      Object.values(tileLayers).forEach(l => l.setMask(cityMaskGeo, map));

      tileLayers.twi.setUrl(city.tiles.twi);
      tileLayers.hand.setUrl(city.tiles.hand);
      tileLayers.tikei.setUrl(city.tiles.tikei);
      tileLayers.keikan.setUrl(city.tiles.keikan);
      tileLayers.suiden.setUrl(city.tiles.suiden);

      setTilesUIEnabled(true);
      refreshLegends();
    })
    .catch(e => {
      console.warn("cityMask 読み込み失敗:", city.cityMask, e);
      setTilesUIEnabled(true);
    });

  Object.values(activeDistricts).forEach(d => {
    if (d.boundaryLayer) map.removeLayer(d.boundaryLayer);
    if (d.pointsLayer) map.removeLayer(d.pointsLayer);
  });
  activeDistricts = {};
  if (districtList) districtList.innerHTML = "";
  (city.districts || []).forEach(d => addDistrictRow(cityKey, d));
}

/* =========================================================
   11) 初期化（catalog.json）
========================================================= */
fetch("./data/catalog.json", { cache: "no-store" })
  .then(r => r.json())
  .then(cfg => {
    CATALOG = cfg;
    const firstPref = Object.keys(CATALOG)[0];
    if (!firstPref) return;
    selectPref(firstPref);
  })
  .catch(e => console.error("catalog.json の読み込みに失敗:", e));