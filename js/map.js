/* World map: real streets (OpenStreetMap tiles) and real building footprints
   (Overpass API). Click a building to open a business in it. */
(function () {
  'use strict';

  const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const MIN_ZOOM = 16;          // buildings are only loaded from this zoom on
  const MAX_BBOX = 0.0012;      // deg² — refuse to query areas larger than this
  const MAX_CACHE = 15000;

  const COLORS = {
    free: { color: '#4a554e', weight: 0.8, fillColor: '#262d29', fillOpacity: 0.9 },
    hover: { color: '#c8f169', weight: 1.6 },
    owned: { color: '#c8f169', weight: 1.4, fillColor: '#c8f169', fillOpacity: 0.55 },
    rival: { color: '#d9a441', weight: 1, fillColor: '#d9a441', fillOpacity: 0.22 },
    selected: { color: '#ffffff', weight: 2.2 },
  };

  const KIND = {
    residential: 'Residencial', apartments: 'Residencial', house: 'Vivienda', detached: 'Vivienda', terrace: 'Vivienda',
    commercial: 'Comercial', retail: 'Comercial', office: 'Oficinas', supermarket: 'Comercial', kiosk: 'Comercial',
    industrial: 'Industrial', warehouse: 'Nave industrial', manufacture: 'Industrial', hangar: 'Nave industrial',
    farm: 'Agrícola', barn: 'Agrícola', greenhouse: 'Invernadero', church: 'Religioso', school: 'Educativo',
    university: 'Educativo', hospital: 'Sanitario', hotel: 'Hotel', garage: 'Garaje', garages: 'Garaje', yes: 'Edificio',
  };
  // Price multiplier per building kind (commercial land is pricier, industrial cheaper).
  const KIND_MULT = { Comercial: 1.35, Oficinas: 1.3, Hotel: 1.3, Industrial: 0.75, 'Nave industrial': 0.7, Agrícola: 0.55, Invernadero: 0.55 };

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function polygonArea(geom) {
    const lat0 = (geom[0][0] * Math.PI) / 180;
    const kx = 111320 * Math.cos(lat0), ky = 110540;
    let a = 0;
    for (let i = 0, j = geom.length - 1; i < geom.length; j = i++) {
      a += (geom[j][1] * kx) * (geom[i][0] * ky) - (geom[i][1] * kx) * (geom[j][0] * ky);
    }
    return Math.abs(a / 2);
  }

  function centroid(geom) {
    let lat = 0, lng = 0;
    for (const p of geom) { lat += p[0]; lng += p[1]; }
    return [lat / geom.length, lng / geom.length];
  }

  // Turns an Overpass way into a plot record with deterministic game values.
  function toRecord(el) {
    const geom = el.geometry.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]);
    if (geom.length < 3) return null;
    const tags = el.tags || {};
    const id = `w${el.id}`;
    const kind = KIND[tags.building] || (tags.building ? tags.building[0].toUpperCase() + tags.building.slice(1) : 'Edificio');
    const floors = Math.max(1, Math.min(8, parseInt(tags['building:levels'], 10) || 1));
    const footprint = polygonArea(geom);
    const area = Math.max(40, Math.round(footprint * Math.min(floors, 3))); // usable floor space
    const [lat, lng] = centroid(geom);
    const street = tags['addr:street'];
    const addr = street ? `${street}${tags['addr:housenumber'] ? ' ' + tags['addr:housenumber'] : ''}` : (tags.name || `${kind} sin dirección`);
    // Neighbourhood value: stable per ~500 m cell, so nearby plots price alike.
    const zone = 0.7 + (hash(`${Math.round(lat * 200)}:${Math.round(lng * 200)}`) % 1000) / 1100;
    const ppm2 = 3 * zone * (KIND_MULT[kind] || 1);
    const price = Math.max(300, Math.round((footprint * ppm2) / 50) * 50);
    const maxLevel = Math.max(1, Math.min(10, Math.ceil(area / 150)));
    const h = hash(id);
    return { id, geom, lat, lng, addr, kind, area, floors, price, maxLevel, zone, rival: h % 11 === 0 ? h % 5 : null };
  }

  function siteFromRecord(r) {
    return { osmId: r.id, lat: r.lat, lng: r.lng, addr: r.addr, kind: r.kind, area: r.area, price: r.price, maxLevel: r.maxLevel, geom: r.geom };
  }

  window.createMapView = function (h) {
    const G = window.Game;
    const { BUILDINGS } = G;
    const cache = new Map();     // id -> plot record (kept between visits)
    const fetched = [];          // bboxes already loaded
    let map = null, buildingLayer = null, ownedLayer = null, renderer = null;
    let drawn = new Map();       // id -> L.Polygon
    let selected = null, hovered = null;
    let status = 'idle', controller = null, debounce = null;
    let searchResults = [];
    let lastPanel = '', lastOwnedSig = '';

    const fmtArea = (m2) => `${G.fmtQty(m2)} m²`;
    const ownerOfRec = (r) => G.ownerOf(r.id);
    const rivalName = (r) => (r.rival !== null ? G.state.rivals[r.rival]?.name : null);

    /* ---------- styles ---------- */
    function styleFor(r) {
      let st = ownerOfRec(r) ? COLORS.owned : rivalName(r) ? COLORS.rival : COLORS.free;
      if (hovered === r.id) st = { ...st, ...COLORS.hover };
      if (selected === r.id) st = { ...st, ...COLORS.selected };
      return st;
    }
    function restyle(id) {
      const poly = drawn.get(id);
      const r = cache.get(id);
      if (poly && r) poly.setStyle(styleFor(r));
    }

    /* ---------- drawing ---------- */
    function draw(r) {
      if (drawn.has(r.id)) return;
      const poly = L.polygon(r.geom, { renderer, ...styleFor(r), bubblingMouseEvents: false });
      poly.on('click', () => select(r.id));
      poly.on('mouseover', () => { const prev = hovered; hovered = r.id; if (prev) restyle(prev); restyle(r.id); });
      poly.on('mouseout', () => { if (hovered === r.id) { hovered = null; restyle(r.id); } });
      poly.addTo(buildingLayer);
      drawn.set(r.id, poly);
    }

    function drawOwned() {
      const owned = G.state.buildings.filter((b) => b.site);
      const sig = owned.map((b) => `${b.uid}:${b.site.osmId}`).join(',');
      if (sig === lastOwnedSig) return;
      lastOwnedSig = sig;
      ownedLayer.clearLayers();
      for (const b of owned) {
        if (!cache.has(b.site.osmId)) cache.set(b.site.osmId, { id: b.site.osmId, rival: null, zone: 1, floors: 1, ...b.site });
        const r = cache.get(b.site.osmId);
        draw(r);
        restyle(r.id);
        L.circleMarker([b.site.lat, b.site.lng], {
          radius: 6, color: '#0c0e0d', weight: 2, fillColor: '#c8f169', fillOpacity: 1, interactive: true,
        }).bindTooltip(`${BUILDINGS[b.type].name} · N${b.level}`, { direction: 'top', offset: [0, -6], className: 'map-tip' })
          .on('click', () => { select(r.id); if (map.getZoom() < MIN_ZOOM) map.flyTo([r.lat, r.lng], 17); })
          .addTo(ownedLayer);
      }
    }

    /* ---------- loading buildings from Overpass ---------- */
    function contains(a, b) { return a.s <= b.s && a.w <= b.w && a.n >= b.n && a.e >= b.e; }

    function scheduleLoad() {
      clearTimeout(debounce);
      debounce = setTimeout(load, 450);
    }

    async function load() {
      if (!map) return;
      const zoom = map.getZoom();
      if (zoom < MIN_ZOOM) { setStatus('zoom'); toggleBuildings(false); return; }
      toggleBuildings(true);
      const b = map.getBounds();
      const view = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
      if (fetched.some((f) => contains(f, view))) { setStatus('ready'); return; }
      const pb = b.pad(0.25);
      const box = { s: pb.getSouth(), w: pb.getWest(), n: pb.getNorth(), e: pb.getEast() };
      if ((box.n - box.s) * (box.e - box.w) > MAX_BBOX) { setStatus('zoom'); return; }

      if (controller) controller.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setStatus('loading');
      const q = `[out:json][timeout:25];way["building"](${box.s.toFixed(6)},${box.w.toFixed(6)},${box.n.toFixed(6)},${box.e.toFixed(6)});out tags geom;`;
      for (const url of OVERPASS) {
        try {
          const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (signal.aborted || !map) return;
          if (cache.size > MAX_CACHE) evict();
          for (const el of data.elements || []) {
            if (el.type !== 'way' || !el.geometry || cache.has(`w${el.id}`)) continue;
            const r = toRecord(el);
            if (r) cache.set(r.id, r);
          }
          fetched.push(box);
          for (const r of cache.values()) draw(r);
          setStatus('ready');
          return;
        } catch (err) {
          if (signal.aborted) return;
        }
      }
      setStatus('error');
    }

    function evict() {
      const keep = new Set(G.state.buildings.filter((b) => b.site).map((b) => b.site.osmId));
      for (const id of [...cache.keys()]) {
        if (keep.has(id)) continue;
        cache.delete(id);
        const poly = drawn.get(id);
        if (poly) { buildingLayer.removeLayer(poly); drawn.delete(id); }
      }
      fetched.length = 0;
    }

    function toggleBuildings(on) {
      if (!map) return;
      if (on && !map.hasLayer(buildingLayer)) buildingLayer.addTo(map);
      if (!on && map.hasLayer(buildingLayer)) map.removeLayer(buildingLayer);
    }

    function setStatus(s) {
      status = s;
      const el = document.getElementById('map-status');
      if (!el) return;
      const count = [...cache.values()].length;
      const html = {
        idle: '',
        loading: `<span class="spinner" aria-hidden="true"></span>Cargando edificios reales…`,
        ready: `${h.icon('check')}${G.fmtQty(count)} edificios cargados`,
        zoom: `${h.icon('search')}Acércate para ver los edificios <button class="btn btn-sm" type="button" data-maction="zoomin">Acercar</button>`,
        error: `${h.icon('alert')}No se pudieron cargar los edificios <button class="btn btn-sm" type="button" data-maction="retry">Reintentar</button>`,
      }[s];
      el.innerHTML = html;
      el.className = `map-status ${s === 'error' ? 'is-error' : ''}`;
      el.hidden = !html;
    }

    /* ---------- selection & panel ---------- */
    function select(id) {
      const prev = selected;
      selected = id;
      if (prev) restyle(prev);
      if (id) restyle(id);
      if (id) drawn.get(id)?.bringToFront();
      renderPanel(true);
    }

    function panelHTML() {
      const s = G.state;
      const placing = h.ui.placing;
      const placingBar = placing ? `
        <div class="placing">
          ${h.icon('pin')}<div><strong>Ubicando: ${h.esc(BUILDINGS[placing].name)}</strong><span>Elige un edificio en el mapa.</span></div>
          <button class="btn btn-ghost btn-sm" type="button" data-maction="cancel-place">Cancelar</button>
        </div>` : '';

      const r = selected && cache.get(selected);
      if (!r) {
        const owned = s.buildings.filter((b) => b.site);
        return `${placingBar}
          <div class="panel-section">
            <h2 class="card-title">Tus locales</h2>
            ${owned.length ? `<div class="site-list">${owned.map((b) => `
              <button class="site-item" type="button" data-maction="fly" data-id="${h.esc(b.site.osmId)}">
                <span class="site-dot"></span>
                <span><strong>${h.esc(BUILDINGS[b.type].name)}</strong><small>${h.esc(b.site.addr)}</small></span>
                <span class="level">N${b.level}</span>
              </button>`).join('')}</div>`
              : `<p class="muted">Aún no tienes locales. Acércate a cualquier calle y haz clic en un edificio para abrir tu primer negocio.</p>`}
          </div>
          <div class="panel-section legend">
            <span><i class="lg lg-free"></i>Disponible</span>
            <span><i class="lg lg-own"></i>Tuyo</span>
            <span><i class="lg lg-rival"></i>Rival</span>
          </div>`;
      }

      const mine = ownerOfRec(r);
      const rival = rivalName(r);
      const facts = `
        <div class="facts">
          <div><span>Tipo</span><strong>${h.esc(r.kind)}</strong></div>
          <div><span>Superficie</span><strong>${fmtArea(r.area)}</strong></div>
          <div><span>Precio del local</span><strong>${h.money(r.price, 0)}</strong></div>
          <div><span>Nivel máximo</span><strong>N${r.maxLevel}</strong></div>
        </div>`;
      const head = `
        <div class="panel-head">
          <div><span class="eyebrow">${h.icon('pin')}${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</span><h2 class="panel-title">${h.esc(r.addr)}</h2></div>
          <button class="btn btn-ghost btn-icon btn-sm" type="button" data-maction="close" aria-label="Cerrar" data-tip="Cerrar">${xIcon()}</button>
        </div>`;

      if (mine) {
        const def = BUILDINGS[mine.type];
        const maxed = mine.level >= G.maxLevel(mine);
        return `${placingBar}${head}
          <div class="owned-card">
            <div class="row"><strong>${h.esc(def.name)}</strong>${h.statusBadge(mine)}</div>
            ${h.recipe(mine.type, mine.level)}
            <div class="progress"><span style="width:${(mine.level / G.maxLevel(mine)) * 100}%"></span></div>
            <small class="muted">Nivel ${mine.level} de ${G.maxLevel(mine)} que permite este edificio</small>
          </div>
          ${facts}
          <div class="btn-row">
            <button class="btn btn-primary btn-grow" type="button" data-action="upgrade" data-uid="${mine.uid}" ${maxed || s.cash < G.upgradeCost(mine) ? 'disabled' : ''}>
              ${h.icon('up')}${maxed ? 'Sin espacio para ampliar' : `Ampliar <span class="btn-meta">${h.money(G.upgradeCost(mine), 0)}</span>`}
            </button>
            <button class="btn" type="button" data-action="nav" data-view="buildings">Gestionar</button>
          </div>`;
      }

      if (rival) {
        return `${placingBar}${head}${facts}
          <div class="notice">${h.icon('alert')}<span>Este edificio pertenece a <strong>${h.esc(rival)}</strong>. Elige otro.</span></div>`;
      }

      const types = placing ? [placing] : Object.keys(BUILDINGS);
      return `${placingBar}${head}${facts}
        <div class="panel-section">
          <h3 class="field-label">${placing ? 'Confirmar apertura' : 'Abrir un negocio aquí'}</h3>
          <div class="biz-list">${types.map((t) => {
            const def = BUILDINGS[t];
            const total = def.cost + r.price;
            const m = G.estimateMargin(t);
            return `
            <div class="biz">
              <div class="biz-info"><strong>${h.esc(def.name)}</strong>
                <small><span class="${m >= 0 ? 'up' : 'down'}">${m >= 0 ? '+' : ''}${h.money(m, 0)}/h</span> · ${h.money(def.cost, 0)} + local</small></div>
              <button class="btn ${placing ? 'btn-primary' : ''} btn-sm" type="button" data-maction="open" data-type="${t}" ${s.cash < total ? 'disabled' : ''}>
                Abrir <span class="btn-meta">${h.money(total, 0)}</span>
              </button>
            </div>`;
          }).join('')}</div>
          ${placing ? '<button class="btn btn-ghost btn-sm" type="button" data-maction="cancel-place">Ver todos los negocios</button>' : ''}
        </div>`;
    }

    function xIcon() { return '<svg class="icon" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'; }

    function renderPanel(force) {
      const el = document.getElementById('map-panel-body');
      if (!el) return;
      const html = panelHTML();
      if (force || html !== lastPanel) { el.innerHTML = html; lastPanel = html; }
    }

    function renderResults() {
      const el = document.getElementById('map-results');
      if (!el) return;
      el.hidden = !searchResults.length;
      el.innerHTML = searchResults.map((r, i) => `
        <button class="result" type="button" data-maction="goto" data-i="${i}">${h.icon('pin')}<span>${h.esc(r.display_name)}</span></button>`).join('');
    }

    async function search(q) {
      if (!q.trim()) return;
      const btn = document.getElementById('map-search-btn');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(`${NOMINATIM}?format=jsonv2&limit=5&accept-language=es&q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error();
        searchResults = await res.json();
        if (!searchResults.length) searchResults = [{ display_name: 'Sin resultados', none: true }];
      } catch (e) {
        searchResults = [{ display_name: 'La búsqueda no está disponible ahora', none: true }];
      }
      if (btn) btn.disabled = false;
      renderResults();
    }

    /* ---------- events inside the map view ---------- */
    function onClick(e) {
      const t = e.target.closest('[data-maction]');
      if (!t || t.disabled) return;
      const a = t.dataset.maction;
      if (a === 'close') select(null);
      else if (a === 'zoomin') map.setZoom(17);
      else if (a === 'retry') { fetched.length = 0; load(); }
      else if (a === 'cancel-place') { h.ui.placing = null; renderPanel(true); }
      else if (a === 'fly') {
        const r = cache.get(t.dataset.id);
        if (r) { map.flyTo([r.lat, r.lng], 18, { duration: 0.8 }); select(r.id); }
      } else if (a === 'goto') {
        const r = searchResults[Number(t.dataset.i)];
        if (!r || r.none) return;
        searchResults = []; renderResults();
        const bb = r.boundingbox && r.boundingbox.map(Number);
        if (bb && (bb[1] - bb[0]) * (bb[3] - bb[2]) < MAX_BBOX / 2) map.flyTo([Number(r.lat), Number(r.lon)], 18, { duration: 1.2 });
        else map.flyTo([Number(r.lat), Number(r.lon)], 17, { duration: 1.2 });
      } else if (a === 'geo') {
        if (!navigator.geolocation) return;
        t.disabled = true;
        navigator.geolocation.getCurrentPosition(
          (p) => { t.disabled = false; map.flyTo([p.coords.latitude, p.coords.longitude], 17, { duration: 1.2 }); },
          () => { t.disabled = false; },
          { timeout: 8000 },
        );
      } else if (a === 'open') {
        const r = cache.get(selected);
        if (r && G.build(t.dataset.type, siteFromRecord(r))) {
          h.ui.placing = null;
          drawOwned(); restyle(r.id);
          h.refresh(); renderPanel(true);
        }
      }
    }

    function onSubmit(e) {
      if (e.target.id !== 'map-search') return;
      e.preventDefault();
      search(e.target.elements.q.value);
    }

    return {
      render() {
        return `
          <div class="map-shell">
            <div class="map-wrap">
              <div id="world-map" class="world-map" role="application" aria-label="Mapa del mundo con edificios reales"></div>
              <div id="map-status" class="map-status" role="status" hidden></div>
            </div>
            <aside class="map-panel" aria-label="Detalles del mapa">
              <div class="map-panel-top">
                <form id="map-search" class="search" role="search">
                  ${h.icon('search')}
                  <input class="search-input" name="q" type="search" placeholder="Buscar ciudad, calle o dirección" aria-label="Buscar lugar" autocomplete="off">
                  <button class="btn btn-sm" id="map-search-btn" type="submit">Buscar</button>
                </form>
                <button class="btn btn-icon" type="button" data-maction="geo" aria-label="Mi ubicación" data-tip="Mi ubicación">${h.icon('locate')}</button>
              </div>
              <div id="map-results" class="results" hidden></div>
              <div id="map-panel-body" class="map-panel-body"></div>
            </aside>
          </div>`;
      },
      mount(root) {
        const mv = G.state.mapView;
        map = L.map('world-map', { zoomControl: false, minZoom: 3, maxZoom: 19, worldCopyJump: true, preferCanvas: true })
          .setView([mv.lat, mv.lng], mv.zoom);
        L.control.zoom({ position: 'bottomright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
        L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: 'abcd', maxZoom: 20 }).addTo(map);
        renderer = L.canvas({ padding: 0.3 });
        buildingLayer = L.layerGroup();
        ownedLayer = L.layerGroup().addTo(map);
        drawn = new Map();
        lastOwnedSig = ''; lastPanel = '';
        for (const r of cache.values()) draw(r);
        drawOwned();
        map.on('moveend', () => {
          if (!map) return;
          const c = map.getCenter();
          G.state.mapView = { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), zoom: map.getZoom() };
          scheduleLoad();
        });
        map.on('click', () => select(null));
        root.addEventListener('click', onClick);
        root.addEventListener('submit', onSubmit);

        if (h.ui.placing) selected = null;
        if (h.ui.locate) {
          const b = G.state.buildings.find((x) => x.uid === h.ui.locate);
          h.ui.locate = null;
          if (b && b.site) { map.setView([b.site.lat, b.site.lng], 18); selected = b.site.osmId; restyle(selected); }
        }
        renderPanel(true);
        load();
      },
      unmount() {
        clearTimeout(debounce);
        if (controller) controller.abort();
        const root = document.getElementById('main');
        root.removeEventListener('click', onClick);
        root.removeEventListener('submit', onSubmit);
        if (map) { map.remove(); map = null; }
        drawn = new Map();
        hovered = null;
      },
      update() {
        if (!map) return;
        drawOwned();
        renderPanel(false);
      },
    };
  };
})();
