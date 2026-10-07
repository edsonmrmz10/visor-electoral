#!/usr/bin/env python3
"""Convierte los GeoJSON de source-data/ a WGS84 (EPSG:4326), los aligera y
calcula las relaciones verificables entre capas.

Salida (public/data/):
  secciones.json, manzanas.json, colonias.json   GeoJSON en WGS84
  relations.json                                 relaciones calculadas
  report.json                                    inconsistencias detectadas

Uso:  python scripts/build_data.py [directorio-fuente]
"""
import json, sys, collections
from pathlib import Path
from pyproj import Transformer, CRS
from shapely.geometry import shape, mapping
from shapely.ops import transform
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "source-data"
OUT = ROOT / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

# CRS de cada archivo (ver los .qmd de QGIS: el GeoJSON de colonias no declara CRS)
LCC = CRS.from_proj4("+proj=lcc +lat_0=12 +lon_0=-102 +lat_1=17.5 +lat_2=29.5 "
                     "+x_0=2500000 +y_0=0 +ellps=GRS80 +units=m +no_defs")
LAYERS = {
    "secciones": ("secciones.geojson", CRS.from_epsg(32614)),
    "manzanas": ("manzanas secciones.geojson", CRS.from_epsg(4326)),
    "colonias": ("colonias.geojson", LCC),
}
KEEP = {
    "manzanas": ["ID2", "ENTIDAD", "DISTRITO_F", "DISTRITO_L", "MUNICIPIO", "SECCION",
                 "LOCALIDAD", "MANZANA", "STATUS", "DISPERSO", "CONTROL", "CASO_CAPTU"],
}
UTM = CRS.from_epsg(32614)


def rnd(c, n=5):
    if isinstance(c[0], (int, float)):
        return [round(c[0], n), round(c[1], n)]
    return [rnd(x, n) for x in c]


# La capa de secciones se actualizó con campos en minúsculas; se normalizan a los nombres de la app.
RENAME = {"secciones": {"seccion": "SECCION", "entidad": "ENTIDAD", "municipio": "MUNICIPIO", "tipo": "TIPO",
                        "_control": "CONTROL", "_id": "ID", "distrito": "DISTRITO_F", "distrito_l": "DISTRITO_L"}}


def clean(v):
    if isinstance(v, float):
        return int(v) if v == int(v) else round(v, 4)
    return v


geoms_wgs, geoms_utm, feats = {}, {}, {}
for name, (fn, crs) in LAYERS.items():
    d = json.load(open(SRC / fn))
    to_w = Transformer.from_crs(crs, 4326, always_xy=True).transform
    to_u = Transformer.from_crs(crs, UTM, always_xy=True).transform
    gw, gu, out = [], [], []
    for i, f in enumerate(d["features"]):
        g = shape(f["geometry"])
        gw.append(transform(to_w, g)); gu.append(transform(to_u, g))
        props = {RENAME.get(name, {}).get(k, k): v for k, v in f["properties"].items()}
        props.pop("gid", None); props.pop("fid", None)
        p = {k: clean(v) for k, v in props.items() if k in KEEP.get(name, props.keys())}
        p["_i"] = i
        out.append({"type": "Feature", "properties": p,
                    "geometry": {"type": "MultiPolygon",
                                 "coordinates": rnd(mapping(gw[-1])["coordinates"] if gw[-1].geom_type == "MultiPolygon"
                                                    else [mapping(gw[-1])["coordinates"]])}})
    geoms_wgs[name], geoms_utm[name], feats[name] = gw, gu, out
    json.dump({"type": "FeatureCollection", "features": out}, open(OUT / f"{name}.json", "w"),
              separators=(",", ":"), ensure_ascii=False)
    print(name, len(out), "features")

sec, man, col = (geoms_utm[k] for k in ("secciones", "manzanas", "colonias"))
sp = [f["properties"] for f in feats["secciones"]]
mp = [f["properties"] for f in feats["manzanas"]]
sec_tree, col_tree = STRtree(sec), STRtree(col)

# manzana -> sección / colonia que la contiene (punto representativo, espacial)
man_sec, man_col = [], []
for g in man:
    p = g.representative_point()
    s = [i for i in sec_tree.query(p) if sec[i].contains(p)]
    c = [i for i in col_tree.query(p) if col[i].contains(p)]
    man_sec.append(int(s[0]) if s else -1)
    man_col.append(int(c[0]) if c else -1)

# sección <-> colonia por intersección de áreas (m², UTM 14N)
MIN_AREA = 500.0
sec_col = {}
for i, g in enumerate(sec):
    rows = []
    for j in col_tree.query(g):
        a = g.intersection(col[j]).area
        if a >= MIN_AREA:
            rows.append([int(j), round(a), round(100 * a / g.area, 2), round(100 * a / col[j].area, 2)])
    rows.sort(key=lambda r: -r[1])
    if rows:
        sec_col[int(i)] = rows

json.dump({"manzana_seccion_espacial": man_sec, "manzana_colonia_espacial": man_col,
           "seccion_colonia": sec_col, "min_area_m2": MIN_AREA},
          open(OUT / "relations.json", "w"), separators=(",", ":"))

# ---- informe de consistencia
sec_ids = {p["SECCION"]: i for i, p in enumerate(sp)}
by_key_ok = by_key_bad = 0
orphan = collections.Counter()
mismatch = collections.Counter()
for i, p in enumerate(mp):
    if p["SECCION"] in sec_ids:
        if man_sec[i] == sec_ids[p["SECCION"]]: by_key_ok += 1
        else: by_key_bad += 1
    else:
        orphan[p["SECCION"]] += 1
        if man_sec[i] >= 0: mismatch[(p["SECCION"], sp[man_sec[i]]["SECCION"])] += 1
dup = collections.Counter((p["SECCION"], p["MANZANA"]) for p in mp)
report = {
    "secciones": len(sp), "manzanas": len(mp), "colonias": len(feats["colonias"]),
    "manzanas_clave_coincide_y_contenida": by_key_ok,
    "manzanas_clave_coincide_pero_fuera": by_key_bad,
    "manzanas_con_clave_inexistente_en_secciones": sum(orphan.values()),
    "claves_inexistentes": dict(sorted(orphan.items())),
    "clave_manzana_vs_seccion_que_la_contiene": {f"{a}->{b}": n for (a, b), n in mismatch.items()},
    "manzanas_fuera_de_toda_seccion": sum(1 for s in man_sec if s < 0),
    "manzanas_fuera_de_toda_colonia": sum(1 for c in man_col if c < 0),
    "secciones_sin_manzanas_por_clave": sorted(set(sec_ids) - {p["SECCION"] for p in mp}),
    "pares_seccion_manzana_duplicados": sum(1 for v in dup.values() if v > 1),
}
json.dump(report, open(OUT / "report.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps(report, indent=1, ensure_ascii=False))
