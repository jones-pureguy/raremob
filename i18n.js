const i18n = (() => {
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

  function getKey(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

  function interpolate(str, params) {
    if (!params || typeof str !== 'string') return str;
    return str.replace(/\$\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : '${' + k + '}'));
  }

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

  function applyDir() {
    const dir = (data.meta && data.meta.dir) || 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = current;
  }

  function t(path, params) {
    const val = getKey(data, path)
             || getKey(enData, path)
             || getKey(koData, path)
             || path;
    return interpolate(val, params);
  }

  function tField(field, params) {
    if (!field) return '';
    if (typeof field === 'string') return interpolate(field, params);
    const val = field[current] || field[DEFAULT_LANG] || field[FALLBACK_LANG] || '';
    return interpolate(val, params);
  }

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

  function getLang() { return current; }
  function getSupported() { return SUPPORTED; }

  return { init, t, tField, setLang, getLang, getSupported };
})();
