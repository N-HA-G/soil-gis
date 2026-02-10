<script>
// window.MaskedTileLayer として公開（ESM不要）
(function () {
  const MaskedTileLayer = L.TileLayer.extend({
    initialize: function (url, options) {
      L.TileLayer.prototype.initialize.call(this, url, options || {});
      this._filter = 'none';
      this._mask = null;   // FeatureCollection
      this._mapRef = null; // Leaflet Map
    },
    setFilter: function (h, s, b) {
      this._filter = `hue-rotate(${h}deg) saturate(${s}) brightness(${b})`;
      this.redraw();
      return this;
    },
    setMask: function (featureCollection, mapRef) {
      this._mask = featureCollection || null;
      this._mapRef = mapRef || null;
      this.redraw();
      return this;
    },
    createTile: function (coords, done) {
      const size = 256;
      const tile = L.DomUtil.create('canvas', 'leaflet-tile');
      tile.width = tile.height = size;
      const ctx = tile.getContext('2d');

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = this.getTileUrl(coords);

      img.onload = () => {
        if (!this._mask || !this._mapRef) {
          ctx.filter = this._filter;
          ctx.drawImage(img, 0, 0);
          return done && done(null, tile);
        }

        ctx.save();
        ctx.beginPath();

        const z = coords.z;
        const tileOriginX = coords.x * size;
        const tileOriginY = coords.y * size;

        const geom = this._mask.features[0].geometry;
        const polys = (geom.type === 'MultiPolygon') ? geom.coordinates : [geom.coordinates];

        polys.forEach(polygon => {
          polygon.forEach(ring => {
            ring.forEach((pt, i) => {
              const latlng = L.latLng(pt[1], pt[0]);
              const p = this._mapRef.project(latlng, z);
              const cx = p.x - tileOriginX;
              const cy = p.y - tileOriginY;
              if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
            });
            ctx.closePath();
          });
        });

        ctx.clip('nonzero');
        ctx.filter = this._filter;
        ctx.drawImage(img, 0, 0);
        ctx.restore();

        done && done(null, tile);
      };

      img.onerror = () => done && done(null, tile);
      return tile;
    }
  });

  window.MaskedTileLayer = MaskedTileLayer;
})();
</script>