#!/usr/bin/env python
"""Vistas de referencia ortográficas (frente, espalda, lado izq, lado der) + paleta de regiones.
Base: mannequin_9_parts.glb completo (sin piezas superpuestas). Cámara fija, guardada en camara.json,
para poder proyectar después las imágenes pintadas sobre el modelo 3D.
Uso: /tmp/mask-venv/bin/python -I assets/models/maniqui-por-partes/gen_referencias.py"""
import json, os, sys, numpy as np, trimesh
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = HERE + '/referencias'
MAN = '/home/santiago2/Projects/pose-studio/public/models/props/mannequin_9_parts.glb'
N, SS = 1024, 2                     # tamaño final y supermuestreo
PALETA = {'cabeza':'#A0522D','cuello':'#00FF80','trapecio':'#FF0000','dorsal':'#00FF00','lumbar':'#0000FF',
 'hombro':'#FFFF00','pecho':'#FF8000','serrato':'#00FFFF','oblicuo':'#FF00FF','abdomen':'#8000FF',
 'bicep':'#80FF00','tricep':'#FF0080','antebrazo':'#0080FF','gluteo':'#800000','cuadriceps':'#008000',
 'femoral':'#000080','aductor':'#808000','abductor':'#800080','pantorrilla':'#008080','pie':'#FF8080'}
# vistas: u = eje que va a la derecha de la imagen, d = hacia el observador (en coordenadas del modelo)
VISTAS = {'frente':((1,0,0),(0,0,1)), 'espalda':((-1,0,0),(0,0,-1)), 'lado_izq':((0,0,-1),(1,0,0)), 'lado_der':((0,0,1),(-1,0,0))}
def lab(h):
    c = np.array([int(h[i:i+2], 16) for i in (1, 3, 5)]) / 255.; c = np.where(c > .04045, ((c + .055) / 1.055) ** 2.4, c / 12.92)
    xyz = c @ np.array([[.4124,.2126,.0193],[.3576,.7152,.1192],[.1805,.0722,.9505]]) / np.array([.95047, 1, 1.08883])
    f = np.where(xyz > .008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116); return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])
def main():
    s = trimesh.load(MAN); meshes = []
    for n in s.graph.nodes_geometry:
        T, g = s.graph[n]; m = s.geometry[g].copy(); m.apply_transform(T); meshes.append(m)
    V = np.concatenate([m.vertices for m in meshes]); F = np.concatenate([m.faces + sum(len(q.vertices) for q in meshes[:i]) for i, m in enumerate(meshes)])
    tri = V[F] * 1500.0                                    # cm
    ymin = tri[..., 1].min(); xc = 0.0; zc = (tri[..., 2].min() + tri[..., 2].max()) / 2
    scale = (N * SS) * 0.92 / 180.0                         # px por cm
    cam = {'px_por_cm': scale / SS, 'imagen_px': N, 'y_pie_cm': float(ymin), 'centro_x_cm': xc, 'centro_z_cm': float(zc),
           'unidades_modelo_por_cm': 1 / 1500.0, 'margen_inferior_px': N * 0.04,
           'vistas': {k: {'u': u, 'd': d} for k, (u, d) in VISTAS.items()}}
    n_f = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); n_f /= np.linalg.norm(n_f, axis=1, keepdims=True) + 1e-12
    for nombre, (u, d) in VISTAS.items():
        u, d = np.array(u, float), np.array(d, float); up = np.array([0, 1., 0])
        cen = np.array([xc, 0, zc])
        px = ((tri - cen) @ u) * scale + N * SS / 2
        py = (N * SS) * (1 - 0.04) - (tri[..., 1] - ymin) * scale
        dep = (tri.mean(1) - cen) @ d
        L = d + 0.45 * up - 0.35 * u; L /= np.linalg.norm(L)
        sh = np.clip(np.abs(n_f @ L), 0, 1) * 0.65 + 0.28      # |n·L|: las normales de Meshy pueden venir invertidas
        g = (sh * 255).clip(0, 255).astype(int)
        img = Image.new('RGB', (N * SS, N * SS), (255, 255, 255)); dr = ImageDraw.Draw(img)
        for k in np.argsort(dep):                               # lejos -> cerca
            dr.polygon([(px[k, 0, 0], py[k, 0]), (px[k, 1, 0], py[k, 1]), (px[k, 2, 0], py[k, 2])] if False else
                       [tuple(p) for p in np.stack([px[k], py[k]], -1)], fill=(g[k], g[k], g[k]))
        img.resize((N, N), Image.LANCZOS).save(f'{OUT}/ref_{nombre}.png'); print(nombre, flush=True)
    # paleta
    names = list(PALETA); L_ = [lab(PALETA[k]) for k in names]
    md = min((np.linalg.norm(L_[i] - L_[j]), names[i], names[j]) for i in range(len(names)) for j in range(i))
    print('distancia mínima entre colores (Lab): %.1f  %s/%s' % md)
    pal = Image.new('RGB', (900, 40 * 10 + 20), 'white'); d2 = ImageDraw.Draw(pal)
    for i, k in enumerate(names):
        x, y = 20 + (i // 10) * 440, 20 + (i % 10) * 40
        d2.rectangle([x, y, x + 60, y + 30], fill=PALETA[k], outline='black'); d2.text((x + 75, y + 9), f'{k}  {PALETA[k]}', fill='black')
    pal.save(f'{OUT}/paleta.png')
    json.dump({'paleta': PALETA, 'camara': cam}, open(f'{OUT}/camara_y_paleta.json', 'w'), indent=2)
main()
