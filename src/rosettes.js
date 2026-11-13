// Meadow plants as they look from above: a clump of blades radiating from its
// centre, a whorl of corn lily leaves, a drift of flowers. Drawn here, not
// scanned. From the air a meadow is a mottle of such clumps; plants drawn as
// upright cards (grass.js) read as rows of strokes from up there.
//
// One texture, COLS x ROWS pictures: red is how light the blade is (dark in the
// heart of the clump, light at the tips), green marks flower heads, alpha is
// the clump's shape.
import * as THREE from 'three';

export const ROSETTES = {
  cols: 4, rows: 2,
  // per kind of plant (see KINDS in grass.js): first picture, how many, and the clump's width in metres
  kinds: { sedge: [0, 2, 1.5], lush: [2, 1, 1.3], rush: [3, 1, 1.1], dry: [4, 1, 0.9], lily: [5, 1, 1.5], flower: [6, 1, 1.3], forb: [7, 1, 0.9] },
};

export function rosetteTexture() {
  const S = 256, { cols, rows } = ROSETTES;
  const canvas = document.createElement('canvas');
  canvas.width = S * cols; canvas.height = S * rows;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  let state = 20261113;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return (state >>> 8) / 16777216; };
  const tone = (light, head = 0) => `rgb(${Math.round(255 * Math.min(1, light))},${Math.round(255 * head)},0)`;
  g.lineCap = 'round';

  // Blades from the centre outward, each drawn in pieces that lighten toward the tip.
  function blades(cell, { count, reach, width, curl, heart, spread = 0.05 }) {
    const cx = (cell % cols + 0.5) * S, cy = (Math.floor(cell / cols) + 0.5) * S, R = S * 0.47;
    for (let i = 0; i < count; i++) {
      const a = rand() * 2 * Math.PI, len = R * (reach[0] + (reach[1] - reach[0]) * rand()), bend = (rand() - 0.5) * curl;
      const x0 = cx + (rand() - 0.5) * R * spread * 2, y0 = cy + (rand() - 0.5) * R * spread * 2, light = 0.8 + 0.2 * rand();
      const at = (t) => { const b = a + bend * t * t; return [x0 + Math.cos(b) * len * t, y0 + Math.sin(b) * len * t]; };
      for (let s = 0; s < 4; s++) {
        g.strokeStyle = tone((heart + (1 - heart) * (s + 1) / 4) * light);
        g.lineWidth = width * (1 - 0.18 * s);
        g.beginPath(); g.moveTo(...at(s / 4)); g.lineTo(...at((s + 1) / 4)); g.stroke();
      }
    }
    return [cx, cy, R];
  }
  // Broad leaves in a whorl, ribbed, the upper ones smaller and lighter.
  function leaves(cell, { count, length, breadth, rings, ribs }) {
    const cx = (cell % cols + 0.5) * S, cy = (Math.floor(cell / cols) + 0.5) * S, R = S * 0.47;
    for (let ring = 0; ring < rings; ring++) {
      const k = 1 - 0.3 * ring, turn = rand() * 6.28;
      for (let i = 0; i < count; i++) {
        const a = turn + (i + 0.3 * rand()) / count * 2 * Math.PI, len = R * length * k * (0.85 + 0.15 * rand());
        g.save();
        g.translate(cx, cy); g.rotate(a);
        g.fillStyle = tone(0.5 + 0.18 * ring + 0.12 * rand());
        g.beginPath(); g.ellipse(len * 0.52, 0, len * 0.5, len * breadth, 0, 0, 2 * Math.PI); g.fill();
        g.strokeStyle = tone(0.34 + 0.15 * ring); g.lineWidth = 1.2;
        for (let r = -ribs; r <= ribs; r++) { // the pleats
          g.beginPath(); g.moveTo(len * 0.06, 0); g.quadraticCurveTo(len * 0.5, len * breadth * 1.7 * r / (ribs + 1), len * 0.98, 0); g.stroke();
        }
        g.restore();
      }
    }
  }
  blades(0, { count: 230, reach: [0.55, 1.0], width: 2.6, curl: 1.1, heart: 0.3 });                     // sedge tussock
  blades(1, { count: 190, reach: [0.45, 1.0], width: 2.9, curl: 1.6, heart: 0.34, spread: 0.12 });      // sedge, looser
  blades(2, { count: 150, reach: [0.4, 0.95], width: 2.2, curl: 2.2, heart: 0.4, spread: 0.3 });        // meadow grass
  blades(3, { count: 330, reach: [0.5, 0.85], width: 1.7, curl: 0.3, heart: 0.22 });                    // rush: stiff, fine, dark at heart
  blades(4, { count: 85, reach: [0.4, 0.9], width: 2.0, curl: 0.8, heart: 0.5, spread: 0.2 });          // dry bunchgrass, thin
  leaves(5, { count: 5, length: 0.95, breadth: 0.34, rings: 3, ribs: 3 });                              // corn lily
  const [fx, fy, fr] = blades(6, { count: 130, reach: [0.4, 0.95], width: 2.2, curl: 2.0, heart: 0.42, spread: 0.3 }); // grass in flower
  for (let i = 0; i < 22; i++) {
    const a = rand() * 6.28, r = fr * Math.sqrt(rand()) * 0.9;
    g.fillStyle = tone(1, 1);
    g.beginPath(); g.arc(fx + Math.cos(a) * r, fy + Math.sin(a) * r, 3.2 + 2.2 * rand(), 0, 2 * Math.PI); g.fill();
  }
  leaves(7, { count: 7, length: 0.7, breadth: 0.5, rings: 2, ribs: 1 });                                // a leafy forb

  // Outside the clump the picture is transparent, and would be black: the
  // small mipmaps would then darken every clump's edge. Give it the blades' middle tone.
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = Math.round(data[i] * a + 150 * (1 - a));
    data[i + 1] = Math.round(data[i + 1] * a);
  }
  const texture = new THREE.DataTexture(new Uint8Array(data.buffer), canvas.width, canvas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
