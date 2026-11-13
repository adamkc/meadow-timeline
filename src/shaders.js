// GLSL shared by everything in the scene. The haze on distant ground uses the
// same sky function as the dome behind it, so the horizon has no seam.

export const COMMON_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunAltDeg;
uniform float uHorizonMaxDeg;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBase;
uniform float uHeal;     // 0 surveyed terrain, 1 roads healed
uniform float uStage;    // the timeline: 0 intact wet meadow .. 6 mature forest
uniform vec3 uCut;       // the headcut: stage it sets off, stages it takes to cross the window, stages a spot takes to cut to full depth
uniform vec2 uWiden;     // then the banks retreat: stages that takes, and the half-width of the first slot (m)
uniform vec2 uDry;       // drying: stages the front takes from the meadow's edge to the channel, stages a spot takes to dry
uniform vec2 uKeys;      // tree shade is baked from this stage on, one layer per stage; index of the last layer
uniform vec3 uGrow;      // trees: stages to full height, shape of the growth curve, height at which a sapling becomes a tree
uniform float uTime;
uniform float uWide;     // 0 circling one meadow .. 1 out at the landscape view
uniform float uDitherShift; // moves the dither pattern every frame, so frames blended over time average it away
uniform sampler2D uNoise;

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// Noise comes from a tiling texture (see noise.js): cheap, and its mipmaps
// fade detail that is too fine for the pixel.
float fbm(vec2 p) { return texture2D(uNoise, p / 16.0).r; }
float fbm2(vec2 p) { return texture2D(uNoise, p / 16.0).g; }
float vnoise(vec2 p) { return texture2D(uNoise, (p + 0.5) / 512.0).b; }
float snoise(vec2 p) { return texture2D(uNoise, p / 128.0).a; }

vec3 skyColor(vec3 d, float disc) {
  float mu = dot(d, uSunDir);
  float up = max(d.y, 0.0);
  float toward = pow(clamp(mu * 0.5 + 0.5, 0.0, 1.0), 3.0);
  vec3 zenith = vec3(0.10, 0.26, 0.60);
  vec3 horizon = mix(vec3(0.52, 0.66, 0.82), vec3(1.15, 0.86, 0.52), toward);
  vec3 c = mix(zenith, horizon, pow(1.0 - up, 5.0));
  float m = max(mu, 0.0);
  c += vec3(1.0, 0.70, 0.36) * (0.50 * pow(m, 90.0) + 0.10 * pow(m, 8.0));
  c += disc * vec3(1.0, 0.80, 0.55) * (80.0 * smoothstep(0.99996, 0.99998, mu) + 3.0 * pow(m, 2500.0));
  return c;
}

// Haze that thickens toward the valley floor, integrated along the view ray.
vec3 applyFog(vec3 col, vec3 world) {
  vec3 v = world - cameraPosition;
  float dist = length(v);
  vec3 rd = v / dist;
  float k = uFogFalloff;
  float dy = rd.y * dist;
  float span = abs(dy) < 1e-3 ? dist : dist * (1.0 - exp(-k * dy)) / (k * dy);
  float fog = 1.0 - exp(-uFogDensity * exp(-k * (cameraPosition.y - uFogBase)) * span);
  vec3 hazeDir = normalize(vec3(rd.x, max(rd.y, 0.0) * 0.5 + 0.015, rd.z));
  return mix(col, skyColor(hazeDir, 0.0), fog);
}

// Baked horizon angle toward the sun -> soft shadow factor.
float sunShadow(float encoded) {
  float h = encoded * uHorizonMaxDeg;
  return smoothstep(h - 1.0, h + 2.2, uSunAltDeg);
}

// ---- the timeline ------------------------------------------------------------
// The story follows the stream evolution models: water spread through many
// small channels; one channel captures the flow and cuts a narrow trench; the
// trench's banks retreat; the meadow, now a terrace, dries from its edges
// inward. The cutting is done by headcuts: a step in the bed that enters each
// incised reach at its downstream end and climbs it. \`arrive\` is when the
// headcut reaches a spot, 0..1 over the time the headcuts are on the move.
float cutStart(float arrive) { return uCut.x + uCut.y * arrive; }
// How deep the trench is at a spot: 0 not cut yet, 1 its final depth.
float incised(float arrive) {
  float t0 = cutStart(arrive);
  return smoothstep(t0, t0 + uCut.z, uStage);
}
// Half-width of the trench now, in metres either side of the channel's centre
// line: a slot at first, then the banks fail and retreat, fast then slower.
// (The fill never reaches farther than 75 m from a channel.)
float trenchWidth(float arrive) {
  float q = clamp((uStage - cutStart(arrive) - 0.7 * uCut.z) / uWiden.x, 0.0, 1.0);
  return uWiden.y + (80.0 - uWiden.y) * q * q;   // a gully for a while, then it opens out
}
// Share of the pre-incision fill that is gone, d metres from the centre line.
float removed(float d, float arrive) {
  float w = trenchWidth(arrive);
  return incised(arrive) * (1.0 - smoothstep(w, w + 1.6, d));
}
// The gully and the floor of the widening trench: ground the headcut and the
// retreating banks have uncovered is raw sediment, and stays raw while the
// channel is still cutting and its banks still failing. Plants take it only
// well afterwards, nearest the channel first: that is the new floodplain.
// Only where the ground really dropped: toward the trench's outer edge the
// fill thins to nothing.
float freshBank(float d, float fill, float arrive) {
  float passed = sqrt(clamp((d - uWiden.y) / (80.0 - uWiden.y), 0.0, 1.0));     // inverse of trenchWidth
  float since = uStage - (cutStart(arrive) + 0.7 * uCut.z + passed * uWiden.x); // stages since the bank passed this spot
  return smoothstep(0.35, 0.9, fill) * smoothstep(-0.02, 0.03, since) * (1.0 - smoothstep(1.1, 2.6, since));
}
// The headcut itself: 1 on the short stretch of channel where the bed is dropping right now.
float headcut(float d, float fill, float arrive) {
  float k = incised(arrive);
  return 4.0 * k * (1.0 - k) * smoothstep(0.3, 0.8, fill) * (1.0 - smoothstep(uWiden.y + 1.5, uWiden.y + 5.0, d));
}
// The meadow's small channels (sdf: metres inside a thread's edge). Open
// sandy beds with water in them until the headcut passes and the main channel
// takes the flow; then they drain and are left as dry sand, which plants and
// needle litter take over only slowly.
float threadWater(float sdf, float arrive) {
  float t0 = cutStart(arrive);
  return sdf - 3.5 * smoothstep(t0 - 0.03, t0 + 0.22, uStage);
}
float threadBed(float sdf, float arrive) {   // 1 on a channel's bare bed
  float t0 = cutStart(arrive);
  return smoothstep(-0.35, 0.05, sdf) * (1.0 - smoothstep(t0 + 2.2, t0 + 4.2, uStage));
}
float threadCarve(float sdf, float arrive) { // metres a thread's bed lies below the meadow
  float t0 = cutStart(arrive);
  return 0.3 * smoothstep(-1.8, 0.5, sdf) * (1.0 - smoothstep(t0 + 2.5, t0 + 5.0, uStage));
}

// Ground moisture, 0 dry .. 1 saturated. While water spreads across the meadow
// (floorWet) all of it is wet. Once the channel has cut down, a drying front
// crosses the meadow from its edges (order 0) to the channel (order 0.8), and
// only the new, lower floodplain inside the trench (insetWet) stays wet.
// order near 1 marks ground beside a channel that never cut down: it stays wet.
float moisture(float floorWet, float insetWet, float order, float arrive) {
  float since = uStage - cutStart(arrive);
  float t0 = 0.35 + uDry.x * order;
  float drying = smoothstep(t0, t0 + uDry.y, since) * (1.0 - smoothstep(0.86, 0.96, order));
  return max(insetWet, floorWet * (1.0 - 0.93 * drying));
}

// A tree's height now, and what it is: 0 not there, 1 a sapling, 2 a grown
// tree, 3 standing dead. tools/prep_terrain.py and trees.js use the same rule.
float treeNow(float hmax, float birth, float death, float seed, out float what) {
  float h = hmax * pow(clamp((min(uStage, death) - birth) / uGrow.x, 0.0, 1.0), uGrow.y);
  what = 0.0;
  if (uStage > birth && h >= 0.25) {
    what = uStage < death ? (h < uGrow.z ? 1.0 : 2.0) : (uStage < death + 0.35 + 0.4 * seed ? 3.0 : 0.0);
  }
  return h;
}

// Tree shade on the ground, baked at a few key stages and blended between
// them. x: sunlight reaching the ground past the trees, y: canopy cover.
vec2 treeShade(sampler2DArray stages, vec2 uv) {
  float k = clamp(uStage - uKeys.x, 0.0, uKeys.y);
  float i = floor(k);
  return mix(texture(stages, vec3(uv, i)).rg, texture(stages, vec3(uv, min(i + 1.0, uKeys.y))).rg, k - i);
}

// Meadow colour by moisture: dark sedge green where it is saturated, bright
// grass green where moist, straw where dry.
vec3 meadowColor(vec2 xz, float wet, out float lush, out float patchy) {
  float broad = fbm(xz / 70.0);
  patchy = fbm2(xz / 11.0 + 31.0);
  lush = clamp(wet * 1.7 + (broad - 0.5) * 0.6, 0.0, 1.0);
  vec3 c = mix(vec3(0.25, 0.215, 0.08), vec3(0.08, 0.17, 0.033), lush);
  c = mix(c, vec3(0.045, 0.105, 0.036), 0.8 * smoothstep(0.78, 0.98, wet + (patchy - 0.5) * 0.15));
  // A meadow is not one green: patches lean yellow or blue at one scale, and
  // lighter or darker at another, independently.
  float hue = fbm(xz / 29.0 + 7.7), value = fbm2(xz / 47.0 + 3.1), fine = fbm(xz / 4.7 + 19.0);
  c *= mix(vec3(1.18, 1.05, 0.74), vec3(0.86, 0.98, 1.14), smoothstep(0.25, 0.75, hue));
  return c * (0.7 + 0.6 * patchy) * (0.78 + 0.44 * value) * (0.9 + 0.2 * fine);
}

// The ground: two textures per level. Heights: r surveyed height (metres above
// the datum), g road-healed minus surveyed, b fill that restores the surface
// before the channel cut down, a distance from the channel's centre line (m).
// Chan: r when the headcut arrives, g the meadow's small channels (0.5 = a
// thread's edge, +-4 m), b valid data.
vec4 fetchGround(sampler2D heights, vec2 uv, vec2 res) {
#ifdef FLOAT_LINEAR
  return texture2D(heights, uv);
#else
  vec2 p = uv * res - 0.5;
  vec2 f = fract(p);
  ivec2 i = ivec2(floor(p));
  ivec2 hi = ivec2(res) - 1;
  ivec2 a = clamp(i, ivec2(0), hi), b = clamp(i + 1, ivec2(0), hi);
  return mix(mix(texelFetch(heights, a, 0), texelFetch(heights, ivec2(b.x, a.y), 0), f.x),
             mix(texelFetch(heights, ivec2(a.x, b.y), 0), texelFetch(heights, b, 0), f.x), f.y);
#endif
}
float groundHeight(vec4 g, vec4 chan) {
  // (The small channels lie in the meadow's surface: where that has been cut away, so have they.)
  return g.r + uHeal * g.g + (1.0 - removed(g.a, chan.r)) * (g.b - threadCarve((chan.g - 0.5) * 8.0, chan.r));
}

// Stream water (tools/prep_terrain.py). Returns metres inside the water's edge
// (negative on the bank) and the flow direction scaled by speed, for the
// surveyed terrain blended toward the road-healed one. Before a channel cuts
// down (trench = 0) it is no bigger than the meadow's other threads.
float waterAt(sampler2D surveyed, sampler2D healed, vec2 uv, float trench, out vec2 flow) {
  vec3 w = mix(texture2D(surveyed, uv).rgb, texture2D(healed, uv).rgb, uHeal);
  flow = (w.gb - 0.5) * 2.0;
  return (w.r - 0.5) * 8.0 - 0.6 * (1.0 - trench);
}

// Screen-space dither for cross-fading levels of detail.
float dither(vec2 p) {
  return fract(52.9829189 * fract(dot(p + uDitherShift, vec2(0.06711056, 0.00583715))));
}
`;

export const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position * 1000.0 + cameraPosition, 1.0);
  gl_Position = p.xyww;
}
`;

export const SKY_FS = /* glsl */ `
${COMMON_GLSL}
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyColor(d, 1.0);
  if (d.y > 0.015) { // thin high cloud, lit warm toward the sun
    vec2 p = d.xz / (d.y + 0.09);
    float n = fbm(p * vec2(0.55, 1.5) + vec2(uTime * 0.004, 3.0)) * 0.72 + fbm2(p * 4.3 + 11.0) * 0.28;
    float cover = smoothstep(0.50, 0.82, n) * smoothstep(0.015, 0.22, d.y) * 0.5;
    float toward = pow(clamp(dot(d, uSunDir) * 0.5 + 0.5, 0.0, 1.0), 2.0);
    c = mix(c, mix(vec3(0.85, 0.87, 0.95), vec3(1.9, 1.3, 0.8), toward), cover);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

// Terrain tiles are flat unit grids; the vertex shader lifts them from the
// height texture, so level of detail is only a choice of grid density.
const TERRAIN_UNIFORMS = /* glsl */ `
uniform sampler2D uHeights, uChan;   // see fetchGround
uniform sampler2D uBake;   // sun horizon and sky visibility over the surveyed ground (r, g) and over the filled surface (b, a)
uniform sampler2D uZone;   // r wet meadow before incision, g ground that stays wet after, b drying order, a road
uniform sampler2DArray uStages; // per key stage: r sunlight past the trees, g canopy cover
uniform sampler2D uWater, uWaterHealed;
uniform sampler2D uLitter, uRocks, uDirt;   // scanned ground textures
uniform vec4 uLitterInfo, uRocksInfo, uDirtInfo; // 1 / average colour, 1 / size in metres
uniform vec2 uOrigin;      // world xz of the texture's north-west corner
uniform vec2 uExtent;      // metres covered by the texture
uniform vec2 uRes;         // texels
`;

export const TERRAIN_VS = /* glsl */ `
${COMMON_GLSL}
${TERRAIN_UNIFORMS}
attribute float skirt;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec2 uv = (w.xz - uOrigin) / uExtent;
  w.y = groundHeight(fetchGround(uHeights, uv, uRes), texture2D(uChan, uv)) - skirt * modelMatrix[0][0] * 0.12;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const TERRAIN_FS = /* glsl */ `
${COMMON_GLSL}
${TERRAIN_UNIFORMS}
uniform vec4 uCoreRect;    // far level only: xz min, xz max of the core window
varying vec3 vWorld;

// A scanned ground texture, laid twice at different sizes and angles and mixed
// by a slow noise so its repeat doesn't show.
vec3 ground(sampler2D tex, vec2 xz, float perMetre) {
  vec3 a = texture2D(tex, xz * perMetre).rgb;
  vec3 b = texture2D(tex, mat2(0.80, 0.60, -0.60, 0.80) * xz * perMetre * 0.37 + 0.31).rgb;
  return mix(a, b, smoothstep(0.35, 0.65, fbm(xz * 0.21)));
}

// Slope of the ripples on moving water at p. Two copies of the pattern are
// carried downstream and cross-faded, so it flows without ever stretching.
vec2 rippleSlope(vec2 p) {
  float h = snoise(p);
  return vec2(snoise(p + vec2(0.09, 0.0)) - h, snoise(p + vec2(0.0, 0.09)) - h) / 0.09;
}
vec3 flowing(vec2 xz, vec2 velocity) { // xy: ripple slope, z: foam pattern
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    float phase = fract(uTime * 0.45 + float(i) * 0.5);
    vec2 p = xz - velocity * (phase - 0.5) * 2.2 + float(i) * 7.3;
    sum += (1.0 - abs(2.0 * phase - 1.0)) * vec3(rippleSlope(p * 6.0) + 0.7 * rippleSlope(p * 17.0 + 3.1), fbm2(p * vec2(1.3)));
  }
  return sum;
}

void main() {
  vec2 xz = vWorld.xz;
#ifdef IS_FAR
  if (all(greaterThan(xz, uCoreRect.xy + 1.0)) && all(lessThan(xz, uCoreRect.zw - 1.0))) discard;
#endif
  vec2 uv = (xz - uOrigin) / uExtent;
  vec4 chan = texture2D(uChan, uv);
  if (chan.b < 0.5) discard;
  vec4 ground0 = fetchGround(uHeights, uv, uRes);
  vec4 bake = texture2D(uBake, uv);
  vec4 zone = texture2D(uZone, uv);
  vec2 shade = treeShade(uStages, uv);
  float arrive = chan.r;
  float trench = incised(arrive);               // how deep the channel has cut here
  float cut = removed(ground0.a, arrive);       // how much of the fill is gone at this very spot
  float knick = headcut(ground0.a, ground0.b, arrive);
  float fresh = max(freshBank(ground0.a, ground0.b, arrive), knick);
  float tsdf = (chan.g - 0.5) * 8.0;            // metres inside the edge of one of the meadow's small channels
  float bed = threadBed(tsdf, arrive) * (1.0 - cut);
  float dist = distance(cameraPosition, vWorld);

  // Normal from the height texture. The sample spacing grows with the pixel's
  // footprint on the ground so distant slopes don't shimmer.
  float fx = length(dFdx(xz)), fy = length(dFdy(xz));
  float cell = uExtent.x / uRes.x;
  float e = max(cell, 0.6 * max(fx, fy));
  float foot = sqrt(fx * fy); // for fading procedural detail
  vec2 du = vec2(e / uExtent.x, 0.0), dv = vec2(0.0, e / uExtent.y);
  vec4 gW = fetchGround(uHeights, uv - du, uRes), gE = fetchGround(uHeights, uv + du, uRes);
  vec4 gN = fetchGround(uHeights, uv - dv, uRes), gS = fetchGround(uHeights, uv + dv, uRes);
  vec3 N = normalize(vec3(groundHeight(gW, texture2D(uChan, uv - du)) - groundHeight(gE, texture2D(uChan, uv + du)), 2.0 * e,
                          groundHeight(gN, texture2D(uChan, uv - dv)) - groundHeight(gS, texture2D(uChan, uv + dv))));
  vec2 awayFromChannel = vec2(gE.a - gW.a, gS.a - gN.a); // east, south
  float slope = 1.0 - N.y;
  float road = zone.a * (1.0 - uHeal);
  float cover = shade.y;
  float wet = moisture(zone.r, zone.g, zone.b, arrive);
  vec2 flow;
  float ragged = (fbm2(xz * 0.4) - 0.5) * 0.5;
  float mainWater = waterAt(uWater, uWaterHealed, uv, trench, flow);
  // From far off a stream is narrower than a pixel and would break up and
  // vanish: it is drawn at least about a pixel wide, a little more in the
  // landscape view, where the point is to see where the water goes.
  mainWater += mix(0.25, 0.8, uWide) * max(foot - 0.5, 0.0);
  float threadLevel = threadWater(tsdf, arrive) - 4.0 * cut;
  float inWater = max(mainWater, threadLevel) + ragged * (1.0 - 0.6 * smoothstep(-0.6, 0.0, tsdf));
  // A cobble bed and bars only in the channel that cut down; the meadow's own
  // channels run over sand.
  float gravelly = trench * step(threadLevel, mainWater);
  // Under a road the stream is in a culvert.
  float culvert = 1.0 - smoothstep(0.3, 0.7, road);
  float water = smoothstep(-0.04, 0.1, inWater) * culvert;
  float bank = smoothstep(-0.9, -0.05, mainWater + ragged) * culvert * trench;

  // Tussock-scale relief the 1 m survey can't hold, as a bump on the normal.
  vec2 bump = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    float f = i == 0 ? 0.45 : (i == 1 ? 1.9 : 7.0);
    float amp = (i == 0 ? 0.30 : (i == 1 ? 0.22 : 0.16)) * clamp(1.0 - foot * f * 1.5, 0.0, 1.0);
    if (amp <= 0.0) continue;
    vec2 q = xz * f + float(i) * 19.7;
    float n0 = snoise(q);
    bump += amp * vec2(snoise(q + vec2(0.35, 0.0)) - n0, snoise(q + vec2(0.0, 0.35)) - n0) / 0.35;
  }
  N = normalize(N - vec3(bump.x, 0.0, bump.y) * (1.0 - smoothstep(0.3, 0.8, road)));

  // Ground colour: meadow, bare soil on steep faces, needle litter under
  // canopy, dirt on road treads.
  float lush, patchy;
  vec3 grass = meadowColor(xz, wet, lush, patchy);
  float nFine = vnoise(xz * 1.7);
  float nGrain = vnoise(xz * 11.0);
  // Scanned detail: each texture divided by its average, so it adds grain and
  // small shifts of colour without changing the scene's palette.
  vec3 dirtDetail = ground(uDirt, xz, uDirtInfo.w) * uDirtInfo.rgb;
  vec3 soil = vec3(0.19, 0.125, 0.075) * (0.75 + 0.5 * patchy) * dirtDetail;
  float bare = smoothstep(0.07, 0.24, slope + (patchy - 0.5) * 0.08);
  // Needle litter under canopy, and over most of the upland forest floor
  // whether or not a crown is right overhead. Wet ground stays green.
  float upland = 1.0 - smoothstep(0.05, 0.35, zone.r);
  float litter = smoothstep(0.35, 0.85, cover + 0.45 * upland + (patchy - 0.5) * 0.3) * (1.0 - smoothstep(0.5, 0.8, wet));
  bare = max(bare, max(bank * 0.85, fresh * 0.92));
  float grassy0 = (1.0 - bare) * (1.0 - litter) * (1.0 - bank) * (1.0 - bed); // ground that carries grass, before roads
  vec3 albedo = mix(grass * mix(vec3(1.0), dirtDetail, 0.5), soil, bare);
  // The small channels' beds: granite sand, dark while it is wet, pale once the
  // channel has drained.
  if (bed > 0.01) {
    float drained = smoothstep(0.15, 0.7, uStage - cutStart(arrive));
    vec3 sand = vec3(0.235, 0.2, 0.135) * (0.8 + 0.4 * nGrain) * mix(vec3(1.0), dirtDetail, 0.4) * mix(0.5, 1.0, drained);
    albedo = mix(albedo, sand, bed);
  }
  if (litter > 0.01) albedo = mix(albedo, vec3(0.17, 0.115, 0.07) * (0.8 + 0.4 * patchy) * ground(uLitter, xz, uLitterInfo.w) * uLitterInfo.rgb, litter);
  float tread = smoothstep(0.25, 0.7, road);
  albedo = mix(albedo, mix(vec3(0.25, 0.175, 0.10), vec3(0.14, 0.10, 0.065), litter) * dirtDetail, 0.9 * tread);
  // Cobbles and wet gravel on the bank.
  if (bank > 0.01) albedo = mix(albedo, ground(uRocks, xz, uRocksInfo.w) * mix(1.0, 0.55, bank), bank * 0.85);
  albedo *= mix(1.0, (0.82 + 0.36 * nFine) * (0.88 + 0.24 * nGrain), grassy0);
  float grassy = grassy0 * (1.0 - tread);
  // Where blades stand close to the camera the ground between them is dark.
  albedo *= mix(1.0, 0.6, grassy * (1.0 - smoothstep(8.0, 45.0, dist)));

  // Baked shadows and sky visibility: over the filled surface before the
  // channel cuts down, over the surveyed one after. Standing grass catches low
  // sun better than the flat ground it grows on.
  float shadow = sunShadow(mix(bake.b, bake.r, cut)) * shade.x;
  // The gully is narrower than the trench the survey holds, so the baked
  // shadows know nothing of its banks. The bank on the sun's side casts its
  // shadow across the floor: that, more than anything, is what shows it is a drop.
  float below = ground0.b * cut;                       // metres below the rim
  if (below > 0.1) {
    float toward = dot(normalize(awayFromChannel + vec2(1e-5)), normalize(uSunDir.xz)); // > 0: the sunward rim lies away from the channel
    float run = (trenchWidth(arrive) + 0.8 - ground0.a) / max(toward, 0.1);              // metres to that rim, along the sun's bearing
    float rise = run * uSunDir.y / length(uSunDir.xz);                                    // how high the sun's ray has climbed by then
    shadow *= 1.0 - 0.92 * smoothstep(0.05, 0.3, toward) * (1.0 - smoothstep(0.75, 1.1, rise / below)) * smoothstep(0.1, 0.5, below);
  }
  float ndl = clamp((dot(N, uSunDir) + 0.2) / 1.2, 0.0, 1.0);
  ndl = mix(ndl, max(ndl, 0.5), grassy * 0.7);
  float vis = 0.5 + 0.5 * mix(bake.a, bake.g, cut);
  vis = vis * vis * (1.0 - 0.5 * cover);
  vec3 light = uSunColor * ndl * shadow + mix(uGroundAmbient, uSkyAmbient, N.y * 0.5 + 0.5) * vis;
  vec3 col = albedo * light;

  if (water > 0.001) {
    float speed = length(flow) * mix(0.35, 1.0, gravelly);
    vec2 velocity = flow / max(speed, 1e-3) * (0.25 + 1.6 * speed);  // roughly metres per second
    vec3 f = flowing(xz, velocity);
    float detail = clamp(1.6 - foot * 6.0, 0.0, 1.0);                 // ripples fade where a pixel covers many of them
    // Glassy in the slow pools, broken in the riffles.
    float rough = (0.012 + 0.11 * smoothstep(0.3, 0.9, speed) + 0.03 * fbm(xz * 0.12)) * detail;
    vec3 Nw = normalize(vec3(-f.x * rough, 1.0, -f.y * rough));
    vec3 rd = normalize(vWorld - cameraPosition);
    float depth = clamp(inWater, 0.0, 3.0) * mix(0.45, 0.22, gravelly) + 0.04; // metres, deeper mid-channel
    // The bed, seen through the water: shifted by refraction, tinted and dimmed with depth.
    vec2 bedXZ = xz + Nw.xz * depth * 1.5;
    vec3 under = mix(vec3(0.15, 0.125, 0.08) * (0.7 + 0.6 * vnoise(bedXZ * 3.0)), ground(uRocks, bedXZ, uRocksInfo.w) * 1.15, gravelly)
             * (uSunColor * 0.7 * shadow + uSkyAmbient * vis);
    under = under * exp(-depth * vec3(3.2, 1.9, 2.6)) + vec3(0.012, 0.024, 0.016) * (1.0 - exp(-depth * 3.0)) * (shadow + 0.4);
    // What the surface mirrors. Seen at a low angle a stream reflects what
    // stands around it, not the sky: grassy banks in the open, the tree line
    // where there is forest.
    vec3 R = reflect(rd, Nw);
    R.y = abs(R.y);
    float wooded = smoothstep(0.1, 0.6, cover);
    // (A channel a metre or two wide between sedges mirrors mostly sedge.)
    float skyline = 0.07 + 0.55 * wooded + 0.3 * (1.0 - gravelly) + 0.1 * (fbm(xz * 0.05 + R.xz * 3.0) - 0.5);
    vec3 surroundings = mix(vec3(0.06, 0.085, 0.03), vec3(0.018, 0.032, 0.017), wooded) * (uSunColor * 0.5 + uSkyAmbient);
    vec3 mirrored = mix(surroundings, min(skyColor(R, 0.0), vec3(0.9)) * 0.75, smoothstep(skyline - 0.05, skyline + 0.07, R.y));
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, Nw), 0.0), 5.0);
    vec3 surface = mix(under, mirrored, fresnel);
    surface = mix(surface, min(skyColor(vec3(0.0, 1.0, 0.0), 0.0), vec3(0.9)) * 0.6, 0.55 * uWide * smoothstep(0.5, 2.0, foot)); // from far above, water is a ribbon of sky
    surface += uSunColor * shadow * (pow(max(dot(R, uSunDir), 0.0), 900.0) * 14.0 + pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.05);
    // White water where the channel is steep, and a thin line of it at the edge.
    float foam = 0.6 * smoothstep(0.58, 0.82, f.z + (speed - 0.85) * 0.6) * smoothstep(0.55, 0.95, speed);
    foam = max(foam, 0.3 * smoothstep(0.2, 0.0, inWater) * smoothstep(0.5, 0.7, f.z)) * detail * gravelly;
    // The stream falls over the headcut.
    foam = max(foam, knick * (0.3 + 0.45 * smoothstep(0.3, 0.7, f.z)));
    surface = mix(surface, vec3(0.8, 0.82, 0.85) * (uSunColor * 0.45 * shadow + uSkyAmbient * 0.55 * vis), foam);
    col = mix(col, surface, water);
  }

  // The data ends at the watershed's boundary. The last stretch dissolves into
  // the sky behind it, in place of a cut edge.
  vec3 seen = applyFog(col, vWorld);
  if (chan.a < 0.995) seen = mix(skyColor(normalize(vWorld - cameraPosition), 0.0), seen, smoothstep(0.0, 1.0, chan.a));
  gl_FragColor = vec4(seen, 1.0);
}
`;
