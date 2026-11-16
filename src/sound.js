// The meadow's sound, made as it plays (Web Audio; no sound files). What is
// heard follows the timeline as closely as what is seen: frogs, running water
// and blackbirds over the wet meadow; grasshoppers and sparrows once it has
// dried; wind in the pines, a nuthatch, a chickadee and a woodpecker when the
// forest has closed over it. From the air it all falls away to moving air.
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
    grass: 0.9 * open * (1 - 0.6 * forest) * near,
    pines: (0.35 + 0.65 * forest) * (0.35 + 0.65 * near),
    air: 1 - near,
    brook: water * near * (0.45 + 0.55 * cut),
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

  // ---- the steady layers: each is noise through filters, its level set by apply()
  const level = {};
  // Wind in grass and sedge: a light hiss that comes and goes.
  level.grass = gain(0, out);
  { const g = gain(0.5, level.grass); source(white, 1, filter('bandpass', 3400, 0.5, filter('highpass', 1500, 0.7, g))); lfo(0.11, 0.25, g.gain); lfo(0.047, 0.2, g.gain); }
  // Wind in pines: lower, slower, a long sigh.
  level.pines = gain(0, out);
  { const g = gain(0.5, level.pines), f = filter('bandpass', 520, 0.45, g); source(dark, 1.9, f); source(white, 0.7, filter('bandpass', 1500, 0.6, gain(0.05, g))); lfo(0.06, 0.28, g.gain); lfo(0.023, 0.18, g.gain); lfo(0.05, 140, f.frequency); }
  // Open air, high up.
  level.air = gain(0, out);
  { const g = gain(0.5, level.air); source(dark, 1, filter('lowpass', 260, 0.5, g)); lfo(0.04, 0.2, g.gain); }
  // Running water: noise through two narrow filters that wander, so it trickles and never repeats.
  level.brook = gain(0, out);
  { const pre = filter('highpass', 450, 0.7), a = filter('bandpass', 1250, 2.2, gain(0.9, level.brook)), b = filter('bandpass', 2700, 3.2, gain(0.6, level.brook)), c = filter('bandpass', 620, 1.4, gain(0.45, level.brook));
    source(white, 0.83, pre); pre.connect(a); pre.connect(b); pre.connect(c);
    lfo(3.1, 260, a.frequency); lfo(0.7, 180, a.frequency); lfo(5.3, 500, b.frequency); lfo(1.3, 300, b.frequency); lfo(2.2, 120, c.frequency); }
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

  const mix = { grass: 0, pines: 0, air: 0, brook: 0, frogs: 0, meadowBirds: 0, blackbirds: 0, insects: 0, forestBirds: 0 };
  const LEVELS = { grass: 0.13, pines: 0.2, air: 0.13, brook: 0.3, insects: 0.5 };
  return {
    out,
    // Set what each layer should be doing (see mixFor), moving there over about a second.
    apply(m, at = ac.currentTime, glide = 0.8) {
      Object.assign(mix, m);
      for (const k in LEVELS) level[k].gain.setTargetAtTime(LEVELS[k] * clamp(mix[k]), at, glide);
    },
    // Schedule every call due before `horizon` (seconds on the context's clock).
    tick(horizon) {
      for (const c of callers) {
        while (c.next < horizon) {
          const amount = clamp(mix[c.key]);
          let took = 0;
          if (amount > 0.03 && rnd() < 0.25 + 0.75 * amount) took = c.call(c.next, amount);
          c.next += took + rr(c.every[0], c.every[1]) / (0.35 + 0.65 * amount);
        }
      }
    },
    skipTo(t) { for (const c of callers) c.next = Math.max(c.next, t + rnd() * 2); },
  };
}

const VOLUME = 0.8;

// The live sound: starts on the visitor's first click or key (browsers allow nothing sooner).
export function createSound() {
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
      if (graph) graph.apply(wanted);
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
