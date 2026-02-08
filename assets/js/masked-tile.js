// window.MaskedTileLayer として公開（ESM不要）
(function () {
  const MaskedTileLayer = L.TileLayer.extend({
    initialize: function (url, options) {
      L.TileLayer.prototype.initialize.call(this, url, options || {});
      this._filter = "none";
      this._mask = null;   // FeatureCollection
      this._mapRef = null; // Leaflet map
    },

    setFilter: function (h, s, b) {
      this._filter = `hue-rotate(${h}deg) saturate(${s}) brightness(${b})`;
      this.redraw();
    },

    setMask: function (featureCollection, mapRef) {
      this._mask = featureCollection;
      this._mapRef = mapRef;
      this.redraw();
    },

    createTile: function (coords, done) {
      const size = 256;
      const tile = L.DomUtil.create("canvas", "leaflet-tile");
      tile.width = tile.height = size;
      const ctx = tile.getContext("2d");

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = this.getTileUrl(coords);

      img.onload = () => {
        // マスク無しならそのまま描画
        if (!this._mask || !this._mapRef) {
          ctx.filter = this._filter;
          ctx.drawImage(img, 0, 0);
          done(null, tile);
          return;
        }

        try {
          ctx.save();
          ctx.beginPath();

          const z = coords.z;
          const tileOriginX = coords.x * size;
          const tileOriginY = coords.y * size;

          const features = Array.isArray(this._mask.features) ? this._mask.features : [];

          features.forEach((ft) => {
            const geom = ft?.geometry;
            if (!geom) return;

            const polys =
              geom.type === "MultiPolygon" ? geom.coordinates :
              geom.type === "Polygon" ? [geom.coordinates] :
              [];

            polys.forEach((polygon) => {
              polygon.forEach((ring) => {
                ring.forEach((pt, i) => {
                  // GeoJSON: [lng, lat]
                  const latlng = L.latLng(pt[1], pt[0]);
                  const p = this._mapRef.project(latlng, z);
                  const cx = p.x - tileOriginX;
                  const cy = p.y - tileOriginY;
                  if (i === 0) ctx.moveTo(cx, cy);
                  else ctx.lineTo(cx, cy);
                });
                ctx.closePath();
              });
            });
          });

          // 穴（内側リング）にも強い
          ctx.clip("evenodd");

          ctx.filter = this._filter;
          ctx.drawImage(img, 0, 0);
          ctx.restore();

          done(null, tile);
        } catch (e) {
          // 失敗しても空タイルは返す
          ctx.clearRect(0, 0, size, size);
          done(null, tile);
        }
      };

      img.onerror = () => done(null, tile);
      return tile;
    }
  });

  window.MaskedTileLayer = MaskedTileLayer;
})();