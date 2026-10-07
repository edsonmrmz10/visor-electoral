(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ---------- Definición de capas (campos reales de los GeoJSON) ---------- */
  const COLORS = { secciones: '#4cc9f0', manzanas: '#f4a261', colonias: '#90be6d' };
  const MAGENTA = '#ff2bb0', GOLD = '#ffd166';
  const MAN_MIN_ZOOM = 14;
  const NAMES = { secciones: 'Sección electoral', manzanas: 'Manzana', colonias: 'Colonia' };

  const LABELS = {
    SECCION: 'Sección', ENTIDAD: 'Entidad (clave)', MUNICIPIO: 'Municipio (clave)', TIPO: 'Tipo', CONTROL: 'Control', ID: 'ID',
    MANZANA: 'Manzana', LOCALIDAD: 'Localidad (clave)', DISTRITO_F: 'Distrito federal', DISTRITO_L: 'Distrito local', STATUS: 'Status',
    DISPERSO: 'Disperso', ID2: 'ID2', CASO_CAPTU: 'Caso captura',
    COLONIA: 'Colonia', CVE_COL: 'CVE_COL', CLASIF: 'Clasificación', CP: 'Código postal', NOM_ENT: 'Entidad', NOM_MUN: 'Municipio',
    NOM_LOC: 'Localidad', NOM_SUN: 'Sistema urbano', CVE_MUN: 'CVE_MUN', CVE_LOC: 'CVE_LOC', SUN_2018: 'SUN 2018',
    POBTOT: 'Población total (POBTOT)', GM_2020: 'Grado de marginación 2020', IM_2020: 'Índice de marginación 2020', IMN_2020: 'Índice normalizado 2020',
    P6A14NAE: 'P6A14NAE', SBASC: 'SBASC', PSDSS: 'PSDSS', OVSDE: 'OVSDE', OVSEE: 'OVSEE', OVSAE: 'OVSAE', OVPT: 'OVPT', OVHAC: 'OVHAC',
    OVSREF: 'OVSREF', OVSINT: 'OVSINT', OVSCEL: 'OVSCEL', OBJECTID: 'OBJECTID', ID_COL: 'ID_COL', CVE_ENT: 'CVE_ENT', MUN: 'MUN', LOC: 'LOC',
  };
  const ATTR_ORDER = {
    secciones: ['SECCION', 'ENTIDAD', 'MUNICIPIO', 'DISTRITO_F', 'DISTRITO_L', 'TIPO', 'CONTROL', 'ID'],
    manzanas: ['MANZANA', 'SECCION', 'LOCALIDAD', 'MUNICIPIO', 'ENTIDAD', 'DISTRITO_F', 'DISTRITO_L', 'STATUS', 'DISPERSO', 'CONTROL', 'ID2', 'CASO_CAPTU'],
    colonias: ['COLONIA', 'CLASIF', 'CP', 'CVE_COL', 'NOM_MUN', 'NOM_LOC', 'NOM_ENT', 'NOM_SUN', 'POBTOT', 'GM_2020', 'IM_2020', 'IMN_2020',
      'P6A14NAE', 'SBASC', 'PSDSS', 'OVSDE', 'OVSEE', 'OVSAE', 'OVPT', 'OVHAC', 'OVSREF', 'OVSINT', 'OVSCEL', 'CVE_MUN', 'CVE_LOC', 'SUN_2018', 'OBJECTID', 'ID_COL', 'CVE_ENT', 'MUN', 'LOC'],
  };
  const NUMERIC = new Set(['POBTOT', 'IM_2020', 'IMN_2020', 'P6A14NAE', 'SBASC', 'PSDSS', 'OVSDE', 'OVSEE', 'OVSAE', 'OVPT', 'OVHAC', 'OVSREF', 'OVSINT', 'OVSCEL']);
  const fmtVal = (v, k) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' && NUMERIC.has(k) ? v.toLocaleString('es-MX', { maximumFractionDigits: 3 }) : String(v));
  const attrRows = (layer, p) => ATTR_ORDER[layer].filter((k) => k in p).map((k) => [LABELS[k] || k, fmtVal(p[k], k)]);

  const titleOf = (layer, p) => layer === 'secciones' ? `Sección ${p.SECCION}`
    : layer === 'manzanas' ? `Manzana ${p.MANZANA} · Sección ${p.SECCION}` : p.COLONIA;

  /* ---------- Estado ---------- */
  const S = {
    data: {},            // layer -> FeatureCollection
    leaf: {},            // layer -> L.GeoJSON
    byIdx: {},           // layer -> [feature]
    layerOf: {},         // layer -> Map(feature index -> leaflet layer)
    loading: {},         // layer -> Promise
    rel: null,
    active: 'secciones',
    vis: { secciones: true, manzanas: false, colonias: false },
    sel: null,           // {layer, i}
    related: null,       // L.GeoJSON
    filter: '',
    base: 'dark',
    bounds: null,
  };

  /* ---------- Mapa ---------- */
  const map = L.map('map', { zoomControl: true, preferCanvas: false, zoomSnap: 0.5, minZoom: 8, maxZoom: 19 });
  map.attributionControl.setPrefix(false);
  map.setView([25.67, -100.46], 11);
  ['colonias', 'secciones', 'manzanas', 'related', 'selected'].forEach((n, i) => { map.createPane(n).style.zIndex = 410 + i * 10; });
  const manRenderer = L.canvas({ pane: 'manzanas', padding: 0.3 });

  const CFG = window.CE_CONFIG;
  let baseLayer = null;
  function setBase(k) {
    S.base = k;
    if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
    if (k !== 'none') {
      baseLayer = L.tileLayer(CFG.TILE_URL, { subdomains: CFG.TILE_SUBDOMAINS, maxZoom: 20, maxNativeZoom: CFG.TILE_MAX_NATIVE_ZOOM,
        attribution: CFG.TILE_ATTR, className: k === 'dark' ? 'tiles-dark' : '' }).addTo(map);
      baseLayer.bringToBack();
    }
    document.querySelectorAll('#basemap button').forEach((b) => b.classList.toggle('on', b.dataset.base === k));
    $('#map').style.background = k === 'light' ? '#e9e6df' : '#0b1118';
  }

  /* ---------- UI helpers ---------- */
  function status(kind, html) {
    const el = $('#status');
    if (!kind) { el.innerHTML = ''; el.className = 'status'; return; }
    el.className = 'status ' + kind; el.innerHTML = `<div>${html}</div>`;
  }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4500); }
  window.CE_toast = toast;
  function hint(msg) { const h = $('#hint'); h.hidden = !msg; if (msg) h.textContent = msg; }
  function closeDrawers() { document.body.classList.remove('show-left', 'show-right'); $('#scrim').hidden = true; }
  function openDrawer(side) { closeDrawers(); document.body.classList.add('show-' + side); $('#scrim').hidden = false; }

  /* ---------- Carga de datos ---------- */
  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }
  function load(layer) {
    if (S.loading[layer]) return S.loading[layer];
    S.loading[layer] = (async () => {
      const [fc, rel] = await Promise.all([fetchJSON(`data/${layer}.json`), S.rel ? null : fetchJSON('data/relations.json')]);
      if (rel) S.rel = rel;
      S.data[layer] = fc;
      S.byIdx[layer] = fc.features;
      S.layerOf[layer] = new Map();
      const opts = { pane: layer, bubblingMouseEvents: false, style: () => baseStyle(layer), interactive: true,
        onEachFeature: (f, lyr) => {
          S.layerOf[layer].set(f.properties._i, lyr);
          lyr.on('click', (e) => { if (S.active === layer) { L.DomEvent.stopPropagation(e); select(layer, f.properties._i, { fit: false }); } });
          lyr.on('mouseover', () => { if (S.active === layer && !isSel(layer, f.properties._i)) lyr.setStyle({ weight: 2.2, fillOpacity: 0.28 }); });
          lyr.on('mouseout', () => { if (!isSel(layer, f.properties._i)) lyr.setStyle(baseStyle(layer, f)); });
          lyr.bindTooltip(() => esc(titleOf(layer, f.properties)), { sticky: true, direction: 'top', opacity: 0.95 });
        } };
      if (layer === 'manzanas') opts.renderer = manRenderer;
      S.leaf[layer] = L.geoJSON(fc, opts);
      $('#n-' + layer).textContent = fc.features.length.toLocaleString('es-MX');
    })();
    S.loading[layer].catch(() => { S.loading[layer] = null; });
    return S.loading[layer];
  }

  function matchesFilter(layer, p) {
    if (!S.filter || layer !== S.active) return true;
    const k = layer === 'secciones' ? 'TIPO' : layer === 'colonias' ? 'CLASIF' : null;
    return !k || String(p[k]) === S.filter;
  }
  function baseStyle(layer, f) {
    const isActive = S.active === layer;
    const dim = f && !matchesFilter(layer, f.properties);
    return { color: COLORS[layer], weight: layer === 'manzanas' ? 0.8 : 1.4, opacity: dim ? 0.2 : 0.95,
      fillColor: COLORS[layer], fillOpacity: dim ? 0.02 : layer === 'manzanas' ? 0.12 : isActive ? 0.1 : 0.04, interactive: isActive };
  }
  const isSel = (layer, i) => S.sel && S.sel.layer === layer && S.sel.i === i;

  function refreshStyles() {
    for (const layer of Object.keys(S.leaf)) {
      S.leaf[layer].eachLayer((lyr) => {
        const f = lyr.feature;
        if (isSel(layer, f.properties._i)) return;
        lyr.setStyle(baseStyle(layer, f));
        if (lyr._path) lyr._path.style.pointerEvents = S.active === layer ? '' : 'none';
      });
    }
  }

  async function syncLayers() {
    const z = map.getZoom();
    for (const layer of Object.keys(S.vis)) {
      const want = S.vis[layer] || S.active === layer;
      if (want) {
        try { status('', ''); if (!S.leaf[layer]) { status('load', `<span class="spinner"></span>Cargando ${NAMES[layer].toLowerCase()}s…`); await load(layer); status(); } }
        catch (e) { status('err', `No se pudieron cargar los datos de ${NAMES[layer].toLowerCase()}s. <button class="btn" id="retry">Reintentar</button><br><small>${esc(e.message)}</small>`);
          $('#retry').onclick = () => syncLayers(); return; }
      }
      const lf = S.leaf[layer]; if (!lf) continue;
      const show = (S.vis[layer] || S.active === layer) && (layer !== 'manzanas' || z >= MAN_MIN_ZOOM || isSelLayer('manzanas'));
      if (show && !map.hasLayer(lf)) lf.addTo(map); else if (!show && map.hasLayer(lf)) map.removeLayer(lf);
    }
    const needZoom = (S.vis.manzanas || S.active === 'manzanas') && z < MAN_MIN_ZOOM && !isSelLayer('manzanas');
    hint(needZoom ? 'Acerca el mapa (zoom ≥ 14) para ver las manzanas' : '');
    refreshStyles(); updateLegend();
  }
  const isSelLayer = (l) => S.sel && S.sel.layer === l;

  /* ---------- Selección ---------- */
  function featOf(layer, i) { return S.byIdx[layer][i]; }
  async function select(layer, i, { fit = true } = {}) {
    clearRelated();
    const prev = S.sel; S.sel = { layer, i };
    if (prev) { const l = S.layerOf[prev.layer] && S.layerOf[prev.layer].get(prev.i); if (l) { l.setStyle(baseStyle(prev.layer, l.feature)); } }
    if (S.active !== layer) { await setActive(layer, { keepSel: true }); }
    await load(layer);
    const lyr = S.layerOf[layer].get(i);
    if (!S.leaf[layer]) await load(layer);
    if (!map.hasLayer(S.leaf[layer])) S.leaf[layer].addTo(map);
    drawSelection(layer, i);
    showInfo(layer, i);
    if (fit) fitTo(layer, i);
  }
  let selOverlay = null;
  function drawSelection(layer, i) {
    if (selOverlay) { map.removeLayer(selOverlay); selOverlay = null; }
    selOverlay = L.geoJSON(featOf(layer, i), { pane: 'selected', interactive: false,
      style: { color: MAGENTA, weight: 3, fillColor: MAGENTA, fillOpacity: 0.22, opacity: 1 } }).addTo(map);
  }
  function fitTo(layer, i) {
    const b = L.geoJSON(featOf(layer, i)).getBounds();
    const pad = window.innerWidth <= 860 ? [20, 20] : [60, 60];
    map.fitBounds(b, { padding: pad, maxZoom: 18 });
  }
  function clearSelection() {
    S.sel = null; clearRelated();
    if (selOverlay) { map.removeLayer(selOverlay); selOverlay = null; }
    $('#info').hidden = true; $('#info-empty').hidden = false;
    syncLayers();
  }

  /* ---------- Relaciones (solo verificables) ---------- */
  const lists = {};
  function relations(layer, i) {
    const R = S.rel, out = [];
    const P = (l, k) => S.byIdx[l] && S.byIdx[l][k].properties;
    if (layer === 'secciones') {
      const sec = P('secciones', i);
      const man = S.byIdx.manzanas;
      if (man) {
        const byKey = [], spatialOther = [];
        man.forEach((f, k) => {
          const inside = R.manzana_seccion_espacial[k] === i;
          if (f.properties.SECCION === sec.SECCION) byKey.push(k);
          else if (inside) spatialOther.push(k);
        });
        out.push({ kind: 'manzanas', title: `Manzanas con clave SECCION = ${sec.SECCION}`, items: byKey,
          note: 'Coincidencia por el campo SECCION; verificada contra la geometría (todas están dentro del polígono).' });
        if (spatialOther.length) {
          const keys = [...new Set(spatialOther.map((k) => man[k].properties.SECCION))].sort();
          out.push({ kind: 'manzanas', title: `Manzanas dentro del polígono con otra clave (${keys.join(', ')})`, items: spatialOther,
            note: 'Relación solo espacial: su campo SECCION es distinto y no existe en la capa de secciones.' });
        }
      }
      const rows = R.seccion_colonia[i] || [];
      out.push({ kind: 'colonias', title: 'Colonias que intersectan la sección', items: rows.map((r) => r[0]),
        extra: rows.map((r) => `${r[2].toLocaleString('es-MX')} % de la sección`),
        note: 'Relación espacial (no hay clave común). Intersecciones ≥ 500 m².' });
    } else if (layer === 'colonias') {
      const mans = [];
      R.manzana_colonia_espacial.forEach((c, k) => { if (c === i) mans.push(k); });
      out.push({ kind: 'manzanas', title: 'Manzanas ubicadas dentro de la colonia', items: mans,
        note: 'Relación espacial por punto representativo de la manzana.' });
      const secs = [], ex = [];
      Object.entries(R.seccion_colonia).forEach(([s, rows]) => { const r = rows.find((x) => x[0] === i); if (r) secs.push([+s, r]); });
      secs.sort((a, b) => b[1][1] - a[1][1]);
      out.push({ kind: 'secciones', title: 'Secciones que intersectan la colonia', items: secs.map((x) => x[0]),
        extra: secs.map((x) => `${x[1][3].toLocaleString('es-MX')} % de la colonia`),
        note: 'Relación espacial (no hay clave común). Intersecciones ≥ 500 m².' });
    } else {
      const p = P('manzanas', i);
      const sKey = S.byIdx.secciones && S.byIdx.secciones.findIndex((f) => f.properties.SECCION === p.SECCION);
      const sSp = R.manzana_seccion_espacial[i], cSp = R.manzana_colonia_espacial[i];
      if (sKey >= 0) out.push({ kind: 'secciones', title: `Sección con clave ${p.SECCION}`, items: [sKey], note: 'Por campo SECCION.' });
      else out.push({ kind: 'none', title: `Sección con clave ${p.SECCION}`, items: [], note: 'Esa clave no existe en la capa de secciones.' });
      if (sSp >= 0 && sSp !== sKey) out.push({ kind: 'secciones', title: 'Sección que contiene espacialmente a la manzana', items: [sSp], note: 'Relación espacial; difiere de la clave de la manzana.' });
      out.push(cSp >= 0 ? { kind: 'colonias', title: 'Colonia que la contiene', items: [cSp], note: 'Relación espacial (punto representativo).' }
        : { kind: 'none', title: 'Colonia', items: [], note: 'La manzana no cae dentro de ninguna colonia de la capa.' });
    }
    return out;
  }

  async function showInfo(layer, i) {
    const f = featOf(layer, i), p = f.properties;
    $('#info-empty').hidden = true; $('#info').hidden = false;
    $('#info-type').textContent = NAMES[layer];
    $('#info-title').textContent = titleOf(layer, p);
    const t = $('#attrs'); t.innerHTML = attrRows(layer, p).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
    const box = $('#related'); box.innerHTML = '<p class="note"><span class="spinner"></span>Calculando relaciones…</p>';
    try { await Promise.all(['secciones', 'manzanas', 'colonias'].map(load)); } catch (e) { box.innerHTML = `<p class="note">No se pudieron cargar las capas relacionadas: ${esc(e.message)}</p>`; return; }
    if (!isSel(layer, i)) return;
    const rels = relations(layer, i);
    box.innerHTML = ''; lists.cur = rels;
    rels.forEach((r, n) => {
      const h = document.createElement('div');
      const head = `<h3>${esc(r.title)} <span style="color:var(--txt)">(${r.items.length.toLocaleString('es-MX')})</span></h3>` + (r.note ? `<p class="note">${esc(r.note)}</p>` : '');
      let body = '';
      if (r.items.length) {
        if (r.items.length > 1 || r.kind === 'manzanas') body += `<div class="rel-btns"><button class="btn" data-show="${n}">Ver en el mapa</button></div>`;
        const shown = r.items.slice(0, 80);
        if (r.kind === 'manzanas') body += `<div class="chips">${shown.map((k) => `<button class="chip" data-go="manzanas:${k}">${esc(S.byIdx.manzanas[k].properties.MANZANA)}</button>`).join('')}${r.items.length > 80 ? `<span class="note">…y ${r.items.length - 80} más</span>` : ''}</div>`;
        else body += `<ul class="rel-list">${shown.map((k, j) => `<li data-go="${r.kind}:${k}"><span>${esc(titleOf(r.kind, S.byIdx[r.kind][k].properties))}</span><span>${esc(r.extra ? r.extra[j] : '')}</span></li>`).join('')}</ul>`;
      }
      h.innerHTML = head + body; box.appendChild(h);
    });
  }

  function clearRelated() { if (S.related) { map.removeLayer(S.related); S.related = null; } }
  async function showRelated(r) {
    clearRelated();
    const feats = r.items.map((k) => S.byIdx[r.kind][k]);
    if (r.kind === 'manzanas' && !map.hasLayer(S.leaf.manzanas)) { /* se dibuja en la capa related igualmente */ }
    S.related = L.geoJSON({ type: 'FeatureCollection', features: feats }, { pane: 'related', interactive: false,
      style: { color: GOLD, weight: 2, fillColor: GOLD, fillOpacity: 0.18 } }).addTo(map);
    map.fitBounds(S.related.getBounds(), { padding: window.innerWidth <= 860 ? [20, 20] : [60, 60], maxZoom: 18 });
    if (window.innerWidth <= 860) closeDrawers();
  }

  /* ---------- Leyenda ---------- */
  function updateLegend() {
    const rows = [];
    for (const l of ['secciones', 'manzanas', 'colonias']) {
      if (S.vis[l] || S.active === l) {
        const n = l === 'manzanas' && map.getZoom() < MAN_MIN_ZOOM ? ' <small style="color:var(--mut)">(acerca el mapa)</small>' : '';
        rows.push(`<li><span class="sw" style="border-color:${COLORS[l]};background:${COLORS[l]}33"></span>${NAMES[l]}${S.active === l ? ' <small style="color:var(--mut)">· activa</small>' : ''}${n}</li>`);
      }
    }
    if (S.sel) rows.push(`<li><span class="sw" style="border-color:${MAGENTA};background:${MAGENTA}44"></span>Elemento seleccionado</li>`);
    if (S.related) rows.push(`<li><span class="sw" style="border-color:${GOLD};background:${GOLD}33"></span>Elementos asociados</li>`);
    $('#legend-list').innerHTML = rows.join('');
  }

  /* ---------- Capa activa / filtros / búsqueda ---------- */
  async function setActive(layer, { keepSel = false } = {}) {
    S.active = layer; S.filter = '';
    document.querySelector(`input[name=active][value=${layer}]`).checked = true;
    const cb = document.querySelector(`#visibility input[data-layer=${layer}]`); if (cb) { cb.checked = true; }
    S.vis[layer] = true;
    $('#q').placeholder = layer === 'secciones' ? 'Buscar sección (p. ej. 2000)…' : layer === 'manzanas' ? 'Buscar manzana (p. ej. 2000 63)…' : 'Buscar colonia, C.P. o clave…';
    setupFilter();
    if (!keepSel) { if (S.sel && S.sel.layer !== layer) clearSelection(); }
    await syncLayers();
  }
  function setupFilter() {
    const sec = $('#filters'), sel = $('#filter-select');
    const k = S.active === 'secciones' ? 'TIPO' : S.active === 'colonias' ? 'CLASIF' : null;
    sec.hidden = !k;
    if (!k) return;
    $('#filter-label').textContent = k === 'TIPO' ? 'Tipo de sección (campo TIPO)' : 'Clasificación (campo CLASIF)';
    const fill = () => {
      const vals = [...new Set(S.data[S.active].features.map((f) => f.properties[k]))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
      sel.innerHTML = '<option value="">Todos</option>' + vals.map((v) => `<option>${esc(v)}</option>`).join('');
    };
    if (S.data[S.active]) fill(); else load(S.active).then(fill).catch(() => {});
  }

  function search(q) {
    const layer = S.active, feats = S.data[layer] ? S.data[layer].features : [];
    const toks = norm(q).split(/[\s\-_,/]+/).filter(Boolean);
    if (!toks.length) return null;
    const out = [];
    for (const f of feats) {
      const p = f.properties; if (!matchesFilter(layer, p)) continue;
      let hay;
      if (layer === 'secciones') hay = [String(p.SECCION)];
      else if (layer === 'manzanas') hay = [String(p.SECCION), String(p.MANZANA), String(p.ID2), String(p.CONTROL)];
      else hay = [norm(p.COLONIA), String(p.CP), norm(p.CVE_COL), norm(p.NOM_LOC)];
      const ok = toks.every((t) => hay.some((h) => (/^\d+$/.test(t) && layer !== 'colonias') ? h.startsWith(t) : h.includes(t)));
      if (ok) out.push(f);
    }
    if (layer === 'manzanas' && toks.length === 1) out.sort((a, b) => a.properties.SECCION - b.properties.SECCION);
    return out;
  }
  let hl = -1, cur = [];
  async function runSearch() {
    const q = $('#q').value, ul = $('#results');
    if (!q.trim()) { ul.hidden = true; return; }
    if (!S.data[S.active]) { try { await load(S.active); } catch (e) { ul.hidden = false; ul.innerHTML = `<li class="none">Error al cargar datos: ${esc(e.message)}</li>`; return; } }
    cur = search(q) || []; hl = -1;
    ul.hidden = false;
    if (!cur.length) { ul.innerHTML = '<li class="none">Sin resultados para «' + esc(q) + '» en ' + NAMES[S.active].toLowerCase() + 's.</li>'; return; }
    ul.innerHTML = cur.slice(0, 40).map((f, n) => {
      const p = f.properties;
      const sub = S.active === 'colonias' ? `${p.CLASIF} · C.P. ${p.CP}` : S.active === 'manzanas' ? `Loc. ${p.LOCALIDAD}` : `Tipo ${p.TIPO}`;
      return `<li data-n="${n}"><span>${esc(titleOf(S.active, p))}</span><small>${esc(sub)}</small></li>`;
    }).join('') + (cur.length > 40 ? `<li class="more">${cur.length - 40} resultados más — afina la búsqueda</li>` : `<li class="more">${cur.length} resultado(s)</li>`);
  }
  function pick(n) { const f = cur[n]; if (!f) return; $('#results').hidden = true; $('#q').blur(); select(S.active, f.properties._i); closeDrawers(); }

  /* ---------- Impresión ---------- */
  function print() {
    if (!S.sel) { toast('Primero selecciona una sección, manzana o colonia en el mapa para imprimir su plano.'); return; }
    const { layer, i } = S.sel, f = featOf(layer, i), p = f.properties;
    closeDrawers();
    let ctxFeatures = [], ctxKey = null, label = '', ctxLabel = '', rel = [];
    if (S.rel && S.byIdx.manzanas) {
      const R = S.rel;
      if (layer === 'secciones') {
        const idx = []; S.byIdx.manzanas.forEach((m, k) => { if (R.manzana_seccion_espacial[k] === i || m.properties.SECCION === p.SECCION) idx.push(k); });
        ctxFeatures = idx.map((k) => S.byIdx.manzanas[k]); ctxKey = 'manzanas'; ctxLabel = `Incluir manzanas asociadas (${idx.length})`;
        const key = S.byIdx.manzanas.filter((m) => m.properties.SECCION === p.SECCION).length;
        rel = [['Manzanas con clave SECCION', String(key)], ['Manzanas dentro del polígono', String(idx.length)]];
        const rows = R.seccion_colonia[i] || []; rel.push(['Colonias que intersectan', String(rows.length)]);
      } else if (layer === 'colonias') {
        const idx = []; R.manzana_colonia_espacial.forEach((c, k) => { if (c === i) idx.push(k); });
        ctxFeatures = idx.map((k) => S.byIdx.manzanas[k]); ctxKey = 'manzanas'; ctxLabel = `Incluir manzanas dentro de la colonia (${idx.length})`;
        rel = [['Manzanas dentro de la colonia', String(idx.length)]];
      } else {
        const sSp = R.manzana_seccion_espacial[i], cSp = R.manzana_colonia_espacial[i];
        if (sSp >= 0) rel.push(['Sección que la contiene', String(S.byIdx.secciones[sSp].properties.SECCION)]);
        if (cSp >= 0) rel.push(['Colonia que la contiene', S.byIdx.colonias[cSp].properties.COLONIA]);
      }
    }
    label = layer === 'secciones' ? String(p.SECCION) : layer === 'manzanas' ? `Mz ${p.MANZANA}` : p.COLONIA;
    const rows = attrRows(layer, p).filter(([, v]) => v !== '—');
    Plan.open({ layerKey: layer, typeLabel: NAMES[layer], title: titleOf(layer, p), label, rows, relRows: rel, feature: f,
      allSections: S.byIdx.secciones, contextFeatures: ctxFeatures, contextKey: ctxKey, contextToggleLabel: ctxLabel });
  }
  window.CE_onPlanClose = () => { /* regreso a la vista general conservando selección */ map.invalidateSize(); };

  /* ---------- Informe de datos ---------- */
  async function showReport() {
    const d = $('#report-dialog'), b = $('#report-body');
    try {
      const r = await fetchJSON('data/report.json');
      const pairs = {};
      Object.entries(r.clave_manzana_vs_seccion_que_la_contiene).forEach(([k, n]) => { const [a, c] = k.split('->'); (pairs[a] = pairs[a] || []).push(c + ' (' + n + ')'); });
      b.innerHTML = `<ul>
        <li>Manzanas cuya clave SECCION existe en la capa de secciones y caen dentro de ese polígono: <b>${r.manzanas_clave_coincide_y_contenida}</b> (con clave existente pero fuera de él: ${r.manzanas_clave_coincide_pero_fuera}).</li>
        <li>Manzanas con clave SECCION que <b>no existe</b> en la capa de secciones: <b>${r.manzanas_con_clave_inexistente_en_secciones}</b>. Claves (manzanas): ${Object.entries(r.claves_inexistentes).map(([k, n]) => k + ' (' + n + ')').join(', ')}.</li>
        <li>Dónde caen espacialmente esas claves: ${Object.entries(pairs).map(([a, c]) => a + ' → secciones ' + c.join(', ')).join('; ') || '—'}.</li>
        <li>Secciones sin manzanas por clave: ${r.secciones_sin_manzanas_por_clave.join(', ') || 'ninguna'}.</li>
        <li>Manzanas fuera de toda sección: ${r.manzanas_fuera_de_toda_seccion}; fuera de toda colonia: ${r.manzanas_fuera_de_toda_colonia}.</li>
        <li>Pares (SECCION, MANZANA) duplicados (distinta localidad): ${r.pares_seccion_manzana_duplicados}.</li></ul>
        <p>Las capas están en tres sistemas de coordenadas distintos (UTM 14N, WGS84 y LCC ITRF2008) y se reproyectaron a WGS84. Más detalle en el README.</p>`;
    } catch (e) { b.textContent = 'No se pudo cargar el informe: ' + e.message; }
    d.showModal();
  }

  /* ---------- Eventos ---------- */
  function wire() {
    document.querySelectorAll('input[name=active]').forEach((r) => r.addEventListener('change', () => setActive(r.value)));
    document.querySelectorAll('#visibility input').forEach((c) => c.addEventListener('change', () => {
      const l = c.dataset.layer;
      if (!c.checked && S.active === l) { c.checked = true; toast('La capa activa siempre está visible; cambia de capa activa para ocultarla.'); return; }
      S.vis[l] = c.checked; syncLayers();
    }));
    $('#filter-select').addEventListener('change', (e) => { S.filter = e.target.value; refreshStyles(); runSearch(); });
    document.querySelectorAll('#basemap button').forEach((b) => b.addEventListener('click', () => setBase(b.dataset.base)));
    $('#q').addEventListener('input', runSearch);
    $('#q').addEventListener('focus', runSearch);
    $('#q').addEventListener('keydown', (e) => {
      const items = [...document.querySelectorAll('#results li[data-n]')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(0, Math.min(items.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1))); items.forEach((li, n) => li.classList.toggle('hl', n === hl)); items[hl] && items[hl].scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { pick(hl >= 0 ? hl : 0); }
      else if (e.key === 'Escape') { $('#results').hidden = true; }
    });
    $('#results').addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-n]'); if (li) { e.preventDefault(); pick(+li.dataset.n); } });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('#results').hidden = true; });
    $('#opacity').addEventListener('input', (e) => ['colonias', 'secciones', 'manzanas', 'related', 'selected'].forEach((n) => { map.getPane(n).style.opacity = e.target.value / 100; }));
    $('#btn-print').addEventListener('click', print); $('#btn-print2').addEventListener('click', print);
    $('#btn-clear').addEventListener('click', clearSelection);
    $('#btn-zoom').addEventListener('click', () => { if (S.sel) { fitTo(S.sel.layer, S.sel.i); closeDrawers(); } });
    $('#btn-home').addEventListener('click', () => { clearRelated(); if (S.bounds) map.fitBounds(S.bounds, { padding: [20, 20] }); updateLegend(); });
    $('#btn-report').addEventListener('click', showReport);
    $('#btn-left').addEventListener('click', () => (document.body.classList.contains('show-left') ? closeDrawers() : openDrawer('left')));
    $('#btn-right').addEventListener('click', () => (document.body.classList.contains('show-right') ? closeDrawers() : openDrawer('right')));
    $('#scrim').addEventListener('click', closeDrawers);
    $('#related').addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]'), sh = e.target.closest('[data-show]');
      if (go) { const [l, k] = go.dataset.go.split(':'); select(l, +k); }
      else if (sh) { showRelated(lists.cur[+sh.dataset.show]); updateLegend(); }
    });
    map.on('zoomend', syncLayers);
    map.on('click', () => { /* clic en vacío: no deselecciona, para evitar pérdidas accidentales */ });
    window.addEventListener('beforeprint', () => { /* el CSS de impresión oculta todo salvo el plano */ });
  }

  /* ---------- Inicio ---------- */
  async function init() {
    wire(); setBase('dark'); updateLegend();
    status('load', '<span class="spinner"></span>Cargando secciones electorales…');
    try {
      await load('secciones');
      S.bounds = S.leaf.secciones.getBounds();
      map.fitBounds(S.bounds, { padding: [20, 20] });
      S.leaf.secciones.addTo(map);
      status(); setupFilter();
      // subtítulo derivado de los datos: ENTIDAD+MUNICIPIO de secciones = CVE_MUN de colonias
      const sp = S.data.secciones.features[0].properties;
      $('#subtitle').textContent = `Entidad ${sp.ENTIDAD} · Municipio ${sp.MUNICIPIO} · ${S.data.secciones.features.length} secciones`;
      load('colonias').then(() => {
        const c = S.data.colonias.features[0].properties;
        if (String(c.CVE_MUN) === String(sp.ENTIDAD) + String(sp.MUNICIPIO).padStart(3, '0'))
          $('#subtitle').textContent = `${c.NOM_MUN}, ${c.NOM_ENT} · ${S.data.secciones.features.length} secciones`;
      }).catch(() => {});
      updateLegend();
    } catch (e) {
      status('err', `No se pudieron cargar los datos. <button class="btn" id="retry">Reintentar</button><br><small>${esc(e.message)}</small>`);
      $('#retry').onclick = () => location.reload();
      $('#subtitle').textContent = 'Error de carga';
    }
  }
  init();
})();
