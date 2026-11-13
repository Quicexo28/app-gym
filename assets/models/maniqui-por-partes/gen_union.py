#!/usr/bin/env python
"""Une torso.glb y extremidades.glb (Meshy, ya segmentados) en un solo maniquí por partes, con material sólido por pieza.
Cada GLB viene normalizado a 180 cm por separado; la escala y la posición salen de sus imágenes (misma cuadrícula):
  torso (cabeza->pelvis): 753 px de 1490 de cuerpo -> x0.5054, base a 89,15 cm; extremidades (pie->hombro): 1232,35 px -> x0,8271, base en el suelo.
Lado = anatómico (model -X = derecho, +X = izquierdo; el modelo mira a +Z).
Uso: /tmp/mask-venv/bin/python -I assets/models/maniqui-por-partes/gen_union.py"""
import json, os, numpy as np, trimesh
from trimesh.visual.material import PBRMaterial
HERE = os.path.dirname(os.path.abspath(__file__)); K = 1500.0           # unidades del GLB por cm = 1/1500
ST, SL = 753 / 1490, 1232.35 / 1490
TORSO_Y = 180 - (774 - 22) / 8.2778 - 3.0; TORSO_Z = -1.2   # cm; -3,0 cm: la pelvis se solapa un poco con los muslos (mejor solape que hueco)
TORSO = {6:'cabeza', 2:'cuello', 3:'trapecio_superior', 1:'trapecio_medio', 9:'pecho', 8:'abdomen',
         4:'dorsal_izq', 5:'dorsal_der', 0:'lumbar', 7:'pelvis'}
LIMBS = {17:'hombro_der', 18:'hombro_izq', 6:'biceps_der', 7:'biceps_izq', 13:'tricep_der', 12:'tricep_izq',
         16:'antebrazo_der', 15:'antebrazo_izq', 0:'mano_der', 3:'mano_izq', 2:'pie_der', 1:'pie_izq',
         24:'pantorrilla_der', 23:'pantorrilla_izq', 19:'gluteo_der', 14:'gluteo_izq', 25:'cuadriceps_der', 22:'cuadriceps_izq',
         21:'femoral_der', 20:'femoral_izq', 4:'aductor_der', 5:'aductor_izq',
         8:'interno_hombro_der', 9:'interno_hombro_izq', 10:'interno_cadera_der', 11:'interno_cadera_izq'}
def load(p):
    s = trimesh.load(p); P = {}
    for n in s.graph.nodes_geometry:
        T, g = s.graph[n]; m = s.geometry[g].copy(); m.apply_transform(T); P[int(n.replace('model_part', ''))] = m
    return P
T = load(HERE + '/fuentes/torso.glb'); L = load(HERE + '/fuentes/extremidades.glb')
assert set(T) == set(TORSO) and set(L) == set(LIMBS)
meshes = {}
for i, name in TORSO.items():
    m = T[i].copy(); v = m.vertices * K * ST; v[:, 1] += TORSO_Y; v[:, 2] += TORSO_Z; m.vertices = v / K; meshes[name] = m
for i, name in LIMBS.items():
    m = L[i].copy(); m.vertices = m.vertices * SL; meshes[name] = m
# piernas: se suben LEG_LIFT cm (solo las piernas, no los brazos) para cerrar el hueco con la pelvis
LEG_LIFT = 2.0
LEG_PIECES = ('gluteo', 'cuadriceps', 'femoral', 'aductor', 'pantorrilla', 'pie', 'interno_cadera')
for name, m in meshes.items():
    if name.startswith(LEG_PIECES):
        v = m.vertices.copy(); v[:, 1] += LEG_LIFT / K; m.vertices = v
# lumbar visible: en el GLB la lumbar queda debajo de los dorsales. En vez de borrar caras vecinas (deja bordes sueltos y ranuras),
# las caras externas de dorsales/trapecio/pelvis que cubren la huella de la lumbar pasan a ser la pieza "lumbar".
# La lumbar original (interna) se descarta: asi hay una sola capa continua y sin parpadeo.
from PIL import Image, ImageDraw
PX, OX, OY = 10, -40.0, 60.0                                     # 10 px por cm
lum = meshes['lumbar']; foot = Image.new('L', (80 * PX, 100 * PX), 0); dr = ImageDraw.Draw(foot)
for t in lum.triangles * K: dr.polygon([((x - OX) * PX, (y - OY) * PX) for x, y, _ in t], fill=255)
foot = np.array(foot) > 0
def in_footprint(c):
    ix = ((c[:, 0] - OX) * PX).astype(int); iy = ((c[:, 1] - OY) * PX).astype(int)
    ok = (ix >= 0) & (ix < foot.shape[1]) & (iy >= 0) & (iy < foot.shape[0]); r = np.zeros(len(c), bool); r[ok] = foot[iy[ok], ix[ok]]; return r
def smooth(m, mask, valid, iters=3):
    """Limpia el borde: una cara pasa al lado donde esta la mayoria de sus vecinas externas (quita dientes y huecos sueltos).
    Solo votan las caras externas (`valid`): las internas del casco no cuentan."""
    adj = m.face_adjacency
    for _ in range(iters):
        yes = np.zeros(len(mask)); tot = np.zeros(len(mask))
        for a_, b_ in ((adj[:, 0], adj[:, 1]), (adj[:, 1], adj[:, 0])):
            ok = valid[b_]; np.add.at(yes, a_[ok], mask[b_[ok]]); np.add.at(tot, a_[ok], 1)
        mask = np.where(tot >= 2, yes * 2 > tot, mask) & valid
    return mask
moved = {}; lumbar_parts = []
for name in ('dorsal_izq', 'dorsal_der', 'trapecio_medio', 'pelvis'):
    m = meshes[name]; c = m.triangles_center * K
    outer = m.face_normals[:, 2] < 0
    take = smooth(m, in_footprint(c) & outer, outer)
    moved[name] = int(take.sum())
    if take.any():
        lumbar_parts.append(m.submesh([np.where(take)[0]], append=True))
        meshes[name] = m.submesh([np.where(~take)[0]], append=True) if (~take).any() else m
meshes['lumbar'] = trimesh.util.concatenate(lumbar_parts)
removed = moved
# costura pelvis-piernas: al solaparse, las dos superficies se cruzan en un diente de sierra de ~5 mm.
# Se dibuja quien queda visible (frente y espalda) en una imagen, se suaviza esa frontera y cada pieza conserva solo su lado.
from scipy.ndimage import uniform_filter
SEAM_PX, SEAM_FILTER = 20, 31                                    # 20 px por cm; filtro de ~1,5 cm
LEGS = ('gluteo_der', 'gluteo_izq', 'cuadriceps_der', 'cuadriceps_izq', 'aductor_der', 'aductor_izq')
def seam(view):
    sgn = 1 if view == 'frente' else -1
    X0, X1, Y0, Y1 = -30.0, 30.0, 80.0, 125.0
    W, H = int((X1 - X0) * SEAM_PX), int((Y1 - Y0) * SEAM_PX)
    items = [('pelvis', 1)] + [(n, 2) for n in LEGS]
    info = {}; polys = []; depth = []; lab = []
    for name, cls in items:
        m = meshes[name]; c = m.triangles_center * K; keep = m.face_normals[:, 2] * sgn > 0.15
        info[name] = (c, keep)
        t = (m.triangles * K)[keep]
        polys.append(np.stack([(t[..., 0] - X0) * SEAM_PX, (Y1 - t[..., 1]) * SEAM_PX], -1))
        depth.append(sgn * t[..., 2].mean(1)); lab.append(np.full(len(t), cls))
    polys = np.concatenate(polys); depth = np.concatenate(depth); lab = np.concatenate(lab)
    img = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(img)
    for k in np.argsort(depth): dr.polygon([tuple(q) for q in polys[k]], fill=int(lab[k]))
    cls = np.array(img); legs = uniform_filter((cls == 2).astype(float), size=SEAM_FILTER)
    pel = uniform_filter((cls == 1).astype(float), size=SEAM_FILTER)
    owner = np.where(legs > pel, 2, 1) * ((cls > 0) | (legs + pel > 0.2))      # 1 = pelvis, 2 = piernas, 0 = nada
    res = {}
    for name, c_ in items:
        c, keep = info[name]; ix = ((c[:, 0] - X0) * SEAM_PX).astype(int); iy = ((Y1 - c[:, 1]) * SEAM_PX).astype(int)
        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H); o = np.zeros(len(c), int); o[ok] = owner[iy[ok], ix[ok]]
        res[name] = keep & (o != 0) & (o != c_)                 # cara de este lado de la costura que pertenece al otro
    return res
removed_seam = {}
for view in ('frente', 'espalda'):
    cut = seam(view)
    for name, bad in cut.items():
        removed_seam[name] = removed_seam.get(name, 0) + int(bad.sum())
    for name, bad in cut.items():
        if bad.any(): meshes[name] = meshes[name].submesh([np.where(~bad)[0]], append=True)
# borde pelvis-dorsales-lumbar (espalda): las piezas casi no se solapan, asi que NO se borra nada (abriria huecos).
# Las caras que quedan al otro lado de la frontera suavizada pasan a la pieza que manda ahi.
EDGE_PIECES = ('pelvis', 'dorsal_der', 'dorsal_izq', 'lumbar')
def relabel_edge(names, filt=25, Y0=100.0, Y1=126.0, X0=-30.0, X1=30.0):
    W, H = int((X1 - X0) * SEAM_PX), int((Y1 - Y0) * SEAM_PX); info = {}; polys = []; depth = []; lab = []
    for i, name in enumerate(names, 1):
        m = meshes[name]; keep = m.face_normals[:, 2] < -0.15; info[name] = (m.triangles_center * K, keep)
        t = (m.triangles * K)[keep]
        polys.append(np.stack([(t[..., 0] - X0) * SEAM_PX, (Y1 - t[..., 1]) * SEAM_PX], -1))
        depth.append(-t[..., 2].mean(1)); lab.append(np.full(len(t), i))
    polys = np.concatenate(polys); depth = np.concatenate(depth); lab = np.concatenate(lab)
    img = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(img)
    for k in np.argsort(depth): dr.polygon([tuple(q) for q in polys[k]], fill=int(lab[k]))
    cls = np.array(img); score = np.stack([uniform_filter((cls == i).astype(float), size=filt) for i in range(1, len(names) + 1)])
    owner = np.where(score.max(0) > 0.05, score.argmax(0) + 1, 0)
    dest = {}
    for i, name in enumerate(names, 1):
        c, keep = info[name]; ix = ((c[:, 0] - X0) * SEAM_PX).astype(int); iy = ((Y1 - c[:, 1]) * SEAM_PX).astype(int)
        ok = keep & (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H); d = np.zeros(len(c), int); d[ok] = owner[iy[ok], ix[ok]]
        dest[name] = np.where(ok & (d > 0), d, i)           # a que pieza va cada cara (por defecto, la suya)
    out = {}
    for i, name in enumerate(names, 1):
        parts = []
        for j, other in enumerate(names, 1):
            sel = np.where(dest[other] == i)[0]
            if len(sel): parts.append(meshes[other].submesh([sel], append=True))
        out[name] = trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0]
    moved = {n: int((dest[n] != i).sum()) for i, n in enumerate(names, 1)}
    meshes.update(out); return moved
moved_edge = relabel_edge(EDGE_PIECES)
# islas: caras sueltas de otras piezas que quedan dentro del area de la lumbar (se ven con otro tono) pasan a la lumbar
from scipy.ndimage import binary_erosion
def absorb_islands(donors=('dorsal_izq', 'dorsal_der', 'pelvis', 'trapecio_medio'), px=20, erode=6):
    ox, oy = -40.0, 60.0; lum = meshes['lumbar']
    img = Image.new('L', (80 * px, 100 * px), 0); dr = ImageDraw.Draw(img)
    for t, nz in zip(lum.triangles * K, lum.face_normals[:, 2]):
        if nz < 0: dr.polygon([((x - ox) * px, (y - oy) * px) for x, y, _ in t], fill=255)
    inner = binary_erosion(np.array(img) > 0, iterations=erode)          # interior de la lumbar, a >3 mm del borde
    taken = {}; parts = [lum]
    for name in donors:
        m = meshes[name]; c = m.triangles_center * K
        ix = ((c[:, 0] - ox) * px).astype(int); iy = ((c[:, 1] - oy) * px).astype(int)
        ok = (ix >= 0) & (ix < inner.shape[1]) & (iy >= 0) & (iy < inner.shape[0]); inside = np.zeros(len(c), bool); inside[ok] = inner[iy[ok], ix[ok]]
        sel = inside & (m.face_normals[:, 2] < 0) & (c[:, 2] < 0)          # solo caras de la espalda (z < 0)
        taken[name] = int(sel.sum())
        if sel.any():
            parts.append(m.submesh([np.where(sel)[0]], append=True)); meshes[name] = m.submesh([np.where(~sel)[0]], append=True)
    meshes['lumbar'] = trimesh.util.concatenate(parts); return taken
islands = absorb_islands()

# partes internas: caras que ninguna direccion exterior puede ver (paredes entre piezas, interior del torso) se quitan.
# Una cara se conserva si algun rayo que sale de ella (su normal + 24 direcciones del hemisferio exterior) escapa del cuerpo.
def strip_hidden(n_dirs=24, eps=0.0003):
    from trimesh.ray.ray_pyembree import RayMeshIntersector
    names = sorted(meshes); parts = [meshes[n] for n in names]
    whole = trimesh.util.concatenate(parts); owner = np.concatenate([np.full(len(m.faces), i) for i, m in enumerate(parts)])
    rng = np.random.default_rng(7); d = rng.normal(size=(n_dirs, 3)); d /= np.linalg.norm(d, axis=1, keepdims=True)
    nrm = whole.face_normals; cen = whole.triangles_center
    inter = RayMeshIntersector(whole, scale_to_box=False)
    visible = np.zeros(len(cen), bool)
    for dirs in [nrm] + [np.where(((nrm @ d[i]) < 0)[:, None], -d[i], d[i]) for i in range(n_dirs)]:
        todo = np.where(~visible)[0]
        if len(todo) == 0: break
        hit = inter.intersects_any(cen[todo] + nrm[todo] * eps, dirs[todo])
        visible[todo[~hit]] = True
    # grietas: una cara tapada para los rayos de arriba puede verse por una rendija; se conserva toda cara que una camara
    # ortografica ve primero. 96 direcciones x 480x480 rayos.
    lo, hi = whole.bounds; c = (lo + hi) / 2; half = float(np.abs(hi - lo).max()) / 2 * 1.02
    gx = (np.arange(480) + 0.5) / 480 * 2 * half - half; U, V = np.meshgrid(gx, gx); U = U.ravel(); V = V.ravel()
    k = np.arange(96) + 0.5; phi = np.arccos(1 - 2 * k / 96); th = np.pi * (1 + 5 ** 0.5) * k
    for p_, t_ in zip(phi, th):
        w = np.array([np.sin(p_) * np.cos(t_), np.cos(p_), np.sin(p_) * np.sin(t_)])
        a = np.cross(w, [0.0, 1.0, 0.0]); a = a / np.linalg.norm(a) if np.linalg.norm(a) > 1e-6 else np.array([1.0, 0.0, 0.0]); b = np.cross(w, a)
        o = c + U[:, None] * a + V[:, None] * b + w * (half * 2)
        tri = inter.intersects_first(o, -np.tile(w, (len(o), 1))); visible[tri[tri >= 0]] = True
    dropped = {}
    for i, n in enumerate(names):
        keep = visible[owner == i]; dropped[n] = int((~keep).sum())
        if (~keep).any(): meshes[n] = parts[i].submesh([np.where(keep)[0]], append=True)
    return dropped
hidden = strip_hidden()
PAL = ['#e6194b','#3cb44b','#0082c8','#f58231','#911eb4','#46f0f0','#f032e6','#d2f53c','#000080','#aa6e28','#800000','#008080',
       '#6e6e6e','#ffe119','#fabebe','#6464ff','#96e696','#c878c8','#3c3c3c','#bebebe']
scene = trimesh.Scene(); man = {}
for k, (name, m) in enumerate(sorted(meshes.items())):
    rgb = [int(PAL[k % 20][i:i+2], 16) for i in (1, 3, 5)]
    m = m.copy(); m.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(name='solid_' + name,
        baseColorFactor=[*rgb, 255], metallicFactor=0.0, roughnessFactor=0.85))
    scene.add_geometry(m, node_name=name, geom_name=name); man[name] = {'color': PAL[k % 20], 'faces': int(len(m.faces))}
scene.export(HERE + '/maniqui-por-partes.glb')
json.dump({'fuentes': {'torso': 'fuentes/torso.glb', 'extremidades': 'fuentes/extremidades.glb'},
           'escala': {'torso': ST, 'extremidades': SL}, 'torso_base_y_cm': TORSO_Y, 'subida_piernas_cm': LEG_LIFT, 'torso_z_cm': TORSO_Z,
           'caras_pasadas_a_lumbar': removed, 'caras_quitadas_en_costura_pelvis_piernas': removed_seam, 'caras_movidas_borde_pelvis_dorsales': moved_edge, 'islas_absorbidas_por_lumbar': islands, 'caras_internas_quitadas': hidden, 'parts': man}, open(HERE + '/manifest.json', 'w'), indent=2, ensure_ascii=False)
print(len(man), 'piezas; pasadas a lumbar:', removed)
