// The skull behind the memory tree: Jake K-H's human skull (CC BY 4.0),
// drawn as a dotted wireframe. The tree itself is 3d-force-graph; this file
// only owns the decorative housing that shares its scene and camera.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type SkullPalette = {
  ink: THREE.Color;
  paper: THREE.Color;
  accent: THREE.Color;
  accent2: THREE.Color;
  accent3: THREE.Color;
  brand: THREE.Color;
  soft: THREE.Color;
};

export function skullPalette(dark: boolean): SkullPalette {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): THREE.Color => new THREE.Color(css.getPropertyValue(name).trim() || fallback);
  return {
    ink: read("--ink", dark ? "#f0ebe2" : "#1b1712"),
    paper: read("--paper", dark ? "#121212" : "#fdfdfd"),
    accent: read("--accent", dark ? "#94aaff" : "#3157c8"),
    accent2: read("--accent-2", dark ? "#e0a06b" : "#9c5a20"),
    accent3: read("--accent-3", dark ? "#63d4c7" : "#177c76"),
    brand: read("--brand-accent", dark ? "#d4a05e" : "#996b24"),
    soft: read("--soft", dark ? "#81776a" : "#8b8070"),
  };
}

function dot_texture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.9)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function load_skull(root: THREE.Group, c: SkullPalette, dark: boolean, alive: () => boolean, dotMaterials: THREE.PointsMaterial[]): void {
  new GLTFLoader().load("/skull.glb", (gltf) => {
    if (!alive()) return;
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1.78 / Math.max(size.x, size.y, size.z);
    const dot = dot_texture();
    const wireMat = new THREE.LineBasicMaterial({
      color: c.ink,
      transparent: true,
      opacity: dark ? 0.024 : 0.04,
      depthWrite: false,
    });
    model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const edges = new THREE.WireframeGeometry(obj.geometry);
      const position = obj.geometry.getAttribute("position");
      const points: number[] = [];
      for (let i = 0; i < position.count; i++) {
        points.push(position.getX(i), position.getY(i), position.getZ(i));
      }
      const dotGeometry = new THREE.BufferGeometry();
      dotGeometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      const dotMaterial = new THREE.PointsMaterial({
        color: c.ink,
        size: dark ? 0.016 : 0.013,
        map: dot,
        transparent: true,
        opacity: 0.82,
        alphaTest: 0.02,
        depthWrite: false,
        sizeAttenuation: true,
        blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      dotMaterial.userData.baseSize = dotMaterial.size;
      dotMaterials.push(dotMaterial);
      const dotCloud = new THREE.Points(dotGeometry, dotMaterial);
      dotCloud.frustumCulled = false;
      dotCloud.renderOrder = -2;
      const wire = new THREE.LineSegments(edges, wireMat);
      wire.frustumCulled = false;
      wire.renderOrder = -1;
      obj.renderOrder = -1;
      obj.material = new THREE.MeshBasicMaterial({
        color: c.ink,
        transparent: true,
        opacity: 0.012,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      obj.add(dotCloud, wire);
    });
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    const centered = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.position.sub(centered);
    root.add(model);
  }, undefined, () => {});
}

// The decorative skull housing. It is mounted into the backdrop renderer
// only; the interactive tree lives in its own library-owned SVG layer.
export function mountSkullHousing(scene: THREE.Scene, dark: boolean): { root: THREE.Group; scale: (value: number) => void; dispose: () => void } {
  const c = skullPalette(dark);
  let alive = true;
  const root = new THREE.Group();
  root.name = "memory-skull";
  root.rotation.x = -Math.PI / 2;
  scene.add(root);
  const dotMaterials: THREE.PointsMaterial[] = [];
  let dotScale = 1;
  const applyDots = (): void => {
    for (const material of dotMaterials) {
      const base = typeof material.userData.baseSize === "number" ? material.userData.baseSize : material.size;
      material.size = base * dotScale;
    }
  };
  load_skull(root, c, dark, () => alive, dotMaterials);
  applyDots();
  return {
    root,
    scale: (value: number) => {
      dotScale = value;
      applyDots();
    },
    dispose: () => {
      alive = false;
      scene.remove(root);
      root.traverse((obj) => {
        const any = obj as any;
        if (any.geometry !== undefined) any.geometry.dispose();
        if (Array.isArray(any.material)) any.material.forEach((mat: any) => mat.dispose());
        else if (any.material !== undefined) any.material.dispose();
      });
    },
  };
}

