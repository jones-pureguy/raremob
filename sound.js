const Sound = (() => {
  let ctx = null;
  let enabled = true;
  let volume = 0.5;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function playTone(freq, duration, opts = {}) {
    if (!enabled) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime);
    const vol = (opts.volume || 0.3) * volume;
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(vol, c.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration + (opts.decay || 0));
    osc.start(c.currentTime);
    osc.stop(c.currentTime + duration + (opts.decay || 0) + 0.05);
  }

  function playSequence(notes, opts = {}) {
    if (!enabled) return;
    const c = getCtx();
    let time = c.currentTime + (opts.startDelay || 0);
    notes.forEach(([freq, dur, decay]) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, time);
      const vol = (opts.volume || 0.3) * volume;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(vol, time + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur + (decay || 0));
      osc.start(time);
      osc.stop(time + dur + (decay || 0) + 0.05);
      time += dur;
    });
  }

  const N = {
    C3: 130.8, G3: 196.0,
    C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2,
    G4: 392.0, A4: 440.0, B4: 493.9,
    C5: 523.3, D5: 587.3, E5: 659.3, G5: 784.0
  };

  const SELECT_NOTES = [N.C4, N.D4, N.E4, N.F4];

  function cardSelect(cardIndex) {
    const freq = SELECT_NOTES[Math.min(cardIndex, 3)];
    playTone(freq, 0.08, { type: 'triangle', volume: 0.5 });
  }

  function handComplete(rankValue) {
    if (rankValue >= 10) {
      playSequence([
        [N.C4,0.07,0],[N.D4,0.07,0],[N.E4,0.07,0],[N.F4,0.07,0]
      ], { type:'triangle', volume:0.45 });
      playSequence([
        [N.G4,0.08,0],[N.A4,0.08,0],[N.B4,0.08,0],[N.C5,0.08,0],[N.D5,0.08,0],[N.E5,0.3,0.5]
      ], { type:'sine', volume:0.88, startDelay:0.32 });
    } else if (rankValue >= 9) {
      playSequence([
        [N.G4,0.12,0],[N.C5,0.12,0],[N.E5,0.12,0],[N.G5,0.35,0.4]
      ], { type:'sine', volume:0.85 });
    } else if (rankValue >= 7) {
      playSequence([
        [N.G4,0.1,0],[N.A4,0.1,0],[N.G4,0.25,0.35]
      ], { type:'sine', volume:0.78 });
    } else if (rankValue >= 3) {
      playSequence([
        [N.G4,0.1,0],[N.G4,0.22,0.3]
      ], { type:'sine', volume:0.75 });
    } else {
      playTone(N.G4, 0.18, { type:'sine', volume:0.7, decay:0.25 });
    }
  }

  function cardDrop() {
    if (!enabled) return;
    const c = getCtx();
    const len = c.sampleRate * 0.06;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1)*(1-i/len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.38*volume, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime+0.06);
    src.connect(flt); flt.connect(g); g.connect(c.destination);
    src.start();
  }

  let lastTyping = 0;
  function dialogTyping() {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastTyping < 80) return;
    lastTyping = now;
    playTone(120 + Math.random()*100, 0.07, { type:'sine', volume:0.22 });
  }

  function stageClear() {
    playSequence([
      [N.C4,0.15,0],[N.E4,0.15,0],[N.G4,0.15,0],[N.C5,0.3,0.4]
    ], { type:'sine', volume:0.80 });
  }

  function stageFail() {
    playSequence([
      [N.G3,0.15,0],[N.C3,0.3,0.3]
    ], { type:'sine', volume:0.65 });
  }

  function setEnabled(bool) {
    enabled = bool;
    localStorage.setItem('poker_sound_enabled', bool ? '1' : '0');
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('poker_sound_volume', volume);
  }
  function loadSettings() {
    const e = localStorage.getItem('poker_sound_enabled');
    const v = localStorage.getItem('poker_sound_volume');
    if (e !== null) enabled = e === '1';
    if (v !== null) volume = parseFloat(v);
  }
  function isEnabled() { return enabled; }

  function warmup() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      console.log('[Sound] AudioContext warmed up');
    } catch(e) {
      console.warn('[Sound] Warmup failed:', e);
    }
  }

  return { cardSelect, handComplete, cardDrop, dialogTyping, stageClear, stageFail, setEnabled, setVolume, loadSettings, isEnabled, warmup };
})();

Sound.loadSettings();

const BGM = (() => {
  let audio = null;
  let pendingSrc = null;
  let enabled = true;
  let volume = 0.35;

  function loadSettings() {
    const e = localStorage.getItem('poker_music_enabled');
    const v = localStorage.getItem('poker_music_volume');
    if (e !== null) enabled = e === '1';
    if (v !== null) volume = parseFloat(v);
  }

  function setEnabled(bool) {
    enabled = bool;
    localStorage.setItem('poker_music_enabled', bool ? '1' : '0');
    if (!bool) stop();
    else if (pendingSrc) start();
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('poker_music_volume', volume);
    if (audio) audio.volume = volume;
  }

  function isEnabled() { return enabled; }
  function getVolume() { return volume; }

  function init(src) {
    loadSettings();
    pendingSrc = src;
  }

  function start() {
    if (!enabled || !pendingSrc) return;
    if (audio && !audio.paused) return;
    if (!audio) {
      audio = new Audio(pendingSrc);
      audio.loop = true;
      audio.volume = volume;
    }
    audio.play().catch(err => {
      console.warn('[BGM] Autoplay blocked:', err.message);
    });
  }

  function stop() {
    if (audio) { audio.pause(); audio.currentTime = 0; }
  }

  function pause() {
    if (audio) audio.pause();
  }

  function resume() {
    if (enabled && audio && audio.paused) audio.play().catch(() => {});
  }

  return { init, start, stop, pause, resume, setEnabled, setVolume, isEnabled, getVolume, loadSettings };
})();
