/* assets/js/app.js  ——  ECO‑DRR を常に最前面にする完全版 */

///////////////////////////
//  基本セットアップ
///////////////////////////
const map = L.map('map', { zoomControl: true }).setView([36.058, 139.068], 13);

// ベースタイル
const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:'© OpenStreetMap contributors'
}).addTo(map);

// pane を先に作る（重なり順の基礎）
const ecodrrPane = map.createPane('ecodrrPane');      // ECO-DRR専用
ecodrrPane.style.zIndex = 650;                        // overlayPane(400) より前面
ecodrrPane.style.pointerEvents = 'auto';              // クリック可（透過したいなら 'none'）

// （他にも最前面化したい pane があれば同様に作成）
const topOverlayPane = map.createPane('topOverlayPane');
topOverlayPane.style.zIndex = 620;

// レイヤーコントロール
const baseLayers = { 'OSM': baseOSM };
const overlays   = {};
L.control.layers(baseLayers, overlays, { collapsed: false }).addTo(map);

// UI要素
const srcInput = document.getElementById('src') || { value:'data/Saitama/Chichibu/Oota/soil_points.geojson' };
const loadBtn  = document.getElementById('loadBtn');
const fitBtn   = document.getElementById('fitBtn');
const logEl    = document.getElementById('log') || { textContent:'' };

// 汎用
function logMsg(msg){ if(logEl) logEl.textContent = msg; }
async function fetchJSON(url, opt){ const r = await fetch(url, opt||{cache:'no-store'}); if(!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
async function exists(url){ try{ const r=await fetch(url,{cache:'no-store'}); return r.ok; }catch{ return false; } }

// 地物層（ポイント）保持
let layerGeoJSON = null;
let lastBounds = null;

///////////////////////////
//  ポイントGeoJSONの読込
///////////////////////////
async function loadGeoJSON(url){
  try{
    logMsg(`loading: ${url}`);
    const fc = await fetchJSON(url);

    if(layerGeoJSON) layerGeoJSON.remove();

    layerGeoJSON = L.geoJSON(fc, {
      pointToLayer: (f, latlng) => L.circleMarker(latlng, {
        radius: 6, color:'#0a66c2', weight:2, fillColor:'#4c9bf5', fillOpacity:0.6
      }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        const fid = p.field_id || '(no id)';
        const link = `./soil.html?id=${encodeURIComponent(fid)}&src=${encodeURIComponent(url)}`;
        const html = `
          <div style="min-width:180px">
            <div style="font-weight:700;margin-bottom:4px;">${fid}</div>
            <div style="color:#555;margin-bottom:6px;">${p["場所名"]||""}</div>
            ${link}診断を見る →</a>
          </div>`;
        layer.bindPopup(html);
      }
    }).addTo(map);

    lastBounds = layerGeoJSON.getBounds();
    if(lastBounds.isValid()) map.fitBounds(lastBounds.pad(0.2));
    logMsg(`loaded: ${url} / features: ${(fc.features||[]).length}`);
  }catch(e){
    logMsg(`読み込みエラー: ${String(e)}`);
    console.error(e);
  }
}

///////////////////////////
//  ECO‑DRR レイヤーの追加
//  （タイル → マスクタイル → GeoJSON の順で最適を選択）
///////////////////////////
async function addEcoDRR(){
  // 想定パス（構成に合わせて使用）
  const tileURL = 'data/Saitama/Chichibu/01_TWI_chichibu/{z}/{x}/{y}.png';     // タイル
  const maskURL = 'data/Saitama/Chichibu/Oota/chichibu.geojson';               // マスク or 境界
  const gjURL   = 'data/Saitama/Chichibu/Oota/chichibu.geojson';               // GeoJSON そのもの

  // 1) タイルがあれば最優先（WMSでも同様にpane指定＋setZIndexが最も安定）
  if (await exists(tileURL.replace('{z}','12').replace('{x}','3500').replace('{y}','1600'))) {
    const ecoTiles = L.tileLayer(tileURL, {
      pane: 'ecodrrPane',
      opacity: 0.85,
      maxZoom: 18
    }).addTo(map);
    ecoTiles.setZIndex(1000);          // さらに前面に
    overlays['ECO‑DRR（タイル）'] = ecoTiles;

    // もしマスクを掛けたい & MaskedTileLayer が使える & マスクGeoJSONがあるなら差し替え
    if (typeof MaskedTileLayer !== 'undefined' && await exists(maskURL)) {
      try{
        const maskData = await fetchJSON(maskURL);
        ecoTiles.remove();
        const ecoMasked = new MaskedTileLayer(tileURL, maskData, {
          pane: 'ecodrrPane',
          zIndex: 1000,
          opacity: 0.85,
          // invert: true,         // 必要に応じて
          // clipMode: 'evenodd'   // 実装に合わせて
        }).addTo(map);
        overlays['ECO‑DRR（マスクタイル）'] = ecoMasked;
        delete overlays['ECO‑DRR（タイル）'];
      }catch(e){
        console.warn('MaskedTileLayer 生成に失敗。タイルで続行します。', e);
      }
    }
    return;
  }

  // 2) タイルが無ければ、GeoJSON を最前面で描画
  if (await exists(gjURL)) {
    const ecoLayer = L.geoJSON(await fetchJSON(gjURL), {
      pane: 'ecodrrPane',
      style: {
        color: '#004D40',       // 線
        weight: 2,
        opacity: 0.9,
        fillColor: '#26A69A',   // 面
        fillOpacity: 0.35
      }
    }).addTo(map);
    ecoLayer.bringToFront();     // さらに前面に
    overlays['ECO‑DRR（GeoJSON）'] = ecoLayer;
    return;
  }

  // 3) どれも無ければログ
  logMsg('ECO‑DRR のタイル/GeoJSON が見つかりませんでした。パス設定を確認してください。');
}

///////////////////////////
//  起動時フロー
///////////////////////////
async function boot(){
  await loadGeoJSON(srcInput.value);  // 点データ
  await addEcoDRR();                  // ECO‑DRR を最前面で追加
}
boot();

// UI
if (loadBtn) loadBtn.onclick = ()=> loadGeoJSON(srcInput.value);
if (fitBtn)  fitBtn.onclick  = ()=> { if(lastBounds && lastBounds.isValid()) map.fitBounds(lastBounds.pad(0.2)); };