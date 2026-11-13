import { useEffect, useRef } from "react";

import { bodyOpacity, type BodySlug, type BodyView } from "../lib/bodyMap";
import { BODY_MODEL_URL, pieceSlugs } from "../lib/bodyModel";

type Props = {
  /** Valor relativo 0..1 por grupo. Un grupo ausente cuenta como 0 (sin datos). */
  ratios: Partial<Record<BodySlug, number>>;
  /** Vista a mostrar; al cambiarla el cuerpo gira. El usuario tambien puede girarlo arrastrando. */
  view: BodyView;
  /** Grupo resaltado: los demas se atenuan. */
  focus?: BodySlug | null;
  /** WebGL o el modelo no estan disponibles: quien llama muestra solo la lista. */
  onUnavailable?: () => void;
};

type Scene3D = { update: () => void; setView: (view: BodyView) => void; dispose: () => void };

const FOCUS_DIM = 0.5;

/**
 * Cuerpo 3D: un color de acento, la opacidad indica el valor del grupo (misma regla que el mapa en 2D).
 * Dibuja solo cuando algo cambia (datos, giro, tamano) para no gastar bateria.
 */
export default function BodyModel3D({ ratios, view, focus = null, onUnavailable }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene3D | null>(null);
  const latest = useRef({ ratios, focus, view, onUnavailable });

  useEffect(() => {
    latest.current = { ratios, focus, view, onUnavailable };
    scene.current?.update();
  }, [ratios, focus, view, onUnavailable]);

  useEffect(() => {
    scene.current?.setView(view);
  }, [view]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let teardown: (() => void) | null = null;

    (async () => {
      try {
        const THREE = await import("three");
        const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.domElement.className = "bodyModelCanvas";
        el.appendChild(renderer.domElement);

        const sceneGraph = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(22, 3 / 4, 0.01, 20);
        sceneGraph.add(camera);
        camera.add(new THREE.AmbientLight(0xffffff, 1.25));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(-1.5, 2, 3); // la luz va con la camara: el cuerpo se ve igual de frente que de espalda
        camera.add(key);

        const gltf = await new GLTFLoader().loadAsync(BODY_MODEL_URL);
        if (disposed) {
          renderer.dispose();
          renderer.domElement.remove();
          return;
        }

        // Centra el modelo y lo normaliza a 1 de alto.
        const pivot = new THREE.Group();
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const k = 1 / size.y;
        model.scale.setScalar(k);
        model.position.set(-centre.x * k, -centre.y * k, -centre.z * k);
        pivot.add(model);
        sceneGraph.add(pivot);
        const bodyWidth = size.x * k;

        const meshes: Array<{ material: InstanceType<typeof THREE.MeshStandardMaterial>; slugs: readonly BodySlug[] }> = [];
        model.traverse((obj) => {
          const mesh = obj as InstanceType<typeof THREE.Mesh>;
          if (!mesh.isMesh) return;
          const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
          mesh.material = material;
          meshes.push({ material, slugs: pieceSlugs(mesh.name || mesh.parent?.name || "") });
        });

        let raf = 0;
        let yaw = latest.current.view === "back" ? Math.PI : 0;
        let target = yaw;
        const render = () => {
          pivot.rotation.y = yaw;
          renderer.render(sceneGraph, camera);
        };
        const colours = () => {
          const css = getComputedStyle(document.documentElement);
          return {
            accent: new THREE.Color(css.getPropertyValue("--accent").trim() || "#28bda0"),
            base: new THREE.Color(css.getPropertyValue("--border").trim() || "#c9d5df"),
          };
        };
        const paint = () => {
          const { accent, base } = colours();
          const { ratios: r, focus: f } = latest.current;
          for (const { material, slugs } of meshes) {
            if (slugs.length === 0) {
              material.color.copy(base);
              continue;
            }
            const top = slugs.reduce((best, s) => ((r[s] ?? 0) > (r[best] ?? 0) ? s : best), slugs[0]);
            const dim = f && !slugs.includes(f) ? FOCUS_DIM : 1;
            material.color.copy(base).lerp(accent, bodyOpacity(r[top] ?? 0) * dim);
          }
          render();
        };

        const fit = () => {
          const w = el.clientWidth || 1;
          const h = el.clientHeight || 1;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          const tan = Math.tan((camera.fov * Math.PI) / 360);
          const distance = Math.max(0.56 / tan, (bodyWidth * 0.56) / (tan * camera.aspect));
          camera.position.set(0, 0, distance);
          camera.updateProjectionMatrix();
          render();
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(el);

        const animate = () => {
          const diff = target - yaw;
          if (Math.abs(diff) < 0.002) {
            yaw = target;
            raf = 0;
          } else {
            yaw += diff * 0.18;
            raf = requestAnimationFrame(animate);
          }
          render();
        };
        const turnTo = (angle: number) => {
          // el giro mas corto hacia la vista pedida
          const turns = Math.round((yaw - angle) / (2 * Math.PI));
          target = angle + turns * 2 * Math.PI;
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            yaw = target;
            render();
          } else if (!raf) raf = requestAnimationFrame(animate);
        };

        let dragX: number | null = null;
        const down = (e: PointerEvent) => {
          dragX = e.clientX;
          el.setPointerCapture(e.pointerId);
        };
        const move = (e: PointerEvent) => {
          if (dragX === null) return;
          yaw += (e.clientX - dragX) * 0.012;
          target = yaw;
          dragX = e.clientX;
          render();
        };
        const up = () => {
          dragX = null;
        };
        el.addEventListener("pointerdown", down);
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);

        scene.current = {
          update: paint,
          setView: (v) => turnTo(v === "back" ? Math.PI : 0),
          dispose: () => undefined,
        };
        paint();

        teardown = () => {
          cancelAnimationFrame(raf);
          observer.disconnect();
          el.removeEventListener("pointerdown", down);
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          model.traverse((obj) => {
            const mesh = obj as InstanceType<typeof THREE.Mesh>;
            if (mesh.isMesh) mesh.geometry.dispose();
          });
          for (const { material } of meshes) material.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch {
        if (!disposed) latest.current.onUnavailable?.();
      }
    })();

    return () => {
      disposed = true;
      scene.current = null;
      teardown?.();
    };
  }, []);

  return <div ref={host} className="bodyModel3D" role="img" aria-label="Cuerpo en 3D con los grupos musculares marcados" />;
}
