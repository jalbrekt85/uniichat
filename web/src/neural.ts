// The memory tree, rendered by 3d-force-graph. The skull and the tree live
// in the SAME scene and camera, so orbiting and auto-rotation are the
// library's own controls and the skull cannot be cut off from the tree.
// The camera is fixed and never zooms: the skull keeps its size, and a
// click expands the next granular layer in place instead of flying into it.
import ForceGraph3D, { type ForceGraph3DInstance, type LinkObject, type NodeObject } from "3d-force-graph";
import * as THREE from "three";
import { mountSkullHousing, skullPalette } from "./skull";

export type SkullNode = {
  id: string;
  label: string;
  text: string;
  kind: string;
  children: SkullNode[];
  loaded?: boolean;
  key?: string;
};
export type SkullTree = SkullNode;

export const SKULL_SEED: SkullTree = {
  id: "root",
  label: "memory tree",
  kind: "root",
  text: "The memory tree begins here. Send a message and the first neurons grow.",
  loaded: true,
  children: [],
};

type GraphNode = NodeObject & {
  id: string;
  label: string;
  text: string;
  kind: string;
  loaded: boolean;
  depth: number;
};
type GraphLink = LinkObject<GraphNode> & { source: string; target: string };

export type NeuralHandle = {
  update: (tree: SkullTree) => void;
  reset: () => void;
  dispose: () => void;
};

function colors(kind: string, depth: number, ice: string, grey: string, black: string): string {
  switch (kind) {
    case "summary": return ice;
    case "unii": return ice;
    case "root": return black;
    case "user": return grey;
    default: return grey;
  }
}

function label_of(node: SkullNode): string {
  const body = node.text.replace(/\s+/g, " ").trim();
  return body === "" ? node.label : node.label + " · " + (body.length > 84 ? body.slice(0, 84) + "…" : body);
}

function dendrites(): THREE.BufferGeometry {
  const points: number[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + ((i * 37) % 17) * 0.012;
    const tilt = -0.55 + ((i * 53) % 100) / 100 * 1.1;
    const flat = Math.cos(tilt);
    const x = Math.cos(angle) * flat;
    const y = Math.sin(tilt) * 0.8;
    const z = Math.sin(angle) * flat;
    const len = 0.82 + ((i * 29) % 100) / 100 * 0.32;
    const mid = 0.52 * len;
    points.push(0, 0, 0, x * mid, y * mid, z * mid);
    points.push(x * mid, y * mid, z * mid, x * len, y * len, z * len);
    const fork = angle + (i % 2 === 0 ? 0.5 : -0.5);
    points.push(x * mid, y * mid, z * mid, Math.cos(fork) * flat * 0.78, (Math.sin(tilt) * 0.8 + 0.1) * 0.78, Math.sin(fork) * flat * 0.78);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

function glow_texture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.3)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function mountNeural(host: HTMLElement, dark: boolean, onSelect: (node: SkullNode) => void): NeuralHandle {
  const palette = skullPalette(dark);
  const darkTheme = palette.ink.r + palette.ink.g + palette.ink.b > 1.5;
  const ice = darkTheme ? "#a8cfe2" : "#6f9ab2";
  const grey = darkTheme ? "#8e8e8e" : "#8a8a8a";
  const black = darkTheme ? "#e8e8e8" : "#111111";

  const fg: ForceGraph3DInstance<GraphNode, GraphLink> = new ForceGraph3D(host, {
    controlType: "orbit",
    rendererConfig: { antialias: true, alpha: true },
  });
  fg.backgroundColor("rgba(0,0,0,0)").showNavInfo(false).enableNodeDrag(false).enableNavigationControls(true);
  const renderer = fg.renderer();
  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
  renderer.domElement.style.background = "transparent";
  fg.camera().fov = 34;
  fg.camera().updateProjectionMatrix();

  const housing = mountSkullHousing(fg.scene(), dark);
  const somaGeometry = new THREE.OctahedronGeometry(1, 0);
  const dendriteGeometry = dendrites();
  const pickGeometry = new THREE.SphereGeometry(1, 8, 6);
  const glow = glow_texture();
  const pickMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  type Materials = { soma: THREE.MeshBasicMaterial; dend: THREE.LineBasicMaterial; glow: THREE.SpriteMaterial };
  const materials = new Map<string, Materials>();
  // the node objects, by id: hover scales the one under the pointer
  const nodeGroups = new Map<string, THREE.Group>();
  let hovered: string | null = null;
  const neuron_materials = (color: string): Materials => {
    let cached = materials.get(color);
    if (cached === undefined) {
      cached = {
        soma: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.96, depthWrite: false, depthTest: false }),
        dend: new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.64, depthWrite: false, depthTest: false }),
        glow: new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: darkTheme ? 0.18 : 0.1, depthWrite: false, depthTest: false, blending: darkTheme ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false }),
      };
      materials.set(color, cached);
    }
    return cached;
  };

  fg.nodeLabel((node) => label_of(node)).nodeThreeObject((node) => {
    const color = colors(node.kind, node.depth, ice, grey, black);
    const mats = neuron_materials(color);
    const size = node.kind === "root" ? 1.4 : node.kind === "summary" ? 1 : 0.8;
    const group = new THREE.Group();
    const soma = new THREE.Mesh(somaGeometry, mats.soma);
    soma.scale.setScalar(0.012 * size);
    soma.renderOrder = 10;
    const dend = new THREE.LineSegments(dendriteGeometry, mats.dend);
    dend.scale.setScalar(0.038 * size);
    dend.rotation.set(((Math.abs(node.id.length * 37) % 100) / 100 - 0.5) * 0.4, (node.id.length * 53 % 360) * Math.PI / 180, 0);
    dend.renderOrder = 10;
    const halo = new THREE.Sprite(mats.glow);
    halo.scale.setScalar(0.05 * size);
    halo.renderOrder = 9;
    const pick = new THREE.Mesh(pickGeometry, pickMaterial);
    pick.scale.setScalar(0.12);
    pick.renderOrder = -1;
    group.add(halo, dend, soma, pick);
    group.userData.nodeId = node.id;
    nodeGroups.set(node.id, group);
    return group;
  }).linkColor(() => grey).linkOpacity(0.55).linkWidth(0).linkCurvature(0.12).linkResolution(4)
    .dagMode("radialout").warmupTicks(50).cooldownTicks(90).d3AlphaDecay(0.04)
    .onNodeClick((node) => onSelect(node))
    .onNodeHover((node) => {
      host.style.cursor = node === null ? "grab" : "pointer";
      const id = node === null ? null : node.id;
      if (id === hovered) {
        return;
      }
      if (hovered !== null) {
        nodeGroups.get(hovered)?.scale.setScalar(1);
      }
      hovered = id;
      if (id !== null) {
        nodeGroups.get(id)?.scale.setScalar(1.8);
      }
    })
    .onEngineTick(() => {
      // Keep every neuron inside the skull. The camera never zooms, so this
      // radius is stable; no skull rescaling or follow camera is involved.
      for (const node of fg.graphData().nodes) {
        if (node.x === undefined || node.y === undefined || node.z === undefined) continue;
        const d = Math.sqrt(node.x * node.x + node.y * node.y + node.z * node.z);
        if (d > 0.62 && d > 0.0001) {
          const k = 0.62 / d;
          node.x *= k; node.y *= k; node.z *= k;
        }
      }
    });

  const controls = fg.controls() as any;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.62;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.55;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const stop = (): void => {
    controls.autoRotate = false;
    if (idle !== null) { clearTimeout(idle); idle = null; }
  };
  const rest = (): void => {
    if (idle !== null) clearTimeout(idle);
    idle = setTimeout(() => { idle = null; controls.autoRotate = true; }, 10000);
  };
  controls.addEventListener("start", stop);
  controls.addEventListener("end", rest);

  // 3d-force-graph's own click does not fire here (its pointerdown is
  // consumed before its pointerup); a direct raycast onto the node groups
  // makes the small neurons clickable, and the same hit test is forgiving
  const ray = new THREE.Raycaster();
  let downAt: { x: number; y: number } | null = null;
  host.addEventListener("pointerdown", (ev) => {
    downAt = { x: ev.clientX, y: ev.clientY };
  });
  host.addEventListener("pointerup", (ev) => {
    const from = downAt;
    downAt = null;
    if (from === null || ev.button !== 0 || Math.abs(ev.clientX - from.x) + Math.abs(ev.clientY - from.y) > 6) {
      return;
    }
    const rect = fg.renderer().domElement.getBoundingClientRect();
    const at = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(at, fg.camera());
    for (const hit of ray.intersectObjects([...nodeGroups.values()], true)) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj !== null && obj.userData.nodeId === undefined) {
        obj = obj.parent;
      }
      if (obj === null) {
        continue;
      }
      const id = obj.userData.nodeId as string;
      const node = fg.graphData().nodes.find((item) => item.id === id);
      if (node !== undefined) {
        onSelect(node as unknown as Parameters<typeof onSelect>[0]);
      }
      return;
    }
  });

  const fit = (): void => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === 0 || h === 0) return;
    fg.width(w).height(h);
    fg.camera().aspect = w / h;
    fg.camera().updateProjectionMatrix();

    // The canvas is a wide transparent sheet whose centre lies in the
    // right-hand column (the CSS positions it). The skull is centred in
    // that canvas, so its left edge has hundreds of pixels of room and no
    // pane boundary can cut it. Nothing is transformed in graph space.
    const pane = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--skull")) || 400;
    const skullPx = Math.max(220, pane * 0.75);
    const viewWidth = 1.78 / (skullPx / w);
    const halfV = Math.tan((fg.camera().fov * Math.PI / 180) / 2);
    const halfH = Math.atan(halfV * (w / h));
    const distance = viewWidth / (2 * Math.tan(halfH));
    controls.target.set(0, 0, 0);
    fg.camera().position.set(0, 0.06, distance);
    fg.camera().lookAt(0, 0, 0);
    fg.camera().updateProjectionMatrix();
    // Zoom in far enough to be useful, but never far enough for the skull
    // to reach the edge of the wide transparent canvas.
    controls.minDistance = distance * 0.45;
    controls.maxDistance = distance * 1.8;
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(host);

  let tree: SkullTree = SKULL_SEED;
  const nodes = new Map<string, GraphNode>();
  const flatten = (root: SkullTree): { nodes: GraphNode[]; links: GraphLink[] } => {
    const out: GraphNode[] = [];
    const links: GraphLink[] = [];
    const seen = new Set<string>();
    const walk = (node: SkullNode, depth: number, parent: string | null): void => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      let item = nodes.get(node.id);
      if (item === undefined) {
        item = { id: node.id, label: node.label, text: node.text, kind: node.kind, loaded: node.loaded !== false, depth };
        nodes.set(node.id, item);
      } else {
        item.label = node.label; item.text = node.text; item.kind = node.kind; item.loaded = node.loaded !== false; item.depth = depth;
      }
      out.push(item);
      if (parent !== null) links.push({ source: parent, target: node.id });
      for (const child of node.children) walk(child, depth + 1, node.id);
    };
    walk(root, 0, null);
    return { nodes: out, links };
  };

  const update = (next: SkullTree): void => {
    tree = next;
    if (hovered !== null) {
      nodeGroups.get(hovered)?.scale.setScalar(1);
      hovered = null;
    }
    const data = flatten(next);
    const maxDepth = data.nodes.reduce((deep, node) => Math.max(deep, node.depth), 1);
    fg.dagLevelDistance(Math.max(0.04, 0.45 / maxDepth));
    fg.graphData({ nodes: data.nodes, links: data.links });
    fg.d3Force("charge", null);
    const link = fg.d3Force("link") as any;
    link?.distance(Math.max(0.04, 0.45 / maxDepth));
    fg.d3ReheatSimulation();
  };

  return {
    update,
    reset: () => {
      stop();
      fit();
      fg.d3ReheatSimulation();
      controls.autoRotate = true;
    },
    dispose: () => {
      observer.disconnect();
      if (idle !== null) clearTimeout(idle);
      controls.removeEventListener("start", stop);
      controls.removeEventListener("end", rest);
      housing.dispose();
      fg.pauseAnimation();
      fg._destructor();
      somaGeometry.dispose(); dendriteGeometry.dispose(); pickGeometry.dispose(); glow.dispose(); pickMaterial.dispose();
      materials.forEach((m) => { m.soma.dispose(); m.dend.dispose(); m.glow.dispose(); });
      host.replaceChildren();
    },
  };
}
