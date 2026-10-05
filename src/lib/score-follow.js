// src/lib/score-follow.js — where every measure sits on the printed page.
//
// The practice player turns pages and highlights the measure that is sounding.
// To do that it needs, for each printed measure number, the PDF page it is on
// and a rectangle on that page. This module builds that map from what the
// score reader already stores:
//
//   - The MusicXML from Audiveris. Every measure carries a `width` in tenths,
//     every system start carries its left margin, and <print new-page> /
//     <print new-system> say where the pages and the lines break. Laid end to
//     end, those widths land on the printed barlines (checked against
//     A Christmas Carol, page 4, 2026-09-16).
//   - staves.json from the reader: the pixel rows of every staff on every page.
//     Audiveris does not export where a staff sits vertically, so the
//     horizontal map comes from the MusicXML and the vertical map from the
//     staff detector, and this module joins them.
//
// Everything is emitted as a FRACTION of the page (0..1), so the player can
// scale it onto a canvas of any size without knowing what the reader's render
// resolution was.
//
// The same MusicXML, when the reader ran with OCR on, carries the lyrics, one
// syllable per note. They are extracted here too, with a measure and a beat
// each, so the player can print the words while the score is hidden.
//
// Pure functions over a parsed DOM. Node callers parse with @xmldom/xmldom;
// the browser has DOMParser. Nothing here touches the network or the database.

const el = (parent, tag) => Array.from(parent.childNodes ?? [])
  .filter(n => n.nodeType === 1 && n.tagName === tag);
const first = (parent, tag) => el(parent, tag)[0] ?? null;
const text = (node) => (node?.textContent ?? '').trim();
const num = (node) => { const v = parseFloat(text(node)); return Number.isFinite(v) ? v : null; };

/**
 * A measure's number as the page prints it.
 *
 * Audiveris writes the number as a string. A bar that the page does not
 * number — a pickup, or the second half of a bar split across a system break
 * — comes out as "X1" / "X5". `n` is the digits; `unnumbered` says the X was
 * there. The caller decides what an unnumbered bar means from its position.
 */
export function parseMeasureNumber(raw) {
  const s = String(raw ?? '').trim();
  const digits = s.replace(/[^0-9]/g, '');
  return { n: digits ? Number(digits) : null, unnumbered: /[^0-9]/.test(s) };
}

/** Deepest child text at a path, e.g. deep(print, ['system-layout','system-margins','left-margin']). */
function deep(node, path) {
  let cur = node;
  for (const tag of path) { if (!cur) return null; cur = first(cur, tag); }
  return cur;
}

/**
 * Group a page's staves into `count` systems by cutting at the widest gaps.
 *
 * The reader's own grouping is not trustworthy (a lone staff often comes back
 * as a system of its own), but the number of systems on a page IS known, from
 * the MusicXML. With that count, the gaps between consecutive staves tell the
 * rest: the space between two systems is wider than the space between two
 * staves of one system, because the lyrics of the bottom voice and the
 * dynamics of the next system both live in it. Checked on every page of
 * A Christmas Carol, where the closest call was 108 px between systems against
 * 97 px between the two piano staves.
 *
 * Returns `count` groups of [top, bottom] staff pairs, or null when the page
 * has fewer staves than systems, which means the detector missed a line and
 * nothing sensible can be said.
 */
export function groupStavesIntoSystems(staves, count, preferredSize = null) {
  const sorted = staves.map(s => [s[0], s[1]]).sort((a, b) => a[0] - b[0]);
  if (!count || sorted.length < count) return null;
  if (count === 1) return [sorted];
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push({ i, gap: sorted[i][0] - sorted[i - 1][1] });
  const cutAt = (cuts) => {
    const groups = [];
    let start = 0;
    for (const c of cuts) { groups.push(sorted.slice(start, c)); start = c; }
    groups.push(sorted.slice(start));
    return groups;
  };
  const byGap = cutAt(gaps.slice().sort((a, b) => b.gap - a.gap).slice(0, count - 1).map(g => g.i).sort((a, b) => a - b));
  // When every system on the page has the same number of staves — which is
  // what the rest of the score says, or what the count divides into — an
  // equal split is the shape to expect, and the gaps only have to agree
  // roughly. A page whose choir-to-piano gap beats its system gap (lyrics
  // under the basses) otherwise comes out as 1+13 instead of 7+7.
  const size = preferredSize && preferredSize * count === sorted.length
    ? preferredSize
    : (sorted.length % count === 0 ? sorted.length / count : null);
  if (size) {
    const cuts = Array.from({ length: count - 1 }, (_, k) => (k + 1) * size);
    const equal = cutAt(cuts);
    const boundary = cuts.map(c => gaps[c - 1].gap);
    const widest = Math.max(...gaps.map(g => g.gap));
    const sizesEqual = byGap.every(g => g.length === size);
    if (sizesEqual) return byGap;
    if (Math.min(...boundary) >= 0.6 * widest || preferredSize === size) return equal;
  }
  return byGap;
}

/**
 * The page rectangle of a group of staves, padded by half a staff above and
 * below so the box clears the dynamics and the lyrics rather than cutting
 * through them. In pixels of the detector's image.
 */
function systemBand(group, imageHeight) {
  const top = group[0][0], bottom = group[group.length - 1][1];
  const avgStaff = group.reduce((a, s) => a + (s[1] - s[0]), 0) / group.length;
  const pad = avgStaff * 0.5;
  return {
    y0: Math.max(0, top - pad) / imageHeight,
    y1: Math.min(imageHeight, bottom + pad) / imageHeight,
  };
}

/**
 * Walk the score once and return one record per measure column, in order:
 * page and system indexes, the measure's number, and its horizontal span in
 * tenths. Layout attributes are read from whichever part carries them, because
 * a part that rests through a system may have no width on its measures and no
 * margins on its <print>.
 */
function walkColumns(doc) {
  const root = doc.documentElement;
  const defaults = first(root, 'defaults');
  const layout = defaults ? first(defaults, 'page-layout') : null;
  const pageW = num(layout && first(layout, 'page-width'));
  const pageH = num(layout && first(layout, 'page-height'));
  const margins = layout ? el(layout, 'page-margins') : [];
  const marg = margins.find(m => (m.getAttribute('type') || 'both') === 'both') ?? margins[0] ?? null;
  const leftMargin = num(marg && first(marg, 'left-margin')) ?? 0;
  const rightMargin = num(marg && first(marg, 'right-margin')) ?? 0;

  const parts = el(root, 'part');
  if (!parts.length || !pageW || !pageH) return null;
  const perPart = parts.map(p => el(p, 'measure'));
  // The first part leads, as it does in pages_json, so the two agree on
  // where the pages break. Parts line up by index in an Audiveris export;
  // when they do not (one part lost a bar), fall back to matching by number.
  const lead = perPart[0];
  const aligned = perPart.every(ms => ms.length === lead.length);
  const byNumber = aligned ? null : perPart.map(ms => new Map(ms.map(m => [m.getAttribute('number'), m])));

  const cols = [];
  let page = -1, system = -1;
  // How many staves each part prints. <staves> is stated once, at the start,
  // and holds until it is stated again.
  const stavesOf = perPart.map(() => 1);
  for (let i = 0; i < lead.length; i++) {
    const siblings = aligned
      ? perPart.map(ms => ms[i])
      : byNumber.map(map => map.get(lead[i].getAttribute('number')) ?? null);
    let newPage = false, newSystem = false, width = null, sysLeft = null, sysRight = null;
    // Staves the engraver printed on this system: every part's staves, less
    // the ones Audiveris marks <staff-details print-object="no"> (a part that
    // rests through a whole system and is left off the page). Only meaningful
    // on the first measure of a system, which is where it is read.
    let expectedStaves = 0;
    siblings.forEach((m, p) => {
      if (!m) return;
      const attrs = first(m, 'attributes');
      const declared = attrs ? num(first(attrs, 'staves')) : null;
      if (declared) stavesOf[p] = declared;
      let hidden = 0;
      for (const sd of attrs ? el(attrs, 'staff-details') : []) {
        if (sd.getAttribute('print-object') !== 'no') continue;
        hidden += sd.getAttribute('number') ? 1 : stavesOf[p];
      }
      expectedStaves += Math.max(0, stavesOf[p] - Math.min(hidden, stavesOf[p]));
    });
    // Where the music starts inside the measure, in the engraver's units,
    // measured across every part so a part that rests does not decide it.
    // A measure that opens a system reserves room for the clef and key before
    // its first note (about 60 units on O Nata Lux) where a mid-system measure
    // reserves about 14. That difference is what placeColumns insets below.
    // A whole-measure rest is skipped: the engraver centres it, so its
    // default-x says where the middle of the bar is, not where music begins.
    let musicX = null;
    for (const m of siblings) {
      if (!m) continue;
      for (const n of el(m, 'note')) {
        const r = first(n, 'rest');
        if (r && r.getAttribute('measure') === 'yes') continue;
        const dx = parseFloat(n.getAttribute('default-x'));
        if (Number.isFinite(dx) && (musicX === null || dx < musicX)) musicX = dx;
      }
    }
    for (const m of siblings) {
      if (!m) continue;
      const w = parseFloat(m.getAttribute('width'));
      if (width === null && Number.isFinite(w)) width = w;
      for (const pr of el(m, 'print')) {
        if (pr.getAttribute('new-page') === 'yes') newPage = true;
        if (pr.getAttribute('new-system') === 'yes') newSystem = true;
        const l = num(deep(pr, ['system-layout', 'system-margins', 'left-margin']));
        const r = num(deep(pr, ['system-layout', 'system-margins', 'right-margin']));
        if (sysLeft === null && l !== null) sysLeft = l;
        if (sysRight === null && r !== null) sysRight = r;
      }
    }
    if (i === 0 || newPage) { page++; system = 0; }
    else if (newSystem) system++;
    const startsSystem = i === 0 || newPage || newSystem;
    cols.push({
      i, page, system, startsSystem,
      raw: lead[i].getAttribute('number'),
      ...parseMeasureNumber(lead[i].getAttribute('number')),
      width, sysLeft, sysRight, expectedStaves, musicX,
    });
  }
  return { cols, pageW, pageH, leftMargin, rightMargin, aligned, partCounts: perPart.map(ms => ms.length) };
}

/**
 * How long a measure lasts, in divisions: the furthest any voice of any part
 * reaches inside it, tracked through <backup> and <forward>.
 */
function measureLength(measuresAcrossParts) {
  let best = 0;
  for (const m of measuresAcrossParts) {
    if (!m) continue;
    let pos = 0, max = 0;
    for (const child of Array.from(m.childNodes)) {
      if (child.nodeType !== 1) continue;
      const dur = num(first(child, 'duration')) ?? 0;
      if (child.tagName === 'backup') pos -= dur;
      else if (child.tagName === 'forward') pos += dur;
      else if (child.tagName === 'note' && !first(child, 'chord') && !first(child, 'grace')) pos += dur;
      if (pos > max) max = pos;
    }
    if (max > best) best = max;
  }
  return best;
}

/**
 * Does the score open with a pickup bar that the reader numbered "1"?
 *
 * The page does not number a pickup; it calls the bar after it measure 1, and
 * so does the player (the pickup is 0). Audiveris sometimes writes the pickup
 * as "X1" or "0", which parseMeasureNumber handles, and sometimes as a plain
 * "1", which shifts every number on the page by one. The tell is the length:
 * a pickup is shorter than the full bar that follows it. Same test the player
 * applies to the MIDI.
 */
export function detectNumberedPickup(doc) {
  const parts = el(doc.documentElement, 'part');
  const perPart = parts.map(p => el(p, 'measure'));
  if (!perPart.length || perPart[0].length < 3) return false;
  const firstNum = parseMeasureNumber(perPart[0][0].getAttribute('number'));
  if (firstNum.unnumbered || firstNum.n !== 1) return false;
  const len = (i) => measureLength(perPart.map(ms => ms[i]));
  const a = len(0), b = len(1), c = len(2);
  return a > 0 && b > 0 && a < b * 0.9 && Math.abs(b - c) <= b * 0.1;
}

/**
 * Lay the columns of each system end to end. A measure with no width (every
 * part rested and Audiveris left it off) takes an equal share of whatever the
 * system has left between its known measures and its right margin.
 */
function placeColumns(walk) {
  const { cols, pageW, leftMargin, rightMargin } = walk;

  // How far into a measure the music starts when nothing is in its way, taken
  // as the median over every measure that does NOT open a system. A measure
  // that does open one has the clef and key in front of its first note, and
  // the difference is the width of that furniture.
  //
  // Without this the first box of every system began at the staff's left edge
  // and covered the clef. The box was on the right bar, but it did not look
  // like it: a singer reads the first mark as sitting on the clef and counts
  // every later one a bar early (Howie, 2026-09-18, on O Nata Lux). Only the
  // left edge moves. The right edge is a printed barline and stays put, and no
  // other box on the system shifts at all.
  const inner = cols.filter(c => !c.startsSystem && c.musicX !== null)
                    .map(c => c.musicX)
                    .sort((a, b) => a - b);
  const baseMusicX = inner.length ? inner[inner.length >> 1] : null;

  const systems = new Map(); // `${page}/${system}` -> cols
  for (const c of cols) {
    const key = `${c.page}/${c.system}`;
    if (!systems.has(key)) systems.set(key, []);
    systems.get(key).push(c);
  }
  for (const group of systems.values()) {
    const head = group[0];
    const x0 = leftMargin + (head.sysLeft ?? 0);
    const xEnd = pageW - rightMargin - (head.sysRight ?? 0);
    const known = group.reduce((a, c) => a + (c.width ?? 0), 0);
    const unknown = group.filter(c => c.width === null).length;
    const share = unknown ? Math.max(0, xEnd - x0 - known) / unknown : 0;
    // Never more than half the bar, so a bad reading cannot swallow the music.
    const headW = head.width ?? share;
    const lead = (baseMusicX !== null && head.musicX !== null)
      ? Math.max(0, Math.min(head.musicX - baseMusicX, headW * 0.5))
      : 0;

    let x = x0;
    for (const c of group) {
      const w = c.width ?? share;
      c.x0 = (x + (c === head ? lead : 0)) / pageW;
      c.x1 = (x + w) / pageW;
      c.estimated = c.width === null;
      x += w;
    }
  }
  return systems;
}

/**
 * The lyrics of every part, one syllable per note, with the printed measure
 * number and the beat (in quarter notes, 1-based) where the syllable falls.
 *
 * Positions come from the durations, tracked through <backup> and <forward>,
 * so a second voice in the same staff does not push the words along. A chord
 * member shares its head's position. Only the first lyric line (`number="1"`,
 * or the first present) is taken: a second verse under the same notes is
 * stored by the engraver as a second line, and the player shows one.
 */
export function extractLyrics(doc, shift = 0) {
  const root = doc.documentElement;
  const names = new Map();
  const partList = first(root, 'part-list');
  for (const sp of partList ? el(partList, 'score-part') : []) {
    names.set(sp.getAttribute('id'), text(first(sp, 'part-name')));
  }
  const out = [];
  el(root, 'part').forEach((part, idx) => {
    let divisions = 1;
    const syllables = [];
    const measures = el(part, 'measure');
    measures.forEach((m, mi) => {
      const parsed = parseMeasureNumber(m.getAttribute('number'));
      // A leading unnumbered bar is the pickup, which the player calls 0.
      // An unnumbered bar later on is the tail of the bar before it.
      let mNum = parsed.n === null ? mi + 1 : parsed.n - shift;
      if (parsed.unnumbered) mNum = mi === 0 ? 0 : (syllables.length ? syllables[syllables.length - 1].m : mNum);
      let pos = 0;
      for (const child of Array.from(m.childNodes)) {
        if (child.nodeType !== 1) continue;
        const tag = child.tagName;
        if (tag === 'attributes') {
          const d = num(first(child, 'divisions'));
          if (d) divisions = d;
        } else if (tag === 'backup') {
          pos -= num(first(child, 'duration')) ?? 0;
        } else if (tag === 'forward') {
          pos += num(first(child, 'duration')) ?? 0;
        } else if (tag === 'note') {
          const isChord = !!first(child, 'chord');
          const isGrace = !!first(child, 'grace');
          const dur = num(first(child, 'duration')) ?? 0;
          const lyrics = el(child, 'lyric');
          const lyric = lyrics.find(l => (l.getAttribute('number') || '1') === '1') ?? lyrics[0];
          if (lyric) {
            const t = text(first(lyric, 'text'));
            if (t) {
              syllables.push({
                m: mNum,
                beat: Math.round((1 + pos / divisions) * 1000) / 1000,
                text: t,
                syllabic: text(first(lyric, 'syllabic')) || 'single',
              });
            }
          }
          if (!isChord && !isGrace) pos += dur;
        }
      }
    });
    if (syllables.length) {
      out.push({ id: part.getAttribute('id'), name: names.get(part.getAttribute('id')) || '', index: idx, syllables });
    }
  });
  return out;
}

/**
 * One line of words from every part's syllables.
 *
 * A choir sings the same text in every voice, and the reader drops syllables
 * unevenly: on A Christmas Carol the fullest voice carried words in 36
 * measures of 61, and all four voices together in 46. So the fullest voice is
 * the spine, and a measure it has no words for is filled, whole, from the
 * next voice that does. Whole measures, not syllables: the reader's rhythms
 * differ from voice to voice, and interleaving two voices by beat read
 * "hair like-was" for a bar that prints "hair was like".
 */
export function mergeLyrics(parts) {
  const ordered = parts.slice().sort((a, b) => b.syllables.length - a.syllables.length);
  const byMeasure = new Map();
  for (const p of ordered) {
    const mine = new Map();
    for (const s of p.syllables) (mine.get(s.m) ?? mine.set(s.m, []).get(s.m)).push(s);
    for (const [m, list] of mine) if (!byMeasure.has(m)) byMeasure.set(m, list);
  }
  return [...byMeasure.values()].flat()
    .map(s => ({ m: s.m, beat: s.beat, text: s.text, syllabic: s.syllabic }))
    .sort((a, b) => (a.m - b.m) || (a.beat - b.beat));
}

/**
 * Join a measure's syllables the way the page prints them: a hyphen after a
 * syllable that continues into the next ("Ma-ry's"), a space after a word.
 * A word that runs across the barline ends the measure with a hyphen.
 */
export function joinSyllables(syllables) {
  let s = '';
  for (const sy of syllables) {
    const cont = sy.syllabic === 'begin' || sy.syllabic === 'middle';
    s += sy.text + (cont ? '-' : ' ');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Build the follow map.
 *
 *   doc        the score's MusicXML, parsed
 *   stavesAlt  a second staves.json (the reader's, when `staves` is our own
 *              detection). Per page, whichever source holds a staff count that
 *              fits the systems on that page is used.
 *   staves     staves.json from the reader: {render_dpi, pages:[{page, image_width,
 *              image_height, systems:[{staves:[{top,bottom}]}]}]}. Optional; without
 *              it every measure gets its horizontal span and no vertical one.
 *   pagesJson  pages_json from the reader, to translate the MusicXML's page
 *              order into PDF page indexes when the two differ. Optional.
 *   lyricsDoc  a MusicXML to take the words from, when the score's own has none
 *              (the season's rows were read before the reader had OCR data).
 *
 * Returns:
 *   {
 *     version: 1,
 *     firstMeasure, lastMeasure, measureCount,
 *     pages: [{ pdfPage, systems: [{ y0, y1, first, last, staffCount, expectedStaves, quality }] }],
 *     measures: { "19": [{ pdfPage, system, x0, x1, y0, y1, doubt? }], ... },
 *     lyrics: { parts: [{ id, name, syllables }], defaultPart,
 *               merged: [{ m, beat, text, syllabic }], measuresWithWords, coverage } | null,
 *     notes: [ ...diagnostic strings ],
 *   }
 * Coordinates are fractions of the page. A measure maps to a LIST of boxes,
 * because a bar split across a system break has two. y0/y1 are null when the
 * page's staves could not be grouped.
 */
export function buildFollow({ doc, staves = null, stavesAlt = null, pagesJson = null, lyricsDoc = null }) {
  const notes = [];
  const walk = walkColumns(doc);
  if (!walk) return { version: 1, pages: [], measures: {}, lyrics: null, notes: ['no parts or no page layout in the MusicXML'] };
  placeColumns(walk);
  const { cols } = walk;
  if (!walk.aligned) notes.push(`parts hold different measure counts (${walk.partCounts.join(', ')}); matched by number`);
  // A pickup the reader numbered "1" puts every number one high. Take it
  // back down so the keys are the numbers the page (and the player) use.
  const shift = detectNumberedPickup(doc) ? 1 : 0;
  if (shift) notes.push('the first bar is a pickup numbered 1 in the MusicXML; numbers shifted down by one');

  // Systems per page, with their measure ranges.
  const pageMap = new Map();
  for (const c of cols) {
    if (!pageMap.has(c.page)) pageMap.set(c.page, []);
    const systems = pageMap.get(c.page);
    if (c.startsSystem) systems.push({ first: c, last: c, cols: [c] });
    else { const s = systems[systems.length - 1]; s.last = c; s.cols.push(c); }
  }

  const pageOf = (src, pdfPage) => src?.pages?.find(p => p.page === pdfPage) ?? null;
  const flatten = (sp) => (sp ? sp.systems.flatMap(sy => sy.staves.map(st => [st.top, st.bottom])) : []);
  // The second source is only comparable when it describes the same PDF. The
  // reader's staves.json for Silent Night was made from a copy without the
  // two pages of notes at the front, and put staves on a page of prose.
  const altOk = !!(stavesAlt?.pages && staves?.pages && stavesAlt.pages.length === staves.pages.length);

  // MusicXML page k → PDF page. pages_json is built from the same page breaks,
  // so its k-th entry names the PDF page of the k-th MusicXML page — when the
  // PDF has music on every page. When it opens with a cover or a page of
  // notes, the pages that carry staves are the music pages, and if there are
  // exactly as many of them as the MusicXML has pages, they are the map.
  let pdfPageOf = (k) => pagesJson?.pages?.[k]?.pdf_page ?? k;
  if (staves?.pages) {
    const musicPages = staves.pages.filter(p => flatten(p).length > 0).map(p => p.page);
    if (musicPages.length === pageMap.size && musicPages.length !== staves.pages.length) {
      const differs = [...pageMap.keys()].some((k, i) => (pagesJson?.pages?.[k]?.pdf_page ?? k) !== musicPages[i]);
      if (differs) {
        notes.push(`PDF has ${staves.pages.length} pages and ${musicPages.length} with music; pages mapped onto the music pages` +
          ` (pages_json says otherwise)`);
        pdfPageOf = (k) => musicPages[k] ?? k;
      }
    }
  }

  // The usual number of staves in a system, from the pages whose staff count
  // divides evenly: the hint the grouper uses on the pages that do not.
  const sizeVotes = new Map();
  for (const [k, systems] of pageMap) {
    const pdfPage = pdfPageOf(k);
    for (const src of [staves, altOk ? stavesAlt : null]) {
      const n = flatten(pageOf(src, pdfPage)).length;
      if (n && n % systems.length === 0) {
        const size = n / systems.length;
        sizeVotes.set(size, (sizeVotes.get(size) ?? 0) + 1);
      }
    }
  }
  const preferredSize = sizeVotes.size
    ? [...sizeVotes.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;
  if (preferredSize) notes.push(`systems usually hold ${preferredSize} staves`);

  const pages = [];
  for (const [k, systems] of pageMap) {
    const pdfPage = pdfPageOf(k);
    // Two sources for the staff rows: prefer the one whose count fits the
    // page (the usual staves-per-system times the systems here); otherwise
    // the primary, when it found anything at all.
    const expected = systems.map(s => s.first.expectedStaves || 0);
    const expectedTotal = expected.reduce((a, b) => a + b, 0);
    const fits = (sp) => {
      const n = flatten(sp).length;
      return n > 0 && (n === expectedTotal || (preferredSize && n === preferredSize * systems.length));
    };
    const a = pageOf(staves, pdfPage), b = altOk ? pageOf(stavesAlt, pdfPage) : null;
    let sp = a;
    if ((!fits(a) && fits(b)) || (!flatten(a).length && flatten(b).length)) {
      sp = b;
      notes.push(`page ${pdfPage + 1}: staff rows taken from the second source`);
    }
    const flat = flatten(sp);
    // Three ways to cut the page's staves into its systems, best first:
    //   1. the MusicXML says how many staves each system prints, and the
    //      detector found exactly that many — cut by those counts;
    //   2. the gap heuristic, trusted when it yields equal-sized systems;
    //   3. the gap heuristic anyway, marked doubtful. The player shows no
    //      box on a doubtful page, but still knows which page it is.
    let groups = null, quality = 'none';
    if (sp && flat.length && expectedTotal === flat.length && expected.every(n => n > 0)) {
      const sorted = flat.slice().sort((x, y) => x[0] - y[0]);
      groups = []; let at = 0;
      for (const n of expected) { groups.push(sorted.slice(at, at + n)); at += n; }
      quality = 'ok';
    } else if (sp) {
      groups = groupStavesIntoSystems(flat, systems.length, preferredSize);
      if (groups) {
        const sizes = groups.map(g => g.length);
        const even = sizes.every(n => n === sizes[0]);
        quality = even || systems.length === 1 ? 'ok' : 'doubt';
      }
    }
    if (sp && !groups) notes.push(`page ${pdfPage + 1}: ${flat.length} staves for ${systems.length} systems, no vertical map`);
    if (!sp) notes.push(`page ${pdfPage + 1}: no staff rows, no vertical map`);
    if (quality === 'doubt') notes.push(`page ${pdfPage + 1}: ${flat.length} staves cut as ${groups.map(g => g.length).join('+')}` +
      ` (MusicXML expects ${expected.join('+')}) — doubtful, no box shown there`);
    const out = systems.map((s, j) => {
      const band = groups ? systemBand(groups[j], sp.image_height) : { y0: null, y1: null };
      for (const c of s.cols) { c.pdfPage = pdfPage; c.y0 = band.y0; c.y1 = band.y1; c.doubt = quality !== 'ok'; }
      return {
        y0: band.y0, y1: band.y1,
        first: s.first.n === null ? null : s.first.n - shift, last: s.last.n === null ? null : s.last.n - shift,
        staffCount: groups ? groups[j].length : null,
        expectedStaves: expected[j] || null,
        quality,
      };
    });
    pages.push({ pdfPage, systems: out });
  }

  // Number the columns. The first bar of the piece, if unnumbered, is the
  // pickup and is called 0 (the player does the same). A later unnumbered bar
  // is the second half of the bar before it and joins that bar's boxes.
  const measures = {};
  let prevN = null;
  cols.forEach((c, i) => {
    let n = c.n === null ? null : c.n - shift;
    if (c.unnumbered || n === null) n = (i === 0) ? 0 : prevN;
    if (n === null) n = i + 1;
    (measures[n] ||= []).push({
      pdfPage: c.pdfPage, system: c.system,
      x0: round(c.x0), x1: round(c.x1), y0: round(c.y0), y1: round(c.y1),
      ...(c.estimated ? { estimated: true } : {}),
      ...(c.doubt ? { doubt: true } : {}),
    });
    prevN = n;
  });
  const keys = Object.keys(measures).map(Number).sort((a, b) => a - b);
  const doubtful = Object.values(measures).flat().filter(b => b.doubt).length;
  if (doubtful) notes.push(`${doubtful} of ${cols.length} measure boxes are on doubtful pages`);
  const estimated = cols.filter(c => c.estimated).length;
  if (estimated) notes.push(`${estimated} measure widths estimated (no part carried a width)`);
  const split = Object.values(measures).filter(b => b.length > 1).length;
  if (split) notes.push(`${split} measures span a system break`);

  // Lyrics: from the score itself when it has them, else from the OCR read.
  let lyrics = null;
  const own = extractLyrics(doc, shift);
  const source = own.length ? own : (lyricsDoc ? extractLyrics(lyricsDoc, detectNumberedPickup(lyricsDoc) ? 1 : 0) : []);
  if (source.length) {
    const best = source.reduce((a, b) => (b.syllables.length > a.syllables.length ? b : a));
    const merged = mergeLyrics(source);
    const withWords = new Set(merged.map(s => s.m)).size;
    const coverage = Math.round((withWords / Math.max(1, keys.length)) * 100) / 100;
    lyrics = { parts: source, defaultPart: source.indexOf(best), merged, measuresWithWords: withWords, coverage };
    notes.push(`lyrics: ${source.length} part(s), ${best.syllables.length} syllables on the fullest, ` +
      `${merged.length} merged; words in ${withWords} of ${keys.length} measures (${Math.round(coverage * 100)}%)` +
      (own.length ? '' : ' (from the OCR read)'));
  }

  return {
    version: 1,
    // The player checks these against the MIDI before it follows anything: a
    // map with a different measure count than the file describes a different
    // piece, and a box in the wrong bar is worse than no box.
    firstMeasure: keys[0] ?? null,
    lastMeasure: keys[keys.length - 1] ?? null,
    measureCount: keys.length,
    pages, measures, lyrics, notes,
  };
}

const round = v => (v === null || v === undefined ? null : Math.round(v * 10000) / 10000);
