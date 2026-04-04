// =============================================
// [LOGIC] + [ADAPTER] 다국어 모듈
// =============================================

const i18n = (() => {
  // [REUSE] 지원 언어 목록
  const SUPPORTED = [
    'ko','en','ja','zh','zh-TW',
    'es','pt','fr','de','it',
    'ru','ar','hi','th','vi','id'
  ];
  const DEFAULT_LANG = 'en';
  const FALLBACK_LANG = 'ko';

  let current = 'ko';
  let data = {};
  let enData = {};
  let koData = {};

  // [REUSE] 중첩 키 접근
  function getKey(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

  // [REUSE] 문자열 보간
  function interpolate(str, params) {
    if (!params || typeof str !== 'string') return str;
    return str.replace(/\$\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : '${' + k + '}'));
  }

  // [ADAPTER] 언어 JSON 로드 — Expo 전환 시 bundled require 또는 expo-asset
  async function loadLang(lang) {
    try {
      const res = await fetch('./lang/' + lang + '.json');
      if (!res.ok) throw new Error(lang + '.json not found');
      return await res.json();
    } catch (e) {
      console.warn('[i18n] Failed to load ' + lang + '.json:', e.message);
      return null;
    }
  }

  // [ADAPTER] 초기화 — Expo 전환 시 AsyncStorage + bundled JSON
  async function init() {
    const saved = localStorage.getItem('dragon_lang');
    const browserLang = navigator.language;
    const browserCode = SUPPORTED.find(l =>
      browserLang === l || browserLang.startsWith(l + '-')
    );

    current = (saved && SUPPORTED.includes(saved))
      ? saved
      : (browserCode || DEFAULT_LANG);

    koData = await loadLang('ko') || {};
    enData = await loadLang('en') || koData;
    data = (current === 'ko') ? koData
         : (current === 'en') ? enData
         : (await loadLang(current) || enData);

    applyDir();
  }

  // [REWRITE] RTL 방향 적용 — Expo 전환 시 I18nManager
  function applyDir() {
    const dir = (data.meta && data.meta.dir) || 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = current;
  }

  // [REUSE] 번역 키 조회
  function t(path, params) {
    const val = getKey(data, path)
             || getKey(enData, path)
             || getKey(koData, path)
             || path;
    return interpolate(val, params);
  }

  // [REUSE] 필드 번역 (stages/puzzles JSON용)
  function tField(field, params) {
    if (!field) return '';
    if (typeof field === 'string') return interpolate(field, params);
    const val = field[current] || field[DEFAULT_LANG] || field[FALLBACK_LANG] || '';
    return interpolate(val, params);
  }

  // [ADAPTER] 언어 변경 — Expo 전환 시 AsyncStorage + state reload
  async function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    localStorage.setItem('dragon_lang', lang);
    current = lang;
    data = (lang === 'ko') ? koData
         : (lang === 'en') ? enData
         : (await loadLang(lang) || enData);
    applyDir();
    location.reload();
  }

  // [REUSE] 현재 언어 반환
  function getLang() { return current; }
  // [REUSE] 지원 언어 목록 반환
  function getSupported() { return SUPPORTED; }

  return { init, t, tField, setLang, getLang, getSupported };
})();

// =============================================
// EXPO 전환 체크리스트
// REUSE   : 5개 함수 (변경 불필요)
//   - getKey, interpolate, t, tField, getLang, getSupported
// ADAPTER : 3개 함수 (내부 구현 교체 필요)
//   - loadLang → bundled require / expo-asset
//   - init → AsyncStorage + Localization API
//   - setLang → AsyncStorage + state reload
//   - localStorage → AsyncStorage
// REWRITE : 1개 함수 (전면 재작성)
//   - applyDir → I18nManager (RTL)
// =============================================
