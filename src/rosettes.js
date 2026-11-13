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
  cols: 4, rows: 4,
  // The sward (see SWARD in grass.js): first picture, how many, and the clump's width in metres.
  // The wildflowers name their own picture in grass.js: 5 corn lily, 8 a clump
  // in flower, 9 lupine, 10 mule's ears, 11 bracken, 12 yarrow, 13 snow plant.
  sward: { sedge: [0, 2, 1.5], lush: [2, 1, 1.3], rush: [3, 1, 1.1], dry: [4, 1, 0.9] },
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
  leaves(7, { count: 7, length: 0.7, breadth: 0.5, rings: 2, ribs: 1 });                                // a leafy forb
  // Flower heads stand above the leaves, so from over them they cover far more than their share.
  const heads = (cx, cy, R, count, size, spread = 0.85) => {
    for (let i = 0; i < count; i++) {
      const a = rand() * 6.28, r = R * Math.sqrt(rand()) * spread;
      g.fillStyle = tone(0.75 + 0.25 * rand(), 1);
      g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size * (0.7 + 0.6 * rand()), 0, 2 * Math.PI); g.fill();
    }
  };
  const centre = (cell) => [(cell % cols + 0.5) * S, (Math.floor(cell / cols) + 0.5) * S, S * 0.47];
  blades(8, { count: 70, reach: [0.35, 0.9], width: 2.4, curl: 1.6, heart: 0.42, spread: 0.3 });        // a clump of some wildflower: a few leaves,
  heads(...centre(8), 46, 6.5);                                                                          // and many flowers
  { // lupine: hand-shaped leaves, and spikes seen end-on
    const [cx, cy, R] = centre(9);
    for (let i = 0; i < 11; i++) {
      const a = rand() * 6.28, r = R * (0.25 + 0.6 * rand()), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, n = 9, spin = rand();
      g.strokeStyle = tone(0.45 + 0.3 * rand()); g.lineWidth = 3.2;
      for (let k = 0; k < n; k++) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(spin + k / n * 6.28) * R * 0.2, y + Math.sin(spin + k / n * 6.28) * R * 0.2); g.stroke(); }
    }
    heads(cx, cy, R, 7, 11, 0.6);
  }
  { // mule's ears: big plain leaves standing up and out, yellow heads among them
    const [cx, cy, R] = centre(10);
    for (let i = 0; i < 13; i++) {
      const a = i * 2.4 + rand() * 0.5, len = R * (0.55 + 0.4 * rand());
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.fillStyle = tone(0.55 + 0.3 * rand());
      g.beginPath(); g.ellipse(len * 0.55, 0, len * 0.45, len * 0.16, 0, 0, 2 * Math.PI); g.fill();
      g.strokeStyle = tone(0.4); g.lineWidth = 1.5; g.beginPath(); g.moveTo(len * 0.12, 0); g.lineTo(len * 0.98, 0); g.stroke();
      g.restore();
    }
    heads(cx, cy, R, 4, 15, 0.45);
  }
  { // bracken: three-cornered fronds held out flat, cut into leaflets
    const [cx, cy, R] = centre(11);
    for (let f = 0; f < 4; f++) {
      const a = f * 1.7 + rand() * 0.6, len = R * (0.75 + 0.25 * rand());
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.strokeStyle = tone(0.4); g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke();
      for (let k = 0; k < 13; k++) {
        const x = len * (0.16 + 0.82 * k / 13), reach = len * 0.5 * Math.pow(1 - k / 13, 0.8) + 3;
        for (const sgn of [1, -1]) {
          g.strokeStyle = tone(0.5 + 0.35 * rand()); g.lineWidth = Math.max(3, len * 0.062);
          g.beginPath(); g.moveTo(x, 0); g.lineTo(x + reach * 0.25, sgn * reach); g.stroke();
        }
      }
      g.restore();
    }
  }
  blades(12, { count: 240, reach: [0.2, 0.75], width: 1.3, curl: 2.6, heart: 0.5, spread: 0.5 });       // yarrow: fine, feathery leaves,
  heads(...centre(12), 9, 17, 0.6);                                                                      // and flat white clusters
  { const [cx, cy] = centre(13); g.fillStyle = tone(0.9, 1); for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(cx + (rand() - 0.5) * 60, cy + (rand() - 0.5) * 60, 34 + 14 * rand(), 0, 2 * Math.PI); g.fill(); } } // snow plant: red spikes, nothing else

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
