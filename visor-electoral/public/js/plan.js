/* Plano individual en tamaño carta (8.5 x 11 in). Mapa + panel lateral. */
(function () {
  'use strict';
  const PX_IN = 96;                     // 1 in CSS = 96 px
  const LETTER = { w: 8.5, h: 11 };
  const MARGIN = 0.35, GAP = 0.14;
  const PANEL_W = { landscape: 2.75, portrait: 2.45 };
  const MAGENTA = '#d6007f';
  const CFG = window.CE_CONFIG;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let map = null, cur = null, ready = false, tileTimer = null;

  // metros Web Mercator de un [lat,lng]
  const merc = (ll) => L.CRS.EPSG3857.project(L.latLng(ll));

  function chooseOrientation(bounds) {
    const a = merc(bounds.getSouthWest()), b = merc(bounds.getNorthEast());
    const w = Math.max(b.x - a.x, 1), h = Math.max(b.y - a.y, 1);
    const fit = (o) => {
      const sw = o === 'landscape' ? LETTER.h : LETTER.w, sh = o === 'landscape' ? LETTER.w : LETTER.h;
      const mw = sw - 2 * MARGIN - GAP - PANEL_W[o], mh = sh - 2 * MARGIN;
      return Math.min(mw / w, mh / h);       // pulgadas por metro
    };
    return fit('landscape') >= fit('portrait') ? 'landscape' : 'portrait';
  }

  function niceLength(maxM) {
    const steps = [1, 2, 5];
    let best = 1;
    for (let p = 0; p < 7; p++) for (const s of steps) { const v = s * Math.pow(10, p); if (v <= maxM) best = v; }
    return best;
  }
  const fmtLen = (m) => (m >= 1000 ? (m / 1000) + ' km' : m + ' m');

  function legendHTML(c) {
    const rows = [
      ['secciones', 'Sección electoral', '#1b6ca8'],
      ['manzanas', 'Manzana', '#555'],
      ['colonias', 'Colonia', '#3f7d20'],
    ].map(([k, label, color]) => {
      let sw, note = '';
      if (k === c.layerKey) {
        sw = `<span class="sw" style="background:${MAGENTA}33;border:2px solid ${MAGENTA}"></span>`;
        note = c.includeNei && k === 'secciones' ? ' <small>(seleccionada; vecinas en rojo)</small>' : ' <small>(seleccionada)</small>';
      } else if (k === 'secciones' && c.includeNei) {
        sw = `<span class="sw" style="border:1px solid #d00;background:transparent"></span>`;
        note = ' <small>(límites y claves vecinas, contexto)</small>';
      } else if (c.contextKey === k && c.includeCtx && c.contextFeatures.length) {
        sw = `<span class="sw" style="border-top:1px solid ${color};border-bottom:1px solid ${color};border-left:1px solid ${color};border-right:1px solid ${color};background:transparent"></span>`;
        note = ' <small>(asociadas, contexto)</small>';
      } else {
        sw = `<span class="sw" style="border:1px dashed #aaa;background:transparent"></span>`;
        note = ' <small>(no incluida en este plano)</small>';
      }
      return `<li>${sw}<span>${label}${note}</span></li>`;
    });
    return `<ul class="plegend">${rows.join('')}</ul>`;
  }

  function sheetHTML(c) {
    const rows = c.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
    const rel = (c.relRows || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
    return `
      <div class="pmap" id="pmap"></div>
      <div class="pside" style="width:${PANEL_W[c.orientation]}in">
        <span class="ptype">${esc(c.typeLabel)}</span>
        <h1>${esc(c.title)}</h1>
        <div><h2>Identificación y atributos</h2><table>${rows}</table></div>
        ${rel ? `<div><h2>Relaciones verificables</h2><table>${rel}</table></div>` : ''}
        <div><h2>Leyenda</h2>${legendHTML(c)}</div>
        <div class="pfoot">Datos: GeoJSON del repositorio data-santa.<br>Base cartográfica: © colaboradores de OpenStreetMap.<br>Impreso el ${esc(new Date().toLocaleDateString('es-MX', { dateStyle: 'long' }))}.</div>
      </div>`;
  }

  function scaleHTML(m) {
    const mpp = 156543.03392 * Math.cos(m.getCenter().lat * Math.PI / 180) / Math.pow(2, m.getZoom()); // m por px CSS
    const maxPx = 1.5 * PX_IN;
    const len = niceLength(maxPx * mpp);
    const px = len / mpp, n = 4;
    const ticks = [0, len / 2, len].map(fmtLen);
    const ratio = Math.round(mpp / (0.0254 / PX_IN));
    return `<div class="bar" style="width:${px}px">${'<i></i>'.repeat(n)}</div>
      <div class="lbl" style="width:${px}px"><span>0</span><span>${ticks[1].replace(' m', '').replace(' km', '')}</span><span>${ticks[2]}</span></div>
      <div class="ratio">≈ 1:${ratio.toLocaleString('es-MX')} impreso al 100 %<br>(Mercator, lat. central)</div>`;
  }

  function fitScaler() {
    const sc = $('#plan-scaler'), st = $('#plan-stage'), sh = $('#sheet');
    const w = sh.offsetWidth, h = sh.offsetHeight;
    const k = Math.min(1, (st.clientWidth - 32) / w, (st.clientHeight - 32) / h);
    sh.style.transformOrigin = 'top left';
    sh.style.transform = `scale(${k})`;
    sc.style.width = w * k + 'px'; sc.style.height = h * k + 'px';
  }

  function render() {
    const c = cur; if (!c) return;
    ready = false; clearTimeout(tileTimer);
    const btn = $('#plan-print'); btn.disabled = true; btn.textContent = 'Cargando mapa base…';
    if (map) { map.remove(); map = null; }

    const gj = L.geoJSON(c.feature);
    const bounds = gj.getBounds();
    c.orientation = chooseOrientation(bounds);
    const sw = c.orientation === 'landscape' ? LETTER.h : LETTER.w, sh = c.orientation === 'landscape' ? LETTER.w : LETTER.h;
    const sheet = $('#sheet');
    // Alto un poco menor que la hoja: evita una segunda página en blanco al imprimir.
    sheet.style.width = sw + 'in'; sheet.style.height = (sh - 0.02) + 'in';
    $('#page-style').textContent = `@page{size:letter ${c.orientation};margin:0}`;
    sheet.innerHTML = sheetHTML(c);

    const mapEl = $('#pmap');
    map = L.map(mapEl, { zoomControl: false, attributionControl: true, zoomSnap: 0, zoomAnimation: false, fadeAnimation: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, preferCanvas: false });
    map.attributionControl.setPrefix(false);
    const tiles = L.tileLayer(CFG.TILE_URL, { subdomains: CFG.TILE_SUBDOMAINS, maxZoom: 20, maxNativeZoom: CFG.TILE_MAX_NATIVE_ZOOM, attribution: CFG.TILE_ATTR });
    let errs = 0;
    tiles.on('tileerror', () => { errs++; });
    tiles.on('load', () => finish(errs ? 'Algunos mosaicos de la base no cargaron.' : ''));
    tiles.addTo(map);

    // Contexto (manzanas asociadas): líneas finas, sin relleno
    if (c.includeCtx && c.contextFeatures.length) {
      const colors = { manzanas: '#444', secciones: '#1b6ca8', colonias: '#3f7d20' };
      L.geoJSON({ type: 'FeatureCollection', features: c.contextFeatures },
        { interactive: false, style: { color: colors[c.contextKey] || '#444', weight: 0.7, fill: false, opacity: 0.9 } }).addTo(map);
    }
    // Selección: magenta, relleno transparente
    L.geoJSON(c.feature, { interactive: false, style: { color: MAGENTA, weight: 3, fillColor: MAGENTA, fillOpacity: 0.07, opacity: 1 } }).addTo(map);

    map.fitBounds(bounds, { padding: [Math.round(0.25 * PX_IN), Math.round(0.25 * PX_IN)], animate: false, maxZoom: 19 });
    const mb = map.getBounds();
    if (c.includeNei) {
      const sid = c.layerKey === 'secciones' ? c.feature.properties._i : -1;
      const nei = (c.allSections || []).filter((f) => f.properties._i !== sid && L.geoJSON(f).getBounds().intersects(mb));
      L.geoJSON({ type: 'FeatureCollection', features: nei }, { interactive: false, style: { color: '#d00', weight: 1.3, fill: false, opacity: 0.9 } }).addTo(map);
      nei.forEach((f) => {
        const b = L.geoJSON(f).getBounds();
        const w = Math.max(b.getWest(), mb.getWest()), e = Math.min(b.getEast(), mb.getEast());
        const s = Math.max(b.getSouth(), mb.getSouth()), n = Math.min(b.getNorth(), mb.getNorth());
        L.tooltip({ permanent: true, direction: 'center', className: 'plabel nlabel', opacity: 1 }).setContent(String(f.properties.SECCION)).setLatLng([(s + n) / 2, (w + e) / 2]).addTo(map);
      });
    }
    if (c.includeCtx && c.contextKey === 'manzanas' && map.getZoom() >= 16) {
      c.contextFeatures.forEach((f) => {
        L.tooltip({ permanent: true, direction: 'center', className: 'plabel mlabel', opacity: 1 }).setContent(String(f.properties.MANZANA)).setLatLng(L.geoJSON(f).getBounds().getCenter()).addTo(map);
      });
    }
    const ctr = bounds.getCenter();
    // Etiqueta del elemento en el centro del polígono
    L.tooltip({ permanent: true, direction: 'center', className: 'plabel', opacity: 1 }).setContent(esc(c.label)).setLatLng(ctr).addTo(map);

    const sc = L.DomUtil.create('div', 'pscale', mapEl);
    sc.innerHTML = scaleHTML(map);
    $('#plan-info').textContent = `Carta · ${c.orientation === 'landscape' ? 'horizontal' : 'vertical'} · el encuadre se ajusta a la geometría seleccionada`;
    fitScaler();
    // Si ningún mosaico se pidió/cargó, no bloquear indefinidamente
    tileTimer = setTimeout(() => finish('La base cartográfica tardó demasiado; se imprimirá sin ella o incompleta.'), 9000);
  }

  function finish(warn) {
    if (ready) return;
    ready = true; clearTimeout(tileTimer);
    const btn = $('#plan-print'); btn.disabled = false; btn.textContent = '🖨 Imprimir / Guardar PDF';
    if (warn && window.CE_toast) window.CE_toast(warn);
  }

  function open(ctx) {
    cur = ctx;
    cur.includeCtx = ctx.contextFeatures && ctx.contextFeatures.length > 0;
    cur.includeNei = !!(ctx.allSections && ctx.allSections.length);
    $('#plan-nei').checked = cur.includeNei; $('#plan-nei-wrap').hidden = !cur.includeNei;
    document.body.classList.add('plan-open');
    $('#plan-overlay').hidden = false;
    const wrap = $('#plan-ctx-wrap');
    wrap.hidden = !(ctx.contextFeatures && ctx.contextFeatures.length);
    $('#plan-ctx-label').textContent = ctx.contextToggleLabel || 'Incluir contexto';
    $('#plan-ctx').checked = true;
    render();
  }
  function close() {
    document.body.classList.remove('plan-open');
    $('#plan-overlay').hidden = true;
    if (map) { map.remove(); map = null; }
    clearTimeout(tileTimer); cur = null;
    $('#page-style').textContent = '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#plan-back').addEventListener('click', () => { close(); if (window.CE_onPlanClose) window.CE_onPlanClose(); });
    $('#plan-print').addEventListener('click', () => { if (ready) window.print(); });
    $('#plan-nei').addEventListener('change', (e) => { if (cur) { cur.includeNei = e.target.checked; render(); } });
    $('#plan-ctx').addEventListener('change', (e) => { if (cur) { cur.includeCtx = e.target.checked; render(); } });
    window.addEventListener('resize', () => { if (cur) fitScaler(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) { close(); if (window.CE_onPlanClose) window.CE_onPlanClose(); } });
  });

  window.Plan = { open, close };
})();
