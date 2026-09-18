// Roman → Devanagari transliteration for patient names on the lobby board.
//
// There is no Hindi name anywhere in the database — patients are registered in
// Latin script only — so the Hindi line under each name is produced here, by
// sound, at display time. Nothing is stored.
//
// It is an APPROXIMATION and cannot be otherwise: Roman spelling of Indian
// names is lossy in both directions. "Puja" gives no way to know whether the
// u is short or long (पुजा vs पूजा), and a trailing "a" may be a full ā
// (Nirmala → निर्मला) or a silent schwa (Deependra → दीपेंद्र). The rules
// below take the commoner reading in each case.
//
// It exists to help someone who reads Devanagari more comfortably find their
// own name in a list they already expect to see themselves in — not to be an
// authoritative record. If exact Hindi names matter, they belong in a field
// captured at registration, where a human types what is correct.

// Longest first: 'chh' must be tried before 'ch', 'ch' before 'c'.
const CONSONANTS = [
  ['chh', 'छ'], ['shr', 'श्र'],
  ['kh', 'ख'], ['gh', 'घ'], ['ch', 'च'], ['jh', 'झ'], ['th', 'थ'], ['dh', 'ध'],
  ['ph', 'फ'], ['bh', 'भ'], ['sh', 'श'], ['ng', 'ं'], ['ny', 'ञ'],
  ['k', 'क'], ['g', 'ग'], ['c', 'च'], ['j', 'ज'], ['t', 'त'], ['d', 'द'],
  ['n', 'न'], ['p', 'प'], ['b', 'ब'], ['m', 'म'], ['y', 'य'], ['r', 'र'],
  ['l', 'ल'], ['v', 'व'], ['w', 'व'], ['s', 'स'], ['h', 'ह'], ['f', 'फ'],
  ['z', 'ज़'], ['x', 'क्स'], ['q', 'क'],
];

// [roman, independent form, matra]
const VOWELS = [
  ['aa', 'आ', 'ा'], ['ai', 'ऐ', 'ै'], ['au', 'औ', 'ौ'],
  ['ee', 'ई', 'ी'], ['oo', 'ऊ', 'ू'],
  ['a', 'अ', ''],   ['i', 'इ', 'ि'], ['u', 'उ', 'ु'],
  ['e', 'ए', 'े'],  ['o', 'ओ', 'ो'],
];

const VIRAMA = '्';

const matchAt = (str, i, table) => table.find(([roman]) => str.startsWith(roman, i));

function word(w) {
  const src = w.toLowerCase();
  let out = '';
  let i = 0;
  let inCluster = false;   // did a virama immediately precede this consonant?

  while (i < src.length) {
    const cons = matchAt(src, i, CONSONANTS);

    if (cons) {
      const clustered = inCluster;
      inCluster = false;
      out += cons[1];
      i += cons[0].length;

      const vowel = matchAt(src, i, VOWELS);
      if (vowel) {
        const isFinal = i + vowel[0].length >= src.length;

        // A trailing "a" is ā after a plain consonant (Nirmala → निर्मला) but
        // a silent schwa after a cluster (Deependra → दीपेंद्र, not दीपेंद्रा).
        if (vowel[0] === 'a' && isFinal) {
          out += clustered ? '' : 'ा';
        // Indian names ending in "-i" carry the long ī: Devi → देवी, not देवि.
        } else if (vowel[0] === 'i' && isFinal) {
          out += 'ी';
        } else {
          out += vowel[2];
        }
        i += vowel[0].length;
      } else if (i < src.length) {
        // Consonant cluster: suppress the implicit vowel between them.
        out += VIRAMA;
        inCluster = true;
      }
      continue;
    }

    const vowel = matchAt(src, i, VOWELS);
    if (vowel) {           // word-initial vowel takes its independent form
      out += vowel[1];
      i += vowel[0].length;
      continue;
    }

    i += 1;                // punctuation, digits, anything unmapped
  }
  return out;
}

/** "Nirmala D." → "निर्मला डी." — initials and punctuation are kept. */
export function toHindiName(name) {
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
