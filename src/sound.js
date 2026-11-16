// The meadow's sound, made as it plays (Web Audio; no sound files). What is
// heard follows the timeline as closely as what is seen: frogs, running water
// and blackbirds over the wet meadow; grasshoppers and sparrows once it has
// dried; wind in the pines, a nuthatch, a chickadee and a woodpecker when the
// forest has closed over it.
//
// The air is mostly still. Wind comes in gusts, a few seconds each, with quiet
// between them: a steady hiss, however it is filtered, sounds like static or a
// far-off waterfall, not like wind. Water is not hiss either: it is made of
// bubbles, hundreds of short rising chirps.
//
// build() makes the whole graph on any audio context, live or offline, so that
// tools/sound_test.mjs can render it and measure the levels.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// What each layer should be doing, from where the camera is and when.
//   stage 0..6; height above the ground (m); canopy 0..1 over the camera;
//   water 0..1, how close running water is; cut 0..1, how far the channel there has cut down
export function mixFor({ stage, height, canopy, water, cut }) {
  const near = 1 / (1 + height / 45);                     // the ground's sounds fall away with height
  const wet = 1 - smooth(0.7, 2.4, stage);                // the meadow still has water at its surface
  const open = 1 - smooth(3.3, 4.8, stage);               // still open ground
  const forest = Math.max(canopy * (height < 40 ? 1 : 0), smooth(3.4, 5.4, stage));
  return {
    grass: open * (1 - 0.6 * forest) * near,
    pines: (0.3 + 0.7 * forest) * (0.3 + 0.7 * near) + 0.3 * (1 - near),   // from the air, wind over the forest is all there is
    brook: water * near * (0.5 + 0.5 * cut),
    frogs: wet * near,
    meadowBirds: open * near * (1 - 0.5 * canopy),
    blackbirds: wet * open * near,
    insects: smooth(1.3, 2.6, stage) * open * near,
    forestBirds: forest * (0.3 + 0.7 * near),
  };
}

export function build(ac, seed = 1) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const rr = (a, b) => a + (b - a) * rnd();
  const sr = ac.sampleRate;
  const node = (C, options, ...to) => { const n = new C(ac, options); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const gain = (value, ...to) => node(GainNode, { gain: value }, ...to);
  const filter = (type, frequency, Q, ...to) => node(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (frequency, depth, param) => node(OscillatorNode, { frequency }, gain(depth, param));
  // A loop of noise whose end fades into its start. `colour` 0 is white, toward 1 it is darker.
  const noiseLoop = (seconds, colour) => {
    const n = Math.floor(sr * seconds), fade = 4096, buffer = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr });
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      let b = 0;
      for (let i = 0; i < n + fade; i++) {
        b += (rnd() * 2 - 1 - b) * (1 - colour);
        const v = b * (1 + 6 * colour);
        if (i < n) d[i] = v; else { const k = (i - n) / fade; d[i - n] = d[i - n] * k + v * (1 - k); }
      }
    }
    return buffer;
  };
  const white = noiseLoop(7, 0), dark = noiseLoop(11, 0.97);
  const source = (buffer, playbackRate, ...to) => node(AudioBufferSourceNode, { buffer, loop: true, playbackRate }, ...to);

  const limiter = node(DynamicsCompressorNode, { threshold: -8, knee: 6, ratio: 16, attack: 0.004, release: 0.3 }, ac.destination);
  const out = gain(0, limiter);
  // A little of the open air's reverberation, for calls from across the meadow and off in the trees.
  const tail = new AudioBuffer({ length: Math.floor(sr * 1.6), numberOfChannels: 2, sampleRate: sr });
  for (let ch = 0; ch < 2; ch++) { const d = tail.getChannelData(ch); let b = 0; for (let i = 0; i < d.length; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.1 + 0.6 * Math.exp(-t * 5)); d[i] = b * Math.exp(-t * 4.2) * (1 - Math.exp(-t * 60)); } }
  const far = node(ConvolverNode, { buffer: tail }, out);

  // ---- wind: noise through filters that open as a gust rises; almost nothing between gusts
  const level = {};
  level.grass = gain(0, out);
  level.pines = gain(0, out);
  const gustGrass = gain(0.03, level.grass), gustPines = gain(0.03, level.pines);
  const grassTone = filter('bandpass', 2600, 0.45, filter('highpass', 1200, 0.7, gustGrass));   // a light hiss in grass and sedge
  const pinesTone = filter('lowpass', 420, 0.6, filter('highpass', 110, 0.7, gustPines));       // lower and slower: a long sigh
  source(white, 1, grassTone); source(dark, 1.7, pinesTone); source(white, 0.6, filter('bandpass', 1100, 0.5, gain(0.035, pinesTone)));
  // Gusts are set by tick(): how strong the next one is, and how long the lull after it.
  let gustAt = 0.5;
  function gusts(horizon) {
    while (gustAt < horizon) {
      const strength = rnd() < 0.55 ? rr(0.35, 1.0) : rr(0.08, 0.25), rise = rr(0.7, 1.8), hold = rr(1.2, 4.5), fall = rr(1.5, 3.5);
      for (const [g, tone, lo, hi, lag] of [[gustGrass, grassTone, 2200, 4200, 0], [gustPines, pinesTone, 330, 950, 0.7]]) {
        g.gain.setTargetAtTime(0.03 + 0.97 * strength, gustAt + lag, rise / 2.5);
        tone.frequency.setTargetAtTime(lo + (hi - lo) * strength, gustAt + lag, rise / 2.5);
        g.gain.setTargetAtTime(0.03, gustAt + lag + rise + hold, fall / 2.5);
        tone.frequency.setTargetAtTime(lo, gustAt + lag + rise + hold, fall / 2.5);
      }
      gustAt += rise + hold + fall + rr(1.5, 9);   // and then a lull
    }
  }
  // ---- running water: a loop built once, out of bubbles. Each is a short tone that
  // rises in pitch as it dies away; hundreds of them a second make a trickle.
  const bubbles = (seconds, perSecond, low, high) => {
    const n = Math.floor(sr * seconds), buffer = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr });
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      for (let b = 0, count = Math.floor(seconds * perSecond); b < count; b++) {
        const f0 = low * Math.pow(high / low, rnd()), dur = rr(0.012, 0.03) * Math.sqrt(1500 / f0) + 0.006, glide = rr(1.1, 1.6);
        const amp = rr(0.15, 1) * Math.pow(900 / f0, 0.35) * (rnd() < 0.08 ? 2.2 : 1), len = Math.floor(dur * sr), start = Math.floor(rnd() * n);
        let phase = 0;
        for (let i = 0; i < len; i++) {
          const t = i / len;
          phase += 2 * Math.PI * f0 * (1 + (glide - 1) * t) / sr;
          d[(start + i) % n] += amp * Math.sin(phase) * Math.min(1, i / (0.002 * sr)) * Math.exp(-4.5 * t);   // wraps round the end, so the loop has no seam
        }
      }
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
      for (let i = 0; i < n; i++) d[i] /= peak;
    }
    return buffer;
  };
  level.brook = gain(0, out);
  source(bubbles(7, 260, 500, 3600), 1, gain(0.6, level.brook));
  source(bubbles(5, 120, 300, 1400), 1, gain(0.45, level.brook));                               // the lower voice of deeper water
  source(white, 0.9, filter('bandpass', 1900, 0.8, gain(0.012, level.brook)));                  // and a breath of spray under it
  // Grasshoppers in dry grass: a thin, high rasp in pulses.
  level.insects = gain(0, out);
  { const swell = gain(0.55, level.insects), pulses = gain(0.5, swell);   // 31 pulses a second, in bouts that swell and fade
    source(white, 1.3, filter('bandpass', 6800, 9, pulses));
    node(OscillatorNode, { type: 'square', frequency: 31 }, gain(0.5, pulses.gain));
    lfo(0.19, 0.3, swell.gain); lfo(0.071, 0.15, swell.gain); }

  // ---- voices: a pool of oscillators for calls, each note a glide in pitch with its own loudness curve
  const pool = (count, type, shape, wet) => Array.from({ length: count }, () => {
    const pan = node(StereoPannerNode, {}, out, gain(wet, far)), g = gain(0, pan);
    const o = node(OscillatorNode, { type });
    if (shape) { const f = filter('bandpass', shape[0], shape[1], g); o.connect(f); return { o, g, pan, f }; }
    o.connect(g);
    return { o, g, pan };
  });
  const note = (voice, t, f0, f1, dur, vol, attack = 0.012) => {
    const f = voice.o.frequency, g = voice.g.gain;
    f.setValueAtTime(f0, t); f.exponentialRampToValueAtTime(f1, t + dur);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + Math.min(attack, dur * 0.4)); g.setValueAtTime(vol, t + dur * 0.7); g.linearRampToValueAtTime(0, t + dur);
  };
  const take = (voices) => { const v = voices.shift(); voices.push(v); return v; };
  const whistles = pool(5, 'sine', null, 0.35), buzzers = pool(4, 'sawtooth', [2300, 7], 0.25), nasal = pool(2, 'sawtooth', [1700, 3], 0.6);
  // A drum on dead wood: short thumps of filtered noise.
  const knock = gain(0, filter('bandpass', 900, 2.5, out, gain(0.8, far))); source(white, 1.1, knock);

  // Each caller: when it next calls, and what a call is. `amount` 0..1 sets how often and how loud.
  const callers = [
    { key: 'frogs', next: 0.5, every: [0.2, 0.9], call(t, amount) { // a treefrog's two-part "krr-eck", several animals in turn
      const v = take(buzzers), rate = rr(78, 100), pitch = rr(2000, 2600), vol = 1.6 * amount * rr(0.35, 1);
      v.pan.pan.setValueAtTime(rr(-0.9, 0.9), t); v.f.frequency.setValueAtTime(pitch, t);
      note(v, t, rate, rate * 1.02, 0.11, vol); note(v, t + 0.16, rate * 1.05, rate * 1.3, 0.2, vol * 1.1);
      return 0.36; } },
    { key: 'blackbirds', next: 3, every: [4, 11], call(t, amount) { // a red-winged blackbird: two short notes and a long buzzy trill
      const v = take(whistles), b = take(buzzers), vol = 0.13 * amount, pan = rr(-0.8, 0.8);
      v.pan.pan.setValueAtTime(pan, t); b.pan.pan.setValueAtTime(pan, t); b.f.frequency.setValueAtTime(3300, t);
      note(v, t, 1500, 1700, 0.09, vol); note(v, t + 0.14, 2100, 2400, 0.1, vol);
      note(b, t + 0.3, 46, 52, 0.75, vol * 9, 0.05);
      return 1.1; } },
    { key: 'meadowBirds', next: 1.5, every: [2.5, 7], call(t, amount) { // a sparrow: a few clear whistles, then a run of quick slurred notes
      const v = take(whistles), vol = 0.14 * amount * rr(0.5, 1), base = rr(3200, 4300);
      v.pan.pan.setValueAtTime(rr(-0.9, 0.9), t);
      let at = t;
      for (let i = 0, n = 2 + Math.floor(rnd() * 2); i < n; i++) { const f = base * rr(0.9, 1.15); note(v, at, f, f * rr(0.97, 1.03), 0.22, vol, 0.03); at += 0.3; }
      for (let i = 0, n = 4 + Math.floor(rnd() * 6); i < n; i++) { const f = base * rr(1.0, 1.5); note(v, at, f, f * rr(0.7, 0.9), 0.07, vol * 0.9); at += 0.1; }
      return at - t; } },
    { key: 'forestBirds', next: 4, every: [5, 13], call(t, amount) {
      const which = rnd(), vol = 0.13 * amount, pan = rr(-0.9, 0.9);
      if (which < 0.4) { // a mountain chickadee: two or three clear whistles, each a step lower
        const v = take(whistles); v.pan.pan.setValueAtTime(pan, t);
        let f = rr(3700, 4100), at = t;
        for (let i = 0, n = 2 + Math.floor(rnd() * 2); i < n; i++) { note(v, at, f, f * 0.985, 0.34, vol, 0.04); f *= 0.86; at += 0.42; }
        return at - t;
      }
      if (which < 0.75) { // a nuthatch: a run of nasal notes
        const v = take(nasal); v.pan.pan.setValueAtTime(pan, t);
        let at = t;
        for (let i = 0, n = 3 + Math.floor(rnd() * 5); i < n; i++) { note(v, at, 540, 500, 0.11, vol * 5, 0.015); at += 0.21; }
        return at - t;
      }
      // a woodpecker drumming: a roll that quickens and fades
      let at = t, gap = 0.075;
      for (let i = 0; i < 15; i++) { const g = knock.gain; g.setValueAtTime(0, at); g.linearRampToValueAtTime(0.5 * amount * (1 - i / 22), at + 0.004); g.exponentialRampToValueAtTime(0.0005, at + 0.045); at += gap; gap *= 0.96; }
      return at - t; } },
  ];

  const mix = { grass: 0, pines: 0, brook: 0, frogs: 0, meadowBirds: 0, blackbirds: 0, insects: 0, forestBirds: 0 };
  const LEVELS = { grass: 0.1, pines: 0.14, brook: 0.2, insects: 0.5 };
  return {
    out,
    // Set what each layer should be doing (see mixFor), moving there over about a second.
    apply(m, at = ac.currentTime, glide = 0.8) {
      Object.assign(mix, m);
      for (const k in LEVELS) level[k].gain.setTargetAtTime(LEVELS[k] * clamp(mix[k]), at, glide);
    },
    // Schedule every call due before `horizon` (seconds on the context's clock).
    tick(horizon) {
      gusts(horizon);
      for (const c of callers) {
        while (c.next < horizon) {
          const amount = clamp(mix[c.key]);
          let took = 0;
          if (amount > 0.03 && rnd() < 0.25 + 0.75 * amount) took = c.call(c.next, amount);
          c.next += took + rr(c.every[0], c.every[1]) / (0.35 + 0.65 * amount);
        }
      }
    },
    skipTo(t) { gustAt = Math.max(gustAt, t + 0.5); for (const c of callers) c.next = Math.max(c.next, t + rnd() * 2); },
    get mix() { return mix; },
  };
}

const VOLUME = 0.8;

// The live sound: starts on the visitor's first click or key (browsers allow nothing sooner).
export function createSound({ hush = [] } = {}) {
  let ac = null, graph = null, muted = false, wanted = null;
  try { muted = localStorage.getItem('meadow.muted') === '1'; } catch {}
  const api = {
    get muted() { return muted; },
    get running() { return !!ac && ac.state === 'running'; },
    start() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC({ latencyHint: 'playback' });
        graph = build(ac, 7);
        graph.skipTo(ac.currentTime);
        if (wanted) graph.apply(wanted, ac.currentTime, 0.05);
        graph.out.gain.setTargetAtTime(muted ? 0 : VOLUME, ac.currentTime, 1.2);
        setInterval(() => { if (ac.state === 'running') graph.tick(ac.currentTime + 0.4); }, 100);
        document.addEventListener('visibilitychange', () => (document.hidden ? ac.suspend() : ac.resume()));
      }
      if (ac.state === 'suspended' && !document.hidden) ac.resume();
    },
    // Called a few times a second with where the camera is and when (see mixFor).
    update(where) {
      wanted = mixFor(where);
      for (const k of hush) if (k in wanted) wanted[k] = 0;   // ?hush=pines,brook silences layers, to find which one is which
      if (graph) graph.apply(wanted);
    },
    // What is playing, loudest first, for the render-info readout (I).
    describe() {
      if (!wanted) return '';
      return Object.entries(wanted).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
    },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('meadow.muted', muted ? '1' : '0'); } catch {}
      if (graph) graph.out.gain.setTargetAtTime(muted ? 0 : VOLUME, ac.currentTime, 0.1);
      return muted;
    },
  };
  return api;
}
