const fs = require('fs');

const ko = JSON.parse(fs.readFileSync('./lang/ko.json', 'utf8'));
const langs = ['en','ja','zh','zh-TW','es','pt','fr','de','it','ru','ar','hi','th','vi','id'];

function flattenKeys(obj, prefix) {
  prefix = prefix || '';
  return Object.entries(obj).flatMap(function([k, v]) {
    var key = prefix ? prefix + '.' + k : k;
    return (typeof v === 'object' && !Array.isArray(v))
      ? flattenKeys(v, key)
      : [key];
  });
}

var koKeys = flattenKeys(ko);
var totalMissing = 0;

langs.forEach(function(lang) {
  var filePath = './lang/' + lang + '.json';
  if (!fs.existsSync(filePath)) {
    console.log('[' + lang + '] \u274C file missing (' + koKeys.length + ' keys missing)');
    totalMissing += koKeys.length;
    return;
  }
  var translation = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  var tKeys = flattenKeys(translation);
  var missing = koKeys.filter(function(k) { return !k.startsWith('meta.') && !tKeys.includes(k); });
  if (missing.length === 0) {
    console.log('[' + lang + '] \u2705 complete');
  } else {
    console.log('[' + lang + '] \u26A0\uFE0F  missing ' + missing.length + ':');
    missing.forEach(function(k) { console.log('  - ' + k); });
    totalMissing += missing.length;
  }
});

console.log('\nTotal missing: ' + totalMissing);
