// Roman → Kannada transliteration for patient names on the lobby board.
//
// Patients are registered in Latin script only, so the Kannada line under each
// name is produced here, by sound, at display time. Nothing is stored.
//
// It is an APPROXIMATION: Roman spelling of Indian names is lossy. "Suresh"
// cannot say whether the u is long, "Rama" whether the final a is sounded, and
// t / d could be dental or retroflex. The rules take the commoner reading.
// It exists to help someone who reads Kannada more comfortably spot their own
// name in the list — not to be an authoritative record. Exact Kannada names
// belong in a field captured at registration.

// Longest first.
const CONSONANTS = [
  ['krishn', 'ಕೃಷ್ಣ'], ['ksh', 'ಕ್ಷ'], ['chh', 'ಛ'], ['shr', 'ಶ್ರ'], ['jn', 'ಜ್ಞ'],
  ['tt', 'ಟ್ಟ'], ['dd', 'ಡ್ಡ'],
  ['kh', 'ಖ'], ['gh', 'ಘ'], ['ch', 'ಚ'], ['jh', 'ಝ'], ['th', 'ತ'], ['dh', 'ಧ'],
  ['ph', 'ಫ'], ['bh', 'ಭ'], ['sh', 'ಶ'], ['ny', 'ಞ'],
  ['k', 'ಕ'], ['g', 'ಗ'], ['c', 'ಕ'], ['j', 'ಜ'], ['t', 'ತ'], ['d', 'ದ'],
  ['n', 'ನ'], ['p', 'ಪ'], ['b', 'ಬ'], ['m', 'ಮ'], ['y', 'ಯ'], ['r', 'ರ'],
  ['l', 'ಲ'], ['v', 'ವ'], ['w', 'ವ'], ['s', 'ಸ'], ['h', 'ಹ'], ['f', 'ಫ'],
  ['z', 'ಜ'], ['x', 'ಕ್ಸ'], ['q', 'ಕ'],
];

// [roman, independent form, matra, short independent, short matra]
const VOWELS = [
  ['aa', 'ಆ', 'ಾ'], ['ai', 'ಐ', 'ೈ'], ['au', 'ಔ', 'ೌ'], ['ow', 'ಔ', 'ೌ'],
  ['ee', 'ಈ', 'ೀ'], ['oo', 'ಊ', 'ೂ'],
  ['a', 'ಅ', ''],   ['i', 'ಇ', 'ಿ'], ['u', 'ಉ', 'ು'],
  ['e', 'ಏ', 'ೇ', 'ಎ', 'ೆ'],  ['o', 'ಓ', 'ೋ', 'ಒ', 'ೊ'],
];

const VIRAMA = '್';
const ANUSVARA = 'ಂ';
// A nasal before one of these, inside a word, is written with the anusvara
// (Sandeep → ಸಂದೀಪ್, Manjunath → ಮಂಜುನಾಥ).
const NASAL_BEFORE = /^(?:kh|gh|ch|jh|th|dh|ph|bh|k|g|c|j|t|d|p|b)/;

const matchAt = (str, i, table) => table.find(([roman]) => str.startsWith(roman, i));

// e / o before a consonant cluster are short (Shetty → ಶೆಟ್ಟಿ, not ಶೇಟ್ಟಿ).
const beforeCluster = (src, i) => {
  const c1 = matchAt(src, i, CONSONANTS);
  if (!c1) return false;
  if (c1[1].includes(VIRAMA)) return true;          // the consonant is itself a conjunct (tt, dd, ksh…)
  return !!matchAt(src, i + c1[0].length, CONSONANTS) && !matchAt(src, i + c1[0].length, VOWELS);
};

function word(w) {
  let src = w.toLowerCase();
  if (src.length > 4 && src.endsWith('nath')) return word(src.slice(0, -4)) + 'ನಾಥ';
  src = src.replace(/([bcdfghjklmnpqrstvwxz])y$/, '$1i').replace(/ao$/, 'av');   // Murthy, Shetty, Reddy → -i

  let out = '';
  let i = 0;
  let prevWasVowelish = false;

  while (i < src.length) {
    if ((src[i] === 'n' || src[i] === 'm') && prevWasVowelish && NASAL_BEFORE.test(src.slice(i + 1))) {
      out += ANUSVARA;
      i += 1;
      continue;
    }

    const cons = matchAt(src, i, CONSONANTS);
    if (cons) {
      out += cons[1];
      i += cons[0].length;
      const vowel = matchAt(src, i, VOWELS);
      if (vowel) {
        const after = i + vowel[0].length;
        const isFinal = after >= src.length;
        if (vowel[0] === 'a') {
          const closedLast = !isFinal && /^[^aeiou]{1,3}$/.test(src.slice(after));
          if (isFinal) out += /th$/.test(cons[0]) ? 'ಾ' : '';      // Kavitha → ಕವಿತಾ; Rama → ರಮ
          else if (closedLast) out += 'ಾ';                          // Kumar → ಕುಮಾರ್, Raj → ರಾಜ್
        } else if (vowel[0] === 'e' && isFinal) {
          out += vowel[4];                                          // Hegde → ಹೆಗ್ಡೆ
        } else if ((vowel[0] === 'e' || vowel[0] === 'o') && beforeCluster(src, after)) {
          out += vowel[4];
        } else {
          out += vowel[2];
        }
        i = after;
        prevWasVowelish = true;
      } else if (i < src.length && matchAt(src, i, CONSONANTS)) {
        out += VIRAMA;
        prevWasVowelish = false;
      } else if (i >= src.length) {
        out += VIRAMA;             // word-final consonant is written pure (Kumar → ಕುಮಾರ್)
        prevWasVowelish = false;
      } else {
        prevWasVowelish = true;
      }
      continue;
    }

    const vowel = matchAt(src, i, VOWELS);
    if (vowel) {
      const after = i + vowel[0].length;
      const short = (vowel[0] === 'e' || vowel[0] === 'o') && beforeCluster(src, after);
      out += short ? vowel[3] : vowel[1];
      i = after;
      prevWasVowelish = true;
      continue;
    }
    i += 1;
  }
  return out;
}

/** "Nirmala D." → "ನಿರ್ಮಲ ಡಿ." — initials and punctuation are kept. */
export function toKannadaName(name) {
  if (!name) return '';
  return String(name)
    .split(/\s+/)
    .map((part) => {
      const trailing = part.endsWith('.') ? '.' : '';
      const core = trailing ? part.slice(0, -1) : part;
      if (!/[a-z]/i.test(core)) return part;
      if (core.length === 1) return part;   // initials stay Latin
      return word(core) + trailing;
    })
    .join(' ');
}
