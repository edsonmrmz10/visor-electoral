# Cartografía electoral — Santa Catarina, N.L.

Visualizador web de **sección electoral**, **manzana** y **colonia**, con selección, búsqueda, relaciones entre capas
y plano individual imprimible (carta). Sitio estático (HTML + JS + Leaflet vendorizado): **no requiere build ni variables de entorno**.

## Ejecutar localmente

```bash
python3 -m http.server 8123 --directory public   # o: npx serve public
# abrir http://localhost:8123
```

## Desplegar en Vercel

1. Sube esta carpeta a un repositorio (o usa `vercel` desde ella).
2. En Vercel: *Add New → Project* → importa el repo. `vercel.json` ya fija `outputDirectory: public` y sin build.
3. Deploy. CLI alternativa: `npm i -g vercel && vercel --prod`.

Variables de entorno: **ninguna**. Para cambiar el proveedor de mosaicos (base cartográfica) edita `public/js/config.js`.

## Datos y su conexión con la app

El repositorio `edsonmrmz10/data-santa` se copió a `source-data/`. `scripts/build_data.py` lo convierte y escribe `public/data/*.json` (ya incluidos):

```bash
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/build_data.py            # lee source-data/
```

| Capa | Archivo elegido | CRS original | Features | Campos clave |
|---|---|---|---|---|
| Sección | `secciones.geojson` | EPSG:32614 (UTM 14N) | 117 | SECCION, ENTIDAD, MUNICIPIO, TIPO, CONTROL, ID |
| Manzana | `manzanas secciones.geojson` | EPSG:4326 (CRS84) | 3 482 | SECCION, MANZANA, LOCALIDAD, DISTRITO_F/L, STATUS, CONTROL, ID2 |
| Colonia | `colonias.geojson` | LCC ITRF2008 (sin CRS declarado en el GeoJSON; tomado de `colonias.qmd`) | 254 | COLONIA, CVE_COL, CP, CLASIF, indicadores CONAPO |

Solo hay un archivo por capa, así que no hubo que elegir entre candidatos. Todo se reproyecta a WGS84, con 5 decimales (~1 m);
el total pesa ~320 KB comprimido, por lo que no se usa teselado: cada capa se descarga solo cuando se necesita
y las manzanas solo se dibujan con zoom ≥ 14.

### Relaciones entre capas (solo las verificables)

- **Sección → manzanas por clave**: campo `SECCION` igual. Verificado contra la geometría: las 3 106 manzanas con clave existente caen dentro de su polígono.
- **Manzanas dentro de una sección con otra clave**: relación **solo espacial**, mostrada aparte y rotulada.
- **Sección ↔ colonia y manzana → colonia**: no hay clave común (`MUNICIPIO`=48 + `ENTIDAD`=19 solo equivale al `CVE_MUN`=19048 de colonias); se calculan por intersección de áreas (≥ 500 m², en UTM) o por punto representativo de la manzana. Se muestra el porcentaje de traslape.

### Inconsistencias en los GeoJSON (también en la app, «Ver inconsistencias»)

- Tres CRS distintos; colonias no lo declara en el GeoJSON.
- Tras actualizar `secciones.geojson` (117 secciones; los campos ahora vienen en minúsculas y `build_data.py` los normaliza), las secciones 2002 y 2006 se dividieron en 3115–3126, pero la capa de manzanas conserva las claves viejas: 366 manzanas llevan una clave `SECCION` inexistente en secciones (2002, 2006, y 2598/2807 fuera de toda sección). Se muestran como relación solo espacial. **Para corregirlo hay que actualizar `manzanas secciones.geojson`.** El informe exacto está en la app («Ver inconsistencias»).
- 109 manzanas quedan fuera de toda colonia.
- 7 pares (SECCION, MANZANA) duplicados con distinta `LOCALIDAD`.
- La capa de secciones no trae nombres; el significado de `TIPO` no está documentado en los archivos y se muestra tal cual. Los indicadores de colonias se muestran con su código (P6A14NAE, OVSDE…) sin inventar descripciones.
- Las manzanas cubren solo ~35 km² de los ~970 km² de secciones (zona urbana).

## Plano individual (carta)

Botón **Imprimir plano** → vista previa → **Imprimir / Guardar PDF** (el diálogo del navegador permite «Guardar como PDF»; desactiva encabezados y pie de página).

- Hoja **carta** (8.5×11 in); la orientación se elige sola según la forma del polígono (la que da mayor escala). `@page` sin márgenes.
- Dos zonas: mapa + panel lateral (tipo, identificadores, atributos, relaciones verificables, leyenda de las tres capas indicando cuáles aparecen).
- Fondo claro (OpenStreetMap), polígono seleccionado en **magenta** con relleno transparente; manzanas asociadas en líneas finas (se pueden desactivar). No se dibujan otras entidades.
- Escala gráfica calculada con Web Mercator a la latitud central (válida al imprimir al 100 %). No se añade norte, logos ni datos institucionales.
- Sin selección: aviso «Primero selecciona…» (y si se imprime con Ctrl/Cmd+P sin plano abierto, la hoja solo dice que no hay plano).
- «← Volver a la vista general» (o Esc) cierra el plano.

## Limitaciones

- Los mosaicos de `tile.openstreetmap.org` tienen política de uso justo; para tráfico alto configura otro proveedor en `public/js/config.js`. Sin conexión el plano se imprime sin base.
- La escala numérica (1:N) es aproximada; la barra gráfica es la referencia.
- Probado en Chromium (Blink); la vista previa de impresión del navegador no se pudo automatizar aquí, así que conviene revisar un PDF real en tu navegador.

## Archivos principales

`public/index.html`, `public/css/app.css`, `public/js/{app,plan,config}.js`, `public/vendor/leaflet/` (Leaflet 1.9.4), `public/data/*.json`, `scripts/build_data.py`, `vercel.json`, `source-data/`.

## Actualizar los datos

Vercel despliega **este** repositorio, no `data-santa`. Tras cambiar los GeoJSON: copia los nuevos a `source-data/`, ejecuta `python scripts/build_data.py`, y haz commit de `public/data/`.
