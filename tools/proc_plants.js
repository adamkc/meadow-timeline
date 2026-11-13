// Meadow plants built from scratch for the bake (tools/bake_cards.html?proc=...):
// corn lily, a sedge tussock, a rush clump and a willow. Real geometry, in metres, with
// vertex colours; the bake renders them to pictures with their own shading,
// exactly as it does the scanned plants.
import * as THREE from 'three';

function random(seed) {
  let s = seed | 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 8) / 16777216; };
}

class Builder {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  vertex(p, uv, c) { this.pos.push(p[0], p[1], p[2]); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]); return this.pos.length / 3 - 1; }
  quad(a, b, c, d) { this.idx.push(a, b, c, c, b, d); }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A thin tube or ribbon along a path of points. sides = 2 gives a ribbon folded
// along its middle (a blade); 3 or more a closed stem.
function strand(b, path, radius, colour, sides, fold = 0.35) {
  let prev = null;
  path.forEach((p, i) => {
    const t = i / (path.length - 1);
    const along = norm(add(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)], -1));
    const side = norm(cross(along, Math.abs(along[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
    const up = cross(side, along);
    const r = radius(t), c = colour(t), ring = [];
    if (sides === 2) {
      ring.push(b.vertex(add(add(p, side, -r), up, r * fold), [0, t], c), b.vertex(p, [0.5, t], c), b.vertex(add(add(p, side, r), up, r * fold), [1, t], c));
    } else {
      for (let k = 0; k <= sides; k++) {
        const a = k / sides * Math.PI * 2;
        ring.push(b.vertex(add(add(p, side, Math.cos(a) * r), up, Math.sin(a) * r), [k / sides, t], c));
      }
    }
    if (prev) for (let k = 0; k < ring.length - 1; k++) b.quad(prev[k], prev[k + 1], ring[k], ring[k + 1]);
    prev = ring;
  });
}

// A curve that leaves `from` at `tilt` radians from vertical toward `heading`
// and bends over by `bend` radians along its length.
function arc(from, heading, tilt, bend, length, steps, power = 1.4) {
  const out = [from];
  let p = from;
  for (let i = 1; i <= steps; i++) {
    const a = tilt + bend * Math.pow((i - 0.5) / steps, power);
    p = add(p, [Math.sin(a) * Math.cos(heading), Math.cos(a), Math.sin(a) * Math.sin(heading)], length / steps);
    out.push(p);
  }
  return out;
}

// ---- corn lily (Veratrum californicum) -------------------------------------------
// One stout, unbranched stem clothed in broad, pleated, clasping leaves, largest
// low down. A flowering stem carries a branched plume of small white flowers.
function cornLily(rnd, flowering) {
  const b = new Builder(), flowers = new Builder();
  const H = 0.95 + 0.5 * rnd();                       // height of the leafy stem
  const lean = [(rnd() - 0.5) * 0.12, 0, (rnd() - 0.5) * 0.12];
  const stemAt = (y) => [lean[0] * y * y, y, lean[2] * y * y];
  const top = H + (flowering ? 0.42 + 0.2 * rnd() : 0.02);
  const stemPath = Array.from({ length: 10 }, (_, i) => stemAt(top * i / 9));
  const stemGreen = [0.50, 0.62, 0.30];
  strand(b, stemPath, (t) => 0.021 - 0.014 * t, () => stemGreen, 6);

  const leaves = 15 + Math.floor(rnd() * 6);
  const fresh = [0.36, 0.56, 0.17], pale = [0.52, 0.64, 0.22], tired = [0.62, 0.56, 0.20];
  for (let i = 0; i < leaves; i++) {
    const t = i / (leaves - 1);
    const y = H * (0.03 + 0.93 * Math.pow(t, 0.95));
    const heading = i * 2.3998 + (rnd() - 0.5) * 0.5;
    // Big leaves, largest a little way up, overlapping all the way to the top.
    const L = (0.30 + 0.14 * Math.sin(Math.min(1, t * 2.2 + 0.2) * Math.PI) - 0.16 * t) * (0.85 + 0.3 * rnd()) * H / 1.2;
    const W = L * (0.62 - 0.2 * t);
    const tilt = (46 - 24 * t + (rnd() - 0.5) * 12) * Math.PI / 180;      // from vertical: lower leaves spread, upper ones stand
    const spine = arc(stemAt(y), heading, tilt, (0.55 + 0.45 * rnd()) * (1 - 0.3 * t), L, 9, 1.8);
    const tone = mixc(mixc(fresh, pale, rnd() * 0.6), tired, (1 - t) * 0.35 * rnd());
    const NV = 14;
    let prev = null;
    spine.forEach((p, k) => {
      const s = k / (spine.length - 1);
      const along = norm(add(spine[Math.min(k + 1, spine.length - 1)], spine[Math.max(k - 1, 0)], -1));
      const side = norm(cross(along, [0, 1, 0]));
      const up = cross(side, along);
      // Clasping base, widest a third of the way out, drawn to a point.
      const w = W * (s < 0.35 ? 0.42 + 0.58 * Math.sin(s / 0.35 * Math.PI / 2) : Math.pow(Math.cos((s - 0.35) / 0.65 * Math.PI / 2), 0.8));
      const ring = [];
      for (let j = 0; j <= NV; j++) {
        const v = j / NV * 2 - 1;
        const cup = 0.22 * Math.pow(Math.abs(v), 1.5) * (1 - 0.5 * s);    // the blade is a shallow boat
        const pleat = 0.035 * Math.sin(v * Math.PI * 5.5) * (1 - 0.6 * s); // deep parallel pleats
        const q = add(add(p, side, v * w / 2), up, (cup + pleat) * w / 2);
        const edge = Math.pow(Math.abs(v), 6) * 0.25 + Math.pow(s, 5) * 0.4;  // margins and tips brown first
        ring.push(b.vertex(q, [j / NV, s], mixc(mixc(tone, [0.30, 0.47, 0.14], 0.5 * Math.abs(Math.sin(v * Math.PI * 5.5))), [0.5, 0.42, 0.18], edge)));
      }
      if (prev) for (let j = 0; j < NV; j++) b.quad(prev[j], prev[j + 1], ring[j], ring[j + 1]);
      prev = ring;
    });
  }

  if (flowering) {
    const cream = [0.94, 0.94, 0.84], eye = [0.62, 0.76, 0.42];
    const flower = (c, facing) => {                                         // a six-pointed star, about 15 mm across
      const n = norm(facing), u = norm(cross(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(n, u);
      const mid = flowers.vertex(c, [0.5, 0.5], eye);
      const rim = [];
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2, r = k % 2 ? 0.0035 : 0.0085;
        rim.push(flowers.vertex(add(add(c, u, Math.cos(a) * r), v, Math.sin(a) * r), [0.5, 0.5], cream));
      }
      for (let k = 0; k < 12; k++) flowers.idx.push(mid, rim[k], rim[(k + 1) % 12]);
    };
    const branches = 12 + Math.floor(rnd() * 6);
    for (let i = 0; i < branches; i++) {
      const t = i / branches;
      const from = stemAt(H + (top - H) * (0.05 + 0.8 * t));
      const heading = i * 2.3998 + rnd();
      const length = (0.2 - 0.13 * t) * (0.7 + 0.5 * rnd());
      const path = arc(from, heading, (50 + 20 * rnd()) * Math.PI / 180, 0.5, length, 6);
      strand(b, path, () => 0.0022, () => stemGreen, 3);
      for (let d = 0.012; d < length; d += 0.011) {
        const k = d / length * 6, i0 = Math.min(5, Math.floor(k));
        const p = add(path[i0], add(path[i0 + 1], path[i0], -1), k - i0);
        flower(add(p, [(rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.012]), [Math.cos(heading) + rnd() - 0.5, 0.3 + rnd(), Math.sin(heading) + rnd() - 0.5]);
      }
    }
    for (let d = 0; d < 0.12; d += 0.008) flower(add(stemAt(top - d), [(rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.02]), [rnd() - 0.5, 0.4, rnd() - 0.5]);
  }
  return [b, flowers];
}

// ---- sedge (Carex): a tussock of long, arching, keeled blades -----------------------
// Dark green with straw-coloured dead blades at the base, and a few stiff
// flowering stems carrying dark spikes.
function sedge(rnd) {
  const b = new Builder();
  const green = [0.17, 0.33, 0.12], blue = [0.15, 0.30, 0.17], straw = [0.60, 0.52, 0.30];
  const blades = 80 + Math.floor(rnd() * 40);
  for (let i = 0; i < blades; i++) {
    const a = rnd() * Math.PI * 2, r = 0.07 * Math.sqrt(rnd());
    const dead = rnd() < 0.13;
    const length = (dead ? 0.3 : 0.5) + 0.35 * rnd();
    const heading = a + (rnd() - 0.5) * 1.2;
    const path = arc([Math.cos(a) * r, 0, Math.sin(a) * r], heading, (4 + 20 * rnd()) * Math.PI / 180, (dead ? 2.0 : 0.7 + 1.3 * rnd() * rnd()), length, 8, 1.8);
    const tone = dead ? straw : mixc(green, blue, rnd());
    const shade = 0.75 + 0.5 * rnd();
    strand(b, path, (t) => (0.0045 - 0.004 * t * t) * (dead ? 0.8 : 1), (t) => mixc(mixc(tone, [0.32, 0.42, 0.14], dead ? 0 : t * t * 0.5), [0, 0, 0], 1 - shade * (0.55 + 0.45 * t)), 2, 0.45);
  }
  const stems = 5 + Math.floor(rnd() * 5);
  for (let i = 0; i < stems; i++) {
    const a = rnd() * Math.PI * 2, r = 0.05 * rnd(), heading = rnd() * Math.PI * 2;
    const length = 0.6 + 0.35 * rnd();
    const path = arc([Math.cos(a) * r, 0, Math.sin(a) * r], heading, (3 + 9 * rnd()) * Math.PI / 180, 0.25 * rnd(), length, 6);
    strand(b, path, () => 0.0016, () => [0.22, 0.36, 0.14], 3);
    const spikes = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < spikes; k++) {                      // the top spike is slim and tan, the ones below stout and dark
      const at = 1 - 0.035 - k * (0.07 + 0.03 * rnd());
      const j = at * 6, i0 = Math.min(5, Math.floor(j)), p = add(path[i0], add(path[i0 + 1], path[i0], -1), j - i0);
      const out = k === 0 ? 0.1 : 0.5 + 0.4 * rnd(), h2 = heading + (k % 2 ? 1.6 : -1.6);
      const spike = arc(p, h2, out, 0.2, k === 0 ? 0.035 : 0.028 + 0.012 * rnd(), 3);
      strand(b, spike, (t) => (k === 0 ? 0.0022 : 0.0042) * Math.sin(Math.PI * (0.12 + 0.82 * t)), () => (k === 0 ? [0.55, 0.42, 0.22] : [0.17, 0.11, 0.07]), 5);
    }
  }
  return [b];
}

// ---- rush (Juncus): a clump of stiff, round, leafless stems -------------------------
// Dark green wires with sharp tips; many carry a small brown tuft of seed
// capsules that seems to burst from the side of the stem near its top.
function rush(rnd) {
  const b = new Builder();
  const stems = 100 + Math.floor(rnd() * 50);
  for (let i = 0; i < stems; i++) {
    const a = rnd() * Math.PI * 2, r = 0.085 * Math.sqrt(rnd());
    const dead = rnd() < 0.1;
    const length = 0.4 + 0.42 * rnd();
    const heading = a + (rnd() - 0.5) * 1.5;
    const path = arc([Math.cos(a) * r, 0, Math.sin(a) * r], heading, (2 + 11 * rnd()) * Math.PI / 180, 0.12 + 0.3 * rnd() * rnd(), length, 6, 1.2);
    const tone = dead ? [0.50, 0.40, 0.22] : mixc([0.13, 0.28, 0.13], [0.17, 0.32, 0.18], rnd());
    const shade = 0.8 + 0.4 * rnd();
    strand(b, path, (t) => 0.0017 * (1 - Math.pow(t, 4)), (t) => mixc(mixc(tone, [0.55, 0.47, 0.22], Math.pow(t, 10)), [0, 0, 0], 1 - shade * (0.6 + 0.4 * t)), 3);
    if (!dead && rnd() < 0.4) {
      const at = 0.76 + 0.1 * rnd(), j = at * 6, i0 = Math.min(5, Math.floor(j)), p = add(path[i0], add(path[i0 + 1], path[i0], -1), j - i0);
      const side = heading + (rnd() < 0.5 ? 1.5 : -1.5);
      for (let k = 0; k < 4 + rnd() * 4; k++) {
        const twig = arc(p, side + (rnd() - 0.5) * 1.4, 0.5 + 0.7 * rnd(), 0.3, 0.008 + 0.012 * rnd(), 2);
        strand(b, twig, (t) => 0.0008 + 0.0022 * t, () => [0.36, 0.22, 0.10], 4);
      }
    }
  }
  return [b];
}

// ---- willow (the shrub willows of mountain meadows, such as Salix lemmonii) ----
// Many slender stems from one crown, arching outward into a rounded shrub two
// to four metres tall; side branches and whippy twigs in the upper part; narrow
// leaves a few centimetres long, darker above than below, all along the twigs.
// Returns the wood and the leaves separately, so the bake can leave the leaves
// off for a dead shrub.
function willow(rnd, low) {
  const wood = new Builder(), leaves = new Builder();
  const tall = low ? 2.1 + 0.5 * rnd() : 3.0 + 0.8 * rnd();
  const bark = (t) => mixc([0.26, 0.22, 0.17], [0.42, 0.31, 0.13], Math.min(1, t * 1.3));   // grey below, yellow-brown young wood above
  const leafy = (path, from, every, size) => {
    // A pair of leaves at each step up the shoot, held out and a little down.
    let gone = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const along = norm(add(b, a, -1)), out = norm(cross(along, [0.3 * (rnd() - 0.5), 1, 0.3 * (rnd() - 0.5)])), up = cross(out, along);
      for (let d = gone; d < seg; d += every) {
        if ((i - 1 + d / seg) / (path.length - 1) < from) continue;
        const base = add(a, along, d), spin = rnd() * 6.28;
        for (const side of [1, -1]) {
          const length = size * (0.7 + 0.6 * rnd());
          const o = norm(add(add([out[0], out[1], out[2]], up, Math.tan(spin + side)), along, 0.6));
          const dir = [o[0] * side * Math.cos(spin) + up[0] * Math.sin(spin) * side + along[0] * 0.5,
                       o[1] * side * Math.cos(spin) + up[1] * Math.sin(spin) * side + along[1] * 0.5,
                       o[2] * side * Math.cos(spin) + up[2] * Math.sin(spin) * side + along[2] * 0.5];
          const l = norm(dir), droop = 0.2 + 0.5 * rnd();
          const tip = add(add(base, l, length), [0, -1, 0], length * droop * 0.5), mid = add(add(base, l, length * 0.5), [0, -1, 0], length * droop * 0.12);
          const pale = rnd() < 0.3;                                            // an underside turned to the viewer
          const green = mixc(pale ? [0.37, 0.46, 0.28] : [0.2, 0.34, 0.09], [0.32, 0.43, 0.11], rnd() * 0.6);
          strand(leaves, [base, mid, tip], (t) => length * 0.13 * Math.sin(Math.PI * (0.12 + 0.86 * t)), (t) => mixc(green, [0.38, 0.47, 0.14], 0.3 * t), 2, 0.25);
        }
      }
      gone = (gone - seg) % every; if (gone < 0) gone += every;
    }
  };
  const stems = low ? 20 : 17;
  for (let s = 0; s < stems; s++) {
    // Inner stems stand up, outer ones lean out and are shorter: a dome.
    const outward = Math.sqrt((s + 0.5) / stems), heading = s * 2.4 + rnd() * 0.8;
    const foot = [Math.cos(heading) * 0.42 * outward, 0, Math.sin(heading) * 0.42 * outward];
    const tilt = 0.06 + (low ? 0.72 : 0.5) * outward + 0.1 * (rnd() - 0.5), length = tall * (1.06 - 0.28 * outward * outward) * (0.85 + 0.25 * rnd());
    const stem = arc(foot, heading, tilt, 0.12 + 0.25 * rnd(), length, 9, 1.2);
    strand(wood, stem, (t) => 0.024 * (1 - 0.8 * t) * (0.8 + 0.4 * outward), bark, 5);
    leafy(stem, 0.6, 0.03, 0.11);
    const sides = 7 + Math.floor(rnd() * 4);
    for (let k = 0; k < sides; k++) {
      // Branches start low on the outer stems, so the shrub is leafy to the ground at its edge.
      const at = (0.42 - 0.26 * outward) + (0.55 + 0.26 * outward) * (k + rnd()) / sides, j = at * 9, i0 = Math.min(8, Math.floor(j));
      const from = add(stem[i0], add(stem[i0 + 1], stem[i0], -1), j - i0);
      const h2 = heading + (rnd() - 0.5) * 2.8;
      const branch = arc(from, h2, tilt * 0.6 + 0.3 + 0.55 * rnd(), 0.5 * (rnd() - 0.3), length * (0.2 + 0.2 * rnd()) * (1.2 - at * 0.5), 6, 1.2);
      strand(wood, branch, (t) => 0.009 * (1 - 0.7 * t), (t) => bark(0.5 + 0.5 * t), 4);
      leafy(branch, 0.25, 0.028, 0.115);
      const twigs = 4 + Math.floor(rnd() * 3);
      for (let w = 0; w < twigs; w++) {
        const q = 0.15 + 0.8 * rnd(), jj = q * 6, i1 = Math.min(5, Math.floor(jj));
        const base = add(branch[i1], add(branch[i1 + 1], branch[i1], -1), jj - i1);
        const twig = arc(base, h2 + (rnd() - 0.5) * 2.6, 0.2 + 1.0 * rnd(), 0.5 * (rnd() - 0.5), 0.25 + 0.3 * rnd(), 5);
        strand(wood, twig, (t) => 0.0045 * (1 - 0.6 * t), () => [0.44, 0.33, 0.13], 3);
        leafy(twig, 0.0, 0.022, 0.11);
      }
    }
  }
  wood.material = 'willow wood';
  leaves.material = 'willow twig leaves';   // "twig": the bake leaves these off for a dead shrub
  return [wood, leaves];
}

// A leaf texture: white, so the vertex colours carry everything.
function white() {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

// Returns one Group per variant. Sedge and rush variants are single tussocks,
// to be strewn into a sward by the bake's scatter option.
export function buildPlants(kind, variants) {
  const materials = new Map();
  const named = (name) => {
    if (!materials.has(name)) {
      const m = new THREE.MeshBasicMaterial({ map: white(), vertexColors: true, side: THREE.DoubleSide });
      m.name = name;
      materials.set(name, m);
    }
    return materials.get(name);
  };
  const out = [];
  for (let v = 0; v < variants; v++) {
    const rnd = random(1000 + v * 7919 + kind.length * 131);
    const parts = kind === 'cornlily' ? cornLily(rnd, v % 3 === 2) : kind === 'sedge' ? sedge(rnd) : kind === 'willow' ? willow(rnd, v % 2 === 1) : rush(rnd);
    const group = new THREE.Group();
    group.name = `${kind}_${v}`;
    for (const p of parts) if (p.idx.length) group.add(p.mesh(named(p.material ?? kind)));
    out.push(group);
  }
  return out;
}
