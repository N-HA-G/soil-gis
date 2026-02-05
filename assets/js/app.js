/* ===== 0) パネル最小化 ===== */
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

/* ===== 1) Leafletチェック ===== */
if (!window.L) {
  alert("Leafletが読み込めていません。index.html の link/script を確認してください。");
  throw new Error("Leaflet not loaded");
}

/* ===== 2) Map ===== */
const map = L.map("map", { center: [36.055, 139.07], zoom: 13 });

/* ===== 3) Paneで順序固定（上→下：district → ecodrr → basemap） ===== */
map.createPane("basemapPane");  map.getPane("basemapPane").style.zIndex = 200;
map.createPane("ecodrrPane");   map.getPane("ecodrrPane").style.zIndex = 450;
map.createPane("districtPane"); map.getPane("districtPane").style.zIndex = 650;
map.createPane("pointsPane");   map.getPane("pointsPane").style.zIndex = 700;

/* パネル内クリックで地図が動かない */
const panelEl = document.getElementById("panel");
if (panelEl) L.DomEvent.disableClickPropagation(panelEl);

/* ===== 4) Base layers ===== */
const baseOSM = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, pane: "basemapPane", attribution: "&copy; OpenStreetMap contributors"
});
const baseGSIStd = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
  maxZoom: 18, pane: "basemapPane", attribution: "出典：国土地理院（地理院タイル）"
});
const baseGSIAerial = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", {
  maxZoom: 18, pane: "basemapPane", attribution: "出典：国土地理院（地理院タイル）"
});

/* 背景切替（パネル） */
const baseSelect = document.getElementById("baseSelect");
const baseOpacityEl = document.getElementById("baseOpacity");

function setBaseLayer(key) {
  map.removeLayer(baseOSM); map.removeLayer(baseGSIStd); map.removeLayer(baseGSIAerial);
  if (key === "osm") baseOSM.addTo(map);
  if (key === "gsiStd") baseGSIStd.addTo(map);
  if (key === "gsiAir") baseGSIAerial.addTo(map);
  localStorage.setItem("baseKey", key);
}

const savedBaseKey = localStorage.getItem("baseKey") || "gsiStd";
setBaseLayer(savedBaseKey);
if (baseSelect) baseSelect.value = savedBaseKey;
if (baseSelect) baseSelect.addEventListener("change", e => setBaseLayer(e.target.value));

if (baseOpacityEl) {
  baseOpacityEl.addEventListener("input", e => {
    const v = Number(e.target.value);
    baseOSM.setOpacity(v); baseGSIStd.setOpacity(v); baseGSIAerial.setOpacity(v);
  });
}

/* ===== 5) UI要素 ===== */
const prefTabs = document.getElementById("prefTabs");
const cityTabs = document.getElementById("cityTabs");
const districtList = document.getElementById("districtList");
const legendsDiv = document.getElementById("legends");

/* ===== 6) MaskedTileLayer 必須 ===== */
if (!window.MaskedTileLayer) {
  alert("MaskedTileLayerが見つかりません。masked-tile.js の読み込み順を確認してください。");
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
  twi:    { chk:"twiToggle",    op:"twiOpacity",    h:"twiHue",    s:"twiSat",    b:"twiBri" },
  hand:   { chk:"handToggle",   op:"handOpacity",   h:"handHue",   s:"handSat",   b:"handBri" },
  tikei:  { chk:"tikeiToggle",  op:"tikeiOpacity",  h:"tikeiHue",  s:"tikeiSat",  b:"tikeiBri" },
  keikan: { chk:"keikanToggle", op:"keikanOpacity", h:"keikanHue", s:"keikanSat", b:"keikanBri" },
  suiden: { chk:"suidenToggle", op:"suidenOpacity", h:"suidenHue", s:"suidenSat", b:"suidenBri" }
};

function pathToLegend(url) {
  const idx = url.indexOf("{z}");
  if (idx !== -1) return url.slice(0, idx) + "hanrei.png";
  return url.replace(/\{z\}\/\{x\}\/\{y\}\.(png|jpg).*$/, "hanrei.png")
            .replace(/\/\d+\/\d+\/\d+\.(png|jpg).*$/, "/hanrei.png");
}
const tileKeyToLabel = {
  twi:"TWI（湿潤度）", hand:"HAND（鉛直距離）", tikei:"地形・地質等から期待され