// src/lib/part-staff.js — which staff of a system a voice part sings from.
//
// The practice player boxes the measure that is sounding across the whole
// system. A singer wants their own staff picked out inside it. The map knows
// where each staff of a system sits; this module says which of those staves
// belong to a part, given the labels a human wrote for the system's staves.
//
// Staff labels are short tokens, one string per staff, space-separated when
// a staff carries more than one voice (a closed score):
//
//   "S"  "A"  "T"  "B"      one voice family
//   "S1" "S2" "A1" …        a divisi staff
//   "S A"  "T B"            two families on one staff
//   "Solo"  "Desc"          a solo or descant staff
//   "P"                     piano (never a match for a singer)
//   "-"                     anything else: a bass line, an ossia
//
// A part label is what the season list calls a MIDI track: "Soprano 1",
// "Chorus II Alto", "Tenor Solo", "Soloists". Matching goes from the most
// specific token down: a divisi number ("Soprano 1" → S1), then a solo
// staff for a solo part, then the family. "Soprano 1" lights the S1 staff
// where the page divides the sopranos, and the S staff where it does not.
// "Soprano" lights both S1 and S2. A part with no staff — "Solo" on a score
// whose solo sits on the soprano staff — lights nothing.

const FAMILY = [
  [/sopran|treble|descant/i, 'S'],
  [/alto|mezzo|contralto/i, 'A'],
  [/tenor/i, 'T'],
  [/bass|barit/i, 'B'],
];

/** The tokens a part label answers to, most specific first. */
export function partTokens(label) {
  const s = String(label || '');
  const family = FAMILY.find(([re]) => re.test(s))?.[1] ?? null;
  const div = s.match(/\b([12345])\b|\b(I{1,3}|IV)\b(?!\s+(?:Sopran|Alto|Tenor|Bass))/i);
  // "Chorus II Soprano" is a choir number, not a divisi: the lookahead above
  // refuses a roman numeral that a family word follows. "Soprano 1" and
  // "Soprano II" are divisi.
  let divisi = null;
  if (family && div) {
    const raw = div[1] ?? div[2];
    const n = /^\d$/.test(raw) ? Number(raw) : { I: 1, II: 2, III: 3, IV: 4 }[raw.toUpperCase()];
    if (n) divisi = `${family}${n}`;
  }
  const solo = /solo/i.test(s);
  const out = [];
  if (divisi) out.push(divisi);
  if (solo) out.push('Solo');
  if (family) out.push(family);
  return out;
}

/**
 * Indexes of the staves a part sings from, given the system's staff labels.
 * Empty when nothing matches, or when the labels are missing.
 */
export function stavesFor(partLabel, staffLabels) {
  if (!Array.isArray(staffLabels) || !staffLabels.length) return [];
  const tokens = partTokens(partLabel);
  if (!tokens.length) return [];
  const staffTokens = staffLabels.map(l => String(l || '').split(/\s+/).filter(Boolean));
  const has = (i, t) => staffTokens[i].some(x => x.toLowerCase() === t.toLowerCase());
  // The family is the one-letter token, when the part has one. "Soloists"
  // has none: its only token is Solo, and it must not be taken for a family.
  const family = tokens.find(t => /^[SATB]$/.test(t)) ?? null;
  for (const t of tokens) {
    if (t === family) continue;
    const hits = staffTokens.map((_, i) => i).filter(i => has(i, t));
    if (hits.length) return hits;
  }
  if (!family) return [];
  // Family: a staff labelled S, or any divisi of it (S1, S2).
  return staffTokens.map((_, i) => i).filter(i =>
    staffTokens[i].some(x => x.toUpperCase() === family || new RegExp(`^${family}\\d$`, 'i').test(x)));
}

/** Parts that can ever be highlighted: voices, not the accompaniment. */
export function voiceParts(parts) {
  return (parts || []).filter(p => !/piano|accomp|organ|instrument|orchestra/i.test(p.label));
}
