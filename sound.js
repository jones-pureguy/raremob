// =============================================
// [ADAPTER] 사운드 모듈 — Expo 전환 시 expo-av로 교체
// =============================================

const Sound = (() => {
  let ctx = null;
  let masterOutput = null;
  let enabled = true;
  let volume = 0.5;

  // [ADAPTER] AudioContext 초기화 — Expo 전환 시 expo-av
  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!masterOutput) {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-20, ctx.currentTime);
      compressor.knee.setValueAtTime(10, ctx.currentTime);
      compressor.ratio.setValueAtTime(4, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.1, ctx.currentTime);
      compressor.connect(ctx.destination);
      masterOutput = compressor;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // [ADAPTER] 톤 재생 — Expo 전환 시 expo-av
  function playTone(freq, duration, opts = {}) {
    if (!enabled) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterOutput);
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime);
    const vol = (opts.volume || 0.3) * volume;
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(vol, c.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration + (opts.decay || 0));
    osc.start(c.currentTime);
    osc.stop(c.currentTime + duration + (opts.decay || 0) + 0.05);
  }

  // [ADAPTER] 시퀀스 재생 — Expo 전환 시 expo-av
  function playSequence(notes, opts = {}) {
    if (!enabled) return;
    const c = getCtx();
    let time = c.currentTime + (opts.startDelay || 0);
    notes.forEach(([freq, dur, decay]) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(masterOutput);
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

  // [REUSE] 음계 상수
  const N = {
    C3: 130.8, G3: 196.0,
    C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2,
    G4: 392.0, A4: 440.0, B4: 493.9,
    C5: 523.3, D5: 587.3, E5: 659.3, G5: 784.0
  };

  // [REUSE] 카드 선택 음계 매핑
  const SELECT_NOTES = [N.C4, N.D4, N.E4, N.F4];
  // [REUSE] MANIAC 모드 5음 매핑 (도-레-미-파-솔)
  const SELECT_NOTES_MN = [N.C4, N.D4, N.E4, N.F4, N.G4];

  // [ADAPTER] 카드 선택 효과음
  function cardSelect(cardIndex) {
    const freq = SELECT_NOTES[Math.min(cardIndex, 3)];
    playTone(freq, 0.08, { type: 'triangle', volume: 0.65 });
  }

  // [ADAPTER] MANIAC 카드 선택 효과음 (5음, 5n 단위 반복)
  function cardSelectMn(cardIndex) {
    const freq = SELECT_NOTES_MN[Math.min(cardIndex, 4)];
    playTone(freq, 0.08, { type: 'triangle', volume: 0.65 });
  }

  // [ADAPTER] MANIAC 5장 패 확정 "딩" 효과음 (짧은 high ping)
  function handLock() {
    // 두 음 stack: 높은 음 + 짧은 sustain
    playTone(N.E5, 0.05, { type: 'sine', volume: 0.5 });
    playTone(N.G5, 0.12, { type: 'sine', volume: 0.55 });
  }

  // [ADAPTER] 핸드 완성 효과음
  function handComplete(rankValue) {
    if (rankValue >= 10) {
      playSequence([
        [N.C4,0.07,0],[N.D4,0.07,0],[N.E4,0.07,0],[N.F4,0.07,0]
      ], { type:'triangle', volume:0.58 });
      playSequence([
        [N.G4,0.08,0],[N.A4,0.08,0],[N.B4,0.08,0],[N.C5,0.08,0],[N.D5,0.08,0],[N.E5,0.3,0.5]
      ], { type:'sine', volume:1.0, startDelay:0.32 });
    } else if (rankValue >= 9) {
      playSequence([
        [N.G4,0.12,0],[N.C5,0.12,0],[N.E5,0.12,0],[N.G5,0.35,0.4]
      ], { type:'sine', volume:1.0 });
    } else if (rankValue >= 7) {
      playSequence([
        [N.G4,0.1,0],[N.A4,0.1,0],[N.G4,0.25,0.35]
      ], { type:'sine', volume:1.0 });
    } else if (rankValue >= 3) {
      playSequence([
        [N.G4,0.1,0],[N.G4,0.22,0.3]
      ], { type:'sine', volume:0.97 });
    } else {
      playTone(N.G4, 0.18, { type:'sine', volume:0.91, decay:0.25 });
    }
  }

  // [ADAPTER] 카드 드롭 효과음
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
    g.gain.setValueAtTime(0.49*volume, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime+0.06);
    src.connect(flt); flt.connect(g); g.connect(masterOutput);
    src.start();
  }

  let lastTyping = 0;
  // [ADAPTER] 다이얼로그 타이핑 효과음
  function dialogTyping() {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastTyping < 80) return;
    lastTyping = now;
    playTone(120 + Math.random()*100, 0.07, { type:'sine', volume:0.29 });
  }

  // [ADAPTER] 스테이지 클리어 효과음
  function stageClear() {
    playSequence([
      [N.C4,0.15,0],[N.E4,0.15,0],[N.G4,0.15,0],[N.C5,0.3,0.4]
    ], { type:'sine', volume:1.0 });
  }

  // [ADAPTER] 스테이지 실패 효과음
  function stageFail() {
    playSequence([
      [N.G3,0.15,0],[N.C3,0.3,0.3]
    ], { type:'sine', volume:0.85 });
  }

  // [ADAPTER] 사운드 활성화 설정 — Expo 전환 시 AsyncStorage
  function setEnabled(bool) {
    enabled = bool;
    localStorage.setItem('poker_sound_enabled', bool ? '1' : '0');
  }
  // [ADAPTER] 볼륨 설정 — Expo 전환 시 AsyncStorage
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('poker_sound_volume', volume);
  }
  // [ADAPTER] 설정 로드 — Expo 전환 시 AsyncStorage
  function loadSettings() {
    const e = localStorage.getItem('poker_sound_enabled');
    const v = localStorage.getItem('poker_sound_volume');
    if (e !== null) enabled = e === '1';
    if (v !== null) volume = parseFloat(v);
  }
  // [REUSE] 사운드 활성화 여부
  function isEnabled() { return enabled; }

  // [ADAPTER] AudioContext 웜업
  function warmup() {
    if (ctx) return;
    try {
      const c = getCtx();
      const buf = c.createBuffer(1, 1, c.sampleRate);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
      console.log('[Sound] AudioContext warmed up');
    } catch(e) {
      console.warn('[Sound] Warmup failed:', e);
    }
  }

  return { cardSelect, cardSelectMn, handComplete, handLock, cardDrop, dialogTyping, stageClear, stageFail, setEnabled, setVolume, loadSettings, isEnabled, warmup };
})();

Sound.loadSettings();

// =============================================
// [ADAPTER] BGM 모듈 — Expo 전환 시 expo-av로 교체
// =============================================

const BGM = (() => {
  let audio = null;
  let pendingSrc = null;
  let enabled = true;
  let volume = 0.35;

  // [ADAPTER] BGM 설정 로드 — Expo 전환 시 AsyncStorage
  function loadSettings() {
    const e = localStorage.getItem('poker_music_enabled');
    const v = localStorage.getItem('poker_music_volume');
    if (e !== null) enabled = e === '1';
    if (v !== null) volume = parseFloat(v);
  }

  // [ADAPTER] BGM 활성화 설정 — Expo 전환 시 AsyncStorage
  function setEnabled(bool) {
    enabled = bool;
    localStorage.setItem('poker_music_enabled', bool ? '1' : '0');
    if (!bool) stop();
    else if (pendingSrc) start();
  }

  // [ADAPTER] BGM 볼륨 설정 — Expo 전환 시 AsyncStorage
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('poker_music_volume', volume);
    if (audio) audio.volume = volume;
  }

  // [REUSE] BGM 활성화 여부
  function isEnabled() { return enabled; }
  // [REUSE] BGM 볼륨 반환
  function getVolume() { return volume; }

  // [ADAPTER] BGM 초기화
  function init(src) {
    loadSettings();
    if (pendingSrc === src && audio && !audio.paused) return;
    stop();
    if (audio) { audio.src = ''; audio = null; }
    pendingSrc = src;
  }

  // [ADAPTER] BGM 재생 — Expo 전환 시 expo-av Audio.Sound
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

  // [ADAPTER] BGM 정지
  function stop() {
    if (audio) { audio.pause(); audio.currentTime = 0; }
  }

  // [ADAPTER] BGM 일시정지
  function pause() {
    if (audio) audio.pause();
  }

  // [ADAPTER] BGM 재개
  function resume() {
    if (enabled && audio && audio.paused) audio.play().catch(() => {});
  }

  return { init, start, stop, pause, resume, setEnabled, setVolume, isEnabled, getVolume, loadSettings };
})();

// =============================================
// EXPO 전환 체크리스트
// Sound 모듈:
// REUSE   : 2개 (N 음계 상수, SELECT_NOTES, isEnabled)
// ADAPTER : 12개 함수 (내부 구현 교체 필요)
//   - getCtx, playTone, playSequence → expo-av
//   - cardSelect, handComplete, cardDrop, dialogTyping → expo-av
//   - stageClear, stageFail → expo-av
//   - setEnabled, setVolume, loadSettings → AsyncStorage
//   - warmup → expo-av
// BGM 모듈:
// REUSE   : 2개 (isEnabled, getVolume)
// ADAPTER : 8개 함수 (내부 구현 교체 필요)
//   - init, start, stop, pause, resume → expo-av Audio.Sound
//   - loadSettings, setEnabled, setVolume → AsyncStorage
// REWRITE : 0개
// =============================================

// ─── Wake Lock ───
// [ADAPTER] Wake Lock — Expo 전환 시 expo-keep-awake의 activateKeepAwake/deactivateKeepAwake로 교체
const WakeLock = (() => {
  let _lock = null;

  async function acquire() {
    if (!('wakeLock' in navigator)) return;
    try {
      _lock = await navigator.wakeLock.request('screen');
    } catch (e) {
      // 배터리 부족 등 실패 시 무시 — 게임 동작에 영향 없음
    }
  }

  function release() {
    if (_lock) {
      _lock.release();
      _lock = null;
    }
  }

  // 탭 전환(백그라운드) 시 자동 해제됐다가 복귀하면 재획득
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _lock === null) {
      acquire();
    }
  });

  return { acquire, release };
})();
