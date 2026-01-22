
/* ========= 地図のベース ========= */
const map = L.map("map", { center: [36.055, 139.07], zoom: 13 });
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  { maxZoom: 19, opacity: 1 }).addTo(map);
document.getElementById("baseOpacity").addEventListener("input", e =>
  osm.setOpacity(Number(e.target.value))
);
L.DomEvent.disableClickPropagation(document.getElementById('panel'));

/* ========= UI要素 ========= */
const prefTabs = document.getElementById('prefTabs');
const cityTabs = document.getElementById('cityTabs');
const districtList = document.getElementById('districtList');
const legendsDiv = document.getElementById('legends');

/* ========= タイル凡例用ラベル ========= */
const tileKeyToLabel = {
  twi:   "TWI（湿潤度）",
  hand:  "HAND（鉛直距離）",
  tikei: "地形・地質等から期待される雨水浸透機能",
  keikan:"自然的景観",
  suiden:"水田占有率"
};

/* ========= 凡例ユーティリティ ========= */
function pathToLegend(url) {
  // 期待形式: .../0xxxxx_xxxxx/{z}/{x}/{y}.png → .../0xxxxx_xxxxx/hanrei.png
  const idx = url.indexOf("{z}");
  if (idx !== -1) return url.slice(0, idx) + "hanrei.png";
  return url.replace(/\{z\}\/\{x\}\/\{y\}\.png.*$/, "hanrei.png")
            .replace(/\/\d+\/\d+\/\d+\.png.*$/, "/hanrei.png");
}
function refreshLegends() {
  legendsDiv.innerHTML = "";
  Object.entries(layerDefs).forEach(([key, ids]) => {
    const chk = document.getElementById(ids.chk);
    if (!chk.checked) return;
    const src = pathToLegend(tileLayers[key]._url || "");
    const wrap = document.createElement('div');
    wrap.className = 'legend-item';
    const img = document.createElement('img');
    img.src = src;
    img.alt = tileKeyToLabel[key] + " 凡例";
    img.loading = "lazy";
    img.className = "legend-img";
    const cap = document.createElement('div');
    cap.className = "legend-cap";
    cap.textContent = tileKeyToLabel[key];
    wrap.append(img, cap);
    legendsDiv.append(wrap);
  });
}

/* ========= 市域マスク用 ========= */
let CATALOG = null;          // catalog.json の内容
let currentPref = null;      // 選択中 県キー
let currentCity = null;      // 選択中 市キー
let cityMaskGeo = null;      // 選択中 市のマスク GeoJSON

/* ========= マスク付きタイルレイヤ ========= */
const tileLayers = {
  twi:    new MaskedTileLayer(""),
  hand:   new MaskedTileLayer(""),
  tikei:  new MaskedTileLayer(""),
  keikan: new MaskedTileLayer(""),
  suiden: new MaskedTileLayer("")
};

/* ========= タイルUI連携 ========= */
const layerDefs = {
  twi:    { chk:'twiToggle',    op:'twiOpacity',    h:'twiHue',    s:'twiSat',    b:'twiBri' },
  hand:   { chk:'handToggle',   op:'handOpacity',   h:'handHue',   s:'handSat',   b:'handBri' },
  tikei:  { chk:'tikeiToggle',  op:'tikeiOpacity',  h:'tikeiHue',  s:'tikeiSat',  b:'tikeiBri' },
  keikan: { chk:'keikanToggle', op:'keikanOpacity', h:'keikanHue', s:'keikanSat', b:'keikanBri' },
  suiden: { chk:'suidenToggle', op:'suidenOpacity', h:'suidenHue', s:'suidenSat', b:'suidenBri' }
};
Object.entries(layerDefs).forEach(([key, ids]) => {
  const c = id => document.getElementById(id);
  const lay = tileLayers[key];
  const chk = c(ids.chk), op = c(ids.op), h = c(ids.h), s = c(ids.s), b = c(ids.b);

  const applyAll = () => {
    lay.setOpacity(Number(op.value));
    lay.setFilter(Number(h.value), Number(s.value), Number(b.value));
    if (!map.hasLayer(lay) && chk.checked) lay.addTo(map);
  };

  chk.addEventListener('change', () => {
    if (chk.checked) { lay.addTo(map); applyAll(); }
    else map.removeLayer(lay);
    refreshLegends();
  });
  [op,h,s,b].forEach(el => el.addEventListener('input', () => {
    if (!map.hasLayer(lay)) return;
    lay.setOpacity(Number(op.value));
    lay.setFilter(Number(h.value), Number(s.value), Number(b.value));
  }));
});

/* ========= 地区（区境・ポイント） ========= */
let activeDistricts = {}; // key -> { boundaryLayer, boundaryBounds, pointsLayer }

function ecColor(v) {
  return v > 0.2 ? "#800026" :
         v > 0.15 ? "#E31A1C" :
         v > 0.10 ? "#FD8D3C" : "#FED976";
}

let pointMode = "ec";
let monoColor = "#ffaa00";
let pointSize = 8;

document.querySelectorAll("input[name='ptMode']").forEach(r => {
  r.addEventListener("change", e => {
    pointMode = e.target.value;
    Object.values(activeDistricts).forEach(d => updatePointsStyle(d.pointsLayer));
  });
});
document.getElementById("pointColor").addEventListener("input", e => {
  monoColor = e.target.value;
  if (pointMode === 'mono') {
    Object.values(activeDistricts).forEach(d => updatePointsStyle(d.pointsLayer));
  }
});
document.getElementById("pointSize").addEventListener("input", e => {
  pointSize = Number(e.target.value);
  Object.values(activeDistricts).forEach(d => updatePointsStyle(d.pointsLayer, true));
});

function updatePointsStyle(layer, sizeOnly=false) {
  if (!layer) return;
  layer.eachLayer(m => {
    const ec = m.feature?.properties?.EC;
    const fill = (pointMode === "ec") ? ecColor(ec) : monoColor;
    const style = sizeOnly ? { radius: pointSize } : { radius: pointSize, fillColor: fill };
    m.setStyle && m.setStyle(style);
  });
}
function buildPointPopup(p) {
  const rows = Object.entries(p || {}).map(([k,v]) =>
    `<tr><th style="text-align:left;padding-right:8px;white-space:nowrap;">${k}</th><td>${v ?? ""}</td></tr>`
  ).join("");
  return `<table class="small">${rows}</table>`;
}
function addDistrictRow(cityKey, dist) {
  const row = document.createElement('div');
  row.className = 'dist-row';

  const label = document.createElement('div');
  label.textContent = dist.display;

  row.append(label);
  row.append(document.createElement('div'));
  row.append(document.createElement('div'));

  const controls = document.createElement('div');
  controls.style.gridColumn = '1 / -1';
  controls.style.display = 'grid';
  controls.style.gridTemplateColumns = 'auto auto 1fr';
  controls.style.alignItems = 'center';
  controls.style.gap = '8px';
  controls.style.marginTop = '2px';

  const boundaryToggle = document.createElement('input');
  boundaryToggle.type = 'checkbox'; boundaryToggle.checked = true;
  const pointsToggle = document.createElement('input');
  pointsToggle.type = 'checkbox'; pointsToggle.checked = true;

  const bWrap = document.createElement('label'); bWrap.className='small';
  bWrap.append(boundaryToggle, document.createTextNode(' 区境'));
  const pWrap = document.createElement('label'); pWrap.className='small';
  pWrap.append(pointsToggle, document.createTextNode(' ポイント'));

  const fitBtn = document.createElement('button');
  fitBtn.className = 'fit-btn';
  fitBtn.textContent = '範囲へ';

  controls.append(bWrap, pWrap, fitBtn);
  row.append(controls);
  districtList.append(row);

  const state = { boundaryLayer:null, boundaryBounds:null, pointsLayer:null };
  activeDistricts[dist.key] = state;

  // 区境（線描画）
  fetch(dist.boundary, { cache: "no-store" })
    .then(r => r.json())
    .then(js => {
      state.boundaryLayer = L.geoJSON(js, {
        style: { color:"#ff0066", weight:3, fillOpacity:0 }
      }).addTo(map);
      state.boundaryBounds = state.boundaryLayer.getBounds();
    })
    .catch(e => console.warn("boundary 読み込み失敗:", dist.boundary, e));

  // ポイント
  fetch(dist.points, { cache: "no-store" })
    .then(r => r.json())
    .then(js => {
      state.pointsLayer = L.geoJSON(js, {
        pointToLayer: (f, latlng) => {
          const col = (pointMode === "ec") ? ecColor(f.properties?.EC) : monoColor;
          return L.circleMarker(latlng, {
            radius: pointSize, fillColor: col, color: "#000", weight: 1, fillOpacity: 0.9
          }).bindPopup(buildPointPopup(f.properties));
        }
      }).addTo(map);
    })
    .catch(e => console.warn("points 読み込み失敗:", dist.points, e));

  boundaryToggle.addEventListener('change', () => {
    const lay = state.boundaryLayer; if (!lay) return;
    if (boundaryToggle.checked) lay.addTo(map); else map.removeLayer(lay);
  });
  pointsToggle.addEventListener('change', () => {
    const lay = state.pointsLayer; if (!lay) return;
    if (pointsToggle.checked) lay.addTo(map); else map.removeLayer(lay);
  });
  fitBtn.addEventListener('click', () => {
    const b = state.boundaryBounds;
    if (b && b.isValid()) map.fitBounds(b.pad(0.1));
  });
}

/* ========= タブ描画 ========= */
function renderPrefTabs() {
  prefTabs.innerHTML = "";
  Object.keys(CATALOG).forEach(prefKey => {
    const pref = CATALOG[prefKey];
    const btn = document.createElement('div');
    btn.className = 'tab' + (prefKey===currentPref ? ' active' : '');
    btn.textContent = pref.display;
    btn.addEventListener('click', () => selectPref(prefKey));
    prefTabs.append(btn);
  });
}
function renderCityTabs() {
  cityTabs.innerHTML = "";
  if (!currentPref) return;
  const cities = CATALOG[currentPref].cities;
  Object.keys(cities).forEach(cityKey => {
    const city = cities[cityKey];
    const btn = document.createElement('div');
    btn.className = 'tab' + (cityKey===currentCity ? ' active' : '');
    btn.textContent = city.display;
    btn.addEventListener('click', () => selectCity(cityKey));
    cityTabs.append(btn);
  });
}

/* ========= UI有効/無効 ========= */
function setTilesUIEnabled(enabled) {
  Object.values(layerDefs).forEach(({chk, op, h, s, b}) => {
    [chk, op, h, s, b].map(id => document.getElementById(id))
                      .forEach(el => el.disabled = !enabled);
  });
}

/* ========= 選択ハンドラ ========= */
function selectPref(prefKey) {
  currentPref = prefKey;
  renderPrefTabs();
  const firstCity = Object.keys(CATALOG[prefKey].cities)[0];
  selectCity(firstCity);
}
function selectCity(cityKey) {
  currentCity = cityKey;
  renderCityTabs();

  const city = CATALOG[currentPref].cities[cityKey];
  map.setView(city.center, city.zoom);

  // マスク準備中はタイルUIを無効化
  setTilesUIEnabled(false);

  // 市域マスクの読み込み → 全タイルに適用 → URL差し替え → UI復帰 → 凡例更新
  cityMaskGeo = null;
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

      // チェック状態を反映
      Object.entries(layerDefs).forEach(([key, ids]) => {
        const chk = document.getElementById(ids.chk);
        const h = document.getElementById(ids.h);
        const s = document.getElementById(ids.s);
        const b = document.getElementById(ids.b);
        const op = document.getElementById(ids.op);
        const lay = tileLayers[key];

        lay.setOpacity(Number(op.value));
        lay.setFilter(Number(h.value), Number(s.value), Number(b.value));
        if (chk.checked) lay.addTo(map); else map.removeLayer(lay);
      });
      refreshLegends();
    })
    .catch(e => {
      console.warn("cityMask 読み込み失敗:", city.cityMask, e);
      setTilesUIEnabled(true);
    });

  // 地区レイヤを掃除してから再構築
  Object.values(activeDistricts).forEach(d => {
    if (d.boundaryLayer) map.removeLayer(d.boundaryLayer);
    if (d.pointsLayer) map.removeLayer(d.pointsLayer);
  });
  activeDistricts = {};
  districtList.innerHTML = "";
  city.districts.forEach(d => addDistrictRow(cityKey, d));
}

/* ========= 初期化：catalog.json を読み込み、最初の県・市を選択 ========= */
fetch("./data/catalog.json", { cache: "no-store" })
  .then(r => r.json())
  .then(cfg => {
    CATALOG = cfg;
    const firstPref = Object.keys(CATALOG)[0];
    selectPref(firstPref);
  })
  .catch(e => console.error("catalog.json の読み込みに失敗:", e));
