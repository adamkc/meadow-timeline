// A tiling noise texture, so shaders look noise up instead of computing it.
//   r, g  two independent 4-octave fractal noises (base cell 32 texels)
//   b     white noise, one value per texel (linear filtering makes it value noise)
//   a     smooth value noise (cell 4 texels), for anything that needs a gradient
import * as THREE from 'three';

export function noiseTexture() {
  const S = 512;
  let state = 2024;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return (state >>> 8) / 16777216; };
  const lattice = (cell) => {
    const n = S / cell, v = new Float32Array(n * n);
    for (let i = 0; i < v.length; i++) v[i] = rand();
    return (x, y) => {
      const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy);
      let u = fx - i, w = fy - j;
      u = u * u * (3 - 2 * u); w = w * w * (3 - 2 * w);
      const i1 = (i + 1) % n, j1 = (j + 1) % n;
      return (v[j * n + i] * (1 - u) + v[j * n + i1] * u) * (1 - w) + (v[j1 * n + i] * (1 - u) + v[j1 * n + i1] * u) * w;
    };
  };
  const fractal = () => {
    const layers = [32, 16, 8, 4].map(lattice);
    return (x, y) => (layers[0](x, y) * 0.5 + layers[1](x, y) * 0.25 + layers[2](x, y) * 0.125 + layers[3](x, y) * 0.0625) / 0.9375;
  };
  const a = fractal(), b = fractal(), smooth = lattice(4);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4;
      data[k] = a(x, y) * 255; data[k + 1] = b(x, y) * 255; data[k + 2] = rand() * 255; data[k + 3] = smooth(x, y) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
