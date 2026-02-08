/* =========================================================
   app.js（catalog v2対応 / 完全版）
   - pref.base / city.base / tileDirs / districts.base を展開
   - 旧形式 city.tiles も互換
   - points が出ない時のデバッグログ付き
========================================================= */

/* ====== デバッグをONにしたいとき true ====== */
const DEBUG = true;

/* =========================================================
   0) パネル最小化（存在チェック付き）
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
   1) 地図のベース（OSM / 地理院標準 / 地理院航空写真）
========================================================= */
const map = L.map("map", { center: [36.055, 139.07], zoom: 13 });

/* ===== レイヤ順固定（B：区境線が最上）
   上 → 下
   district（線） > points（点） > ecodrr（タイル） > basemap（背景）
*/
map.createPane("basemapPane");
map.getPane("basemapPane").style.zIndex = 200;

map.createPane("ecodrrPane");
map.getPane("ecodrrPane").style.zIndex = 450;

map.createPane("pointsPane");
map.getPane("pointsPane").style.zIndex = 650;

map.createPane("districtPane");
map.getPane("districtPane").style.zIndex = 700;

/* パネル内クリックで地図が動かないように */
const panelEl = document.getElementById("panel");
if (panelEl) L.DomEvent.disableClickPropagation(panelEl);

/* ===== 背景レイヤ（pane: basemapPane） ===== */
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

/* Leafletの背景切替UI（任意） */
L.control.layers(
  {
    "OSM": baseOSM,
    "地理院 標準地図": baseGSIStd,
    "地理院 航空写真": baseGSIAerial
  },
  null,
  { collapsed: true, position: "bottomright" }
).addTo(map);

/* パネルのプルダウンで確実に背景を切替 */
const baseSelect = document.getElementById("baseSelect");

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

if (baseSelect) {
  baseSelect.addEventListener("change", (e) => setBaseLayer(e.target.value));
}

/* 背景透明度 */
const baseOpacityEl = document.getElementById("baseOpacity");
if (baseOpacityEl) {
  baseOpacityEl.addEventListener("input", (e) => {
    const v = Number(e.target.value);
    baseOSM.setOpacity(v);
    baseGSIStd.setOpacity(v);
    baseGSIAerial.setOpacity(v);
  });
}

/* =========================================================
   2) UI要素
========================================================= */
const prefTabs = document.getElementById("prefTabs");
const cityTabs = document.getElementById("cityTabs");
const districtList = document.getElementById("districtList");
const legendsDiv = document.getElementById("legends");

/* =========================================================
   3) 凡例
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
  return url
    .replace(/\{z\}\/\{x\}\/\{y\}\.(png|jpg).*$/, "hanrei.png")
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
   4) カタログ（pref/city）と市域マスク
========================================================= */
let CATALOG = null;
let currentPref = null;
let currentCity = null;
let cityMaskGeo = null;

/* =========================================================
   4.5) catalog v2 正規化
========================================================= */
function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
}
function looksLikePath(s) {
  return typeof s === "string" && s.includes("/");
}

function normalizeCity(prefKey, cityKey, rawCity) {
  const pref = CATALOG?.[prefKey] || {};
  const prefBase = pref.base || joinPath("data", prefKey);
  const cityBase = rawCity.base || cityKey;
  const cityRoot = joinPath(prefBase, cityBase);

  const cityMask = looksLikePath(rawCity.cityMask)
    ? rawCity.cityMask
    : joinPath(cityRoot, rawCity.cityMask);

  const tiles = {};
  if (rawCity.tiles && typeof rawCity.tiles === "object") {
    Object.assign(tiles, rawCity.tiles);
  } else if (rawCity.tileDirs && typeof rawCity.tileDirs === "object") {
    Object.entries(rawCity.tileDirs).forEach(([k, dir]) => {
      tiles[k] = joinPath(cityRoot, dir, "{z}/{x}/{y}.png");
    });
  }

  const districts = (rawCity.districts || []).map((d) => {
    const dBase = d.base || d.key;
    const dRoot = joinPath(cityRoot, dBase);

    const boundary = d.boundary
      ? (looksLikePath(d.boundary) ? d.boundary : joinPath(dRoot, d.boundary))
      : null;

    const points = d.points
      ? (looksLikePath(d.points) ? d.points : joinPath(dRoot, d.points))
      : null;

    return { ...d, boundary, points };
  });

  if (DEBUG) {
    console.log("[normalizeCity]", { prefKey, cityKey, cityMask, tiles, districts });
  }

  return { ...rawCity, cityMask, tiles, districts };
}

/* =========================================================
   5) マスク付きタイルレイヤ（ECODRR）
========================================================= */
const tileLayers = {
  twi:    new MaskedTileLayer("", { pane: "ecodrrPane" }),
  hand:   new MaskedTileLayer("", { pane: "ecodrrPane" }),
  tikei:  new MaskedTileLayer("", { pane: "ecodrrPane" }),
  keikan: new MaskedTileLayer("", { pane: "ecodrrPane" }),
  suiden: new MaskedTileLayer("", { pane: "ecodrrPane" })
};

/* =========================================================
   6) タイルUI連携（checkbox + opacity + Hue/Sat/Bri）
========================================================= */
const layerDefs = {
  twi:    { chk: "twiToggle",    op: "twiOpacity",    h: "twiHue",    s: "twiSat",    b: "twiBri" },
  hand:   { chk: "handToggle",   op: "handOpacity",   h: "handHue",   s: "handSat",   b: "handBri" },
  tikei:  { chk: "tikeiToggle",  op: "tikeiOpacity",  h: "tikeiHue",  s: "tikeiSat",  b: "tikeiBri" },
  keikan: { chk: "keikanToggle", op: "keikanOpacity", h: "keikanHue", s: "keikanSat", b: "keikanBri" },
  suiden: { chk: "suidenToggle", op: "suidenOpacity", h: "suidenHue", s: "suidenSat", b: "suidenBri" }
};

function setTilesUIEnabled(enabled) {
  Object.values(layerDefs).forEach(({ chk, op, h, s, b }) => {
    [chk, op, h, s, b]
      .map((id) => document.getElementById(id))
      .forEach((el) => { if (el) el.disabled = !enabled; });
  });
}

let activeDistricts = {}; // key -> { boundaryLayer, boundaryBounds, pointsLayer }

function bringDistrictToFront() {
  Object.values(activeDistricts).forEach((d) => {
    if (d.boundaryLayer && d.boundaryLayer.bringToFront) d.boundaryLayer.bringToFront();
  });
}

Object.entries(layerDefs).forEach(([key, ids]) => {
  const lay = tileLayers[key];
  const chk = document.getElementById(ids.chk);
  const op = document.getElementById(ids.op);
  const h  = document.getElementById(ids.h);
  const s  = document.getElementById(ids.s);
  const b  = document.getElementById(ids.b);

  if (!chk || !op || !h || !s || !b) return;

  const applyAll = () => {
    lay.setOpacity(Number(op.value));
    lay.setFilter(Number(h.value), Number(s.value), Number(b.value));
  };

  chk.addEventListener("change", () => {
    if (chk.checked) {
      lay.addTo(map);
      applyAll();
      if (lay.bringToFront) lay.bringToFront();
    } else {
      map.removeLayer(lay);
    }
    bringDistrictToFront();
    refreshLegends();
  });

  [op, h, s, b].forEach((el) => {
    el.addEventListener("input", () => {
      if (!map.hasLayer(lay)) return;
      applyAll();
    });
  });
});

/* =========================================================
   7) 地区（区境・ポイント）
========================================================= */
function ecColor(v) {
  return v > 0.2 ? "#800026" :
         v > 0.15 ? "#E31A1C" :
         v > 0.10 ? "#FD8D3C" : "#FED976";
}

let pointMode = "ec";
let monoColor = "#ffaa00";
let pointSize = 8;

document.querySelectorAll("input[name='ptMode']").forEach((r) => {
  r.addEventListener("change", (e) => {
    pointMode = e.target.value;
    Object.values(activeDistricts).forEach((d) => updatePointsStyle(d.pointsLayer));
  });
});

const pointColorEl = document.getElementById("pointColor");
if (pointColorEl) {
  pointColorEl.addEventListener("input", (e) => {
    monoColor = e.target.value;
    if (pointMode === "mono") {
      Object.values(activeDistricts).forEach((d) => updatePointsStyle(d.pointsLayer));
    }
  });
}

const pointSizeEl = document.getElementById("pointSize");
if (pointSizeEl) {
  pointSizeEl.addEventListener("input", (e) => {
    pointSize = Number(e.target.value);
    Object.values(activeDistricts).forEach((d) => updatePointsStyle(d.pointsLayer, true));
  });
}

function updatePointsStyle(layer, sizeOnly = false) {
  if (!layer) return;
  layer.eachLayer((m) => {
    const ec = m.feature?.properties?.EC;
    const fill = (pointMode === "ec") ? ecColor(ec) : monoColor;
    const style = sizeOnly ? { radius: pointSize } : { radius: pointSize, fillColor: fill };
    if (m.setStyle) m.setStyle(style);
  });
}

/* soil.html に飛ぶ（src=soil_points のパスを渡す）
   ★注意：URLクエリは &amp; ではなく & を使う
*/
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

  if (!id) {
    return `
      <div style="min-width:240px; line-height:1.6;">
        <b>IDが見つかりません</b><br>
        soil_points.geojson の properties に <code>field_id</code> を入れてください。
      </div>
    `;
  }

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

      <div style="margin-top:6px; font-size:11px; color:#666;">
        （新しいタブで開きます）
      </div>
    </div>
  `;
}

function openDiagnosisInNewTab(feature, pointsSrc) {
  const id = feature?.properties?.field_id ?? feature?.properties?.soil_id ?? feature?.properties?.id;
  if (!id) return;
  window.open(buildDiagnosisUrl(id, pointsSrc), "_blank", "noopener");
}

/* ===== pointsが出ない時の中身チェック（座標逆・型違いをログ） ===== */
function debugCheckPointsGeoJSON(js, src) {
  if (!DEBUG) return;
  try {
    const type = js?.type;
    const n = js?.features?.length ?? 0;
    console.log("[points geojson]", src, "type=", type, "features=", n);

    const f0 = js?.features?.[0];
    if (!f0) return;

    const g = f0.geometry;
    console.log("[points first geometry]", g?.type, g?.coordinates);

    if (g?.type !== "Point") {
      console.warn("⚠ points geometry.type が Point ではありません:", g?.type);
    }
    const c = g?.coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      const lng = c[0], lat = c[1];
      // 秩父周辺の目安：lng≈139, lat≈36
      if (Math.abs(lng) < 90 && Math.abs(lat) > 90) {
        console.warn("⚠ 座標が [lat,lng] 逆の可能性があります:", c);
      }
    }
  } catch (e) {
    console.warn("debugCheckPointsGeoJSON error:", e);
  }
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
  boundaryToggle.type = "checkbox";
  boundaryToggle.checked = true;

  const pointsToggle = document.createElement("input");
  pointsToggle.type = "checkbox";
  pointsToggle.checked = true;

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

  /* 区境（線） */
  if (dist.boundary) {
    fetch(dist.boundary, { cache: "no-store" })
      .then((r) => {
        if (DEBUG) console.log("[fetch boundary]", dist.boundary, "status=", r.status);
        return r.json();
      })
      .then((js) => {
        if (state.boundaryLayer) map.removeLayer(state.boundaryLayer);

        state.boundaryLayer = L.geoJSON(js, {
          pane: "districtPane",
          interactive: false,
          bubblingMouseEvents: false,
          style: { color: "#ff0066", weight: 3, fillOpacity: 0 }
        }).addTo(map);

        state.boundaryBounds = state.boundaryLayer.getBounds();
        state.boundaryLayer.bringToFront();
      })
      .catch((e) => console.warn("boundary 読み込み失敗:", dist.boundary, e));
  }

  /* ポイント（点） */
  if (dist.points) {
    fetch(dist.points, { cache: "no-store" })
      .then((r) => {
        if (DEBUG) console.log("[fetch points]", dist.points, "status=", r.status);
        return r.json();
      })
      .then((js) => {
        debugCheckPointsGeoJSON(js, dist.points);

        if (state.pointsLayer) map.removeLayer(state.pointsLayer);

        state.pointsLayer = L.geoJSON(js, {
          pointToLayer: (f, latlng) => {
            const col = (pointMode === "ec") ? ecColor(f.properties?.EC) : monoColor;

            const marker = L.circleMarker(latlng, {
              pane: "pointsPane",
              radius: pointSize,
              fillColor: col,
              color: "#000",
              weight: 1,
              fillOpacity: 0.9
            });

            marker.bindPopup(buildDiagnosisPopupHtml(f, dist.points));

            const fid = f.properties?.field_id ?? "";
            const place = f.properties?.["場所名"] ?? "";
            marker.bindTooltip(`${fid} ${place}`.trim(), { direction: "top" });

            marker.on("click", (ev) => {
              const oe = ev?.originalEvent;
              const modifier = oe && (oe.shiftKey || oe.ctrlKey || oe.metaKey);
              if (modifier) openDiagnosisInNewTab(f, dist.points);
            });

            marker.on("dblclick", (ev) => {
              const oe = ev?.originalEvent;
              if (oe) L.DomEvent.stop(oe);
              openDiagnosisInNewTab(f, dist.points);
            });

            return marker;
          }
        });

        if (pointsToggle.checked) state.pointsLayer.addTo(map);
        bringDistrictToFront();
      })
      .catch((e) => console.warn("points 読み込み失敗:", dist.points, e));
  }

  boundaryToggle.addEventListener("change", () => {
    const lay = state.boundaryLayer;
    if (!lay) return;
    if (boundaryToggle.checked) {
      lay.addTo(map);
      lay.bringToFront();
    } else {
      map.removeLayer(lay);
    }
  });

  pointsToggle.addEventListener("change", () => {
    const lay = state.pointsLayer;
    if (!lay) return;
    if (pointsToggle.checked) lay.addTo(map);
    else map.removeLayer(lay);
    bringDistrictToFront();
  });

  fitBtn.addEventListener("click", () => {
    const b = state.boundaryBounds;
    if (b && b.isValid()) map.fitBounds(b.pad(0.1));
  });
}

/* =========================================================
   8) タブ描画（pref / city）
========================================================= */
function renderPrefTabs() {
  if (!prefTabs || !CATALOG) return;
  prefTabs.innerHTML = "";

  Object.keys(CATALOG).forEach((prefKey) => {
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
  Object.keys(cities).forEach((cityKey) => {
    const city = cities[cityKey];
    const btn = document.createElement("div");
    btn.className = "tab" + (cityKey === currentCity ? " active" : "");
    btn.textContent = city.display ?? cityKey;
    btn.addEventListener("click", () => selectCity(cityKey));
    cityTabs.append(btn);
  });
}

/* =========================================================
   9) 選択ハンドラ（pref / city）
========================================================= */
function selectPref(prefKey) {
  currentPref = prefKey;
  renderPrefTabs();
  const firstCity = Object.keys(CATALOG[prefKey].cities || {})[0];
  if (firstCity) selectCity(firstCity);
}

function selectCity(cityKey) {
  currentCity = cityKey;
  renderCityTabs();

  const rawCity = CATALOG[currentPref].cities[cityKey];
  if (!rawCity) return;

  const city = normalizeCity(currentPref, cityKey, rawCity);

  map.setView(city.center, city.zoom);
  setTilesUIEnabled(false);

  fetch(city.cityMask, { cache: "no-store" })
    .then((r) => {
      if (DEBUG) console.log("[fetch cityMask]", city.cityMask, "status=", r.status);
      return r.json();
    })
    .then((geo) => {
      cityMaskGeo = geo;

      Object.values(tileLayers).forEach((l) => l.setMask(cityMaskGeo, map));

      tileLayers.twi.setUrl(city.tiles.twi || "");
      tileLayers.hand.setUrl(city.tiles.hand || "");
      tileLayers.tikei.setUrl(city.tiles.tikei || "");
      tileLayers.keikan.setUrl(city.tiles.keikan || "");
      tileLayers.suiden.setUrl(city.tiles.suiden || "");

      setTilesUIEnabled(true);

      Object.entries(layerDefs).forEach(([key, ids]) => {
        const chk = document.getElementById(ids.chk);
        const op = document.getElementById(ids.op);
        const h  = document.getElementById(ids.h);
        const s  = document.getElementById(ids.s);
        const b  = document.getElementById(ids.b);
        const lay = tileLayers[key];

        if (!chk || !op || !h || !s || !b) return;

        lay.setOpacity(Number(op.value));
        lay.setFilter(Number(h.value), Number(s.value), Number(b.value));

        if (chk.checked) {
          lay.addTo(map);
          if (lay.bringToFront) lay.bringToFront();
        } else {
          map.removeLayer(lay);
        }
      });

      bringDistrictToFront();
      refreshLegends();
    })
    .catch((e) => {
      console.warn("cityMask 読み込み失敗:", city.cityMask, e);
      setTilesUIEnabled(true);
    });

  // 地区レイヤを掃除して再構築
  Object.values(activeDistricts).forEach((d) => {
    if (d.boundaryLayer) map.removeLayer(d.boundaryLayer);
    if (d.pointsLayer) map.removeLayer(d.pointsLayer);
  });
  activeDistricts = {};
  if (districtList) districtList.innerHTML = "";

  (city.districts || []).forEach((d) => addDistrictRow(cityKey, d));
}

/* =========================================================
   10) 初期化（catalog.json）
========================================================= */
fetch("./data/catalog.json", { cache: "no-store" })
  .then((r) => {
    if (DEBUG) console.log("[fetch catalog]", "./data/catalog.json", "status=", r.status);
    return r.json();
  })
  .then((cfg) => {
    CATALOG = cfg;
    const firstPref = Object.keys(CATALOG)[0];
    if (!firstPref) return;
    selectPref(firstPref);
  })
  .catch((e) => console.error("catalog.json の読み込みに失敗:", e));
