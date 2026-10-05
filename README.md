# Siskiyou Singers practice player

This is the code for the practice player on the members' pages of [siskiyousingers.org](https://www.siskiyousingers.org). Singers use it to learn their parts: each voice part plays on its own track, with solo, volume, tempo down to 50%, a loop between two measures, a metronome, and the printed score turning its pages as the music plays.

The files are copied out of the choir's website so they can be read on their own. They are not a working app by themselves. They expect the website's layout, styles and members' pages around them, and those are not included.

## The files

| File | What it does |
| --- | --- |
| `src/components/MidiPractice.astro` | The main player. It loads one MIDI file per voice part, plays them through a sampled piano with [Tone.js](https://tonejs.github.io/), draws the note lanes, and handles the loop, tempo, metronome, score view and Download Mix. Most of the logic is in the `<script>` near the bottom of the file. |
| `src/components/AudioPractice.astro` | The same controls for songs we have only as recordings (one audio file per part). It plays through the Web Audio API and slows down without changing pitch with SoundTouch. |
| `src/lib/score-follow.js` | Builds the map of where every measure sits on the printed PDF, so the player can turn pages and box the measure that is sounding. |
| `src/lib/part-staff.js` | Works out which staff in a system belongs to a singer's part, for the "My part" highlight. |
| `src/lib/space-to-play.ts` | The space bar starts and stops the open player. |
| `src/lib/loop-howto.ts` | The card that explains the Loop button the first time a singer uses it. |
| `src/lib/piano-sample-energy.json` | How loud each piano sample is over time. The player uses it to keep a part on Solo or Isolate as loud as the full choir. |

The comments in the code explain why each piece works the way it does, including the bugs singers found and how they were fixed.

## How a song gets into the player

The members' page renders one `MidiPractice` per song and passes it the song's details:

```astro
<MidiPractice
  title="Blow, Blow, Thou Winter Wind"
  composer="Rutter"
  prefix="pp-blowblow"
  basePath="/members/files/MusicFiles/Blow Blow Thou Winter Wind/midi"
  parts={[
    { file: "Soprano 1.mid", label: "Soprano 1" },
    { file: "Alto 1.mid", label: "Alto 1" },
    { file: "Tenor.mid", label: "Tenor" },
    { file: "Bass.mid", label: "Bass" },
  ]}
  sheetPdf="/members/files/sheetmusic/Blow%20Blow%20Thou%20Winter%20Wind%20-%20Rutter.pdf"
  scoreId={20}
/>
```

The player fetches `basePath + "/" + file` for each part when a singer opens it. With a `scoreId`, it also fetches the measure map from `/members/follow/<scoreId>.json`, which the website builds with `score-follow.js` from a reading of the score.

## What is not included

- **The music.** The scores, the MIDI files and the recordings belong to their publishers and to our director, so they stay behind the members' sign-in.
- **The piano sound.** The player uses 30 samples from the [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, licensed CC BY 3.0. The website serves them from `/audio/salamander/`.
- **`soundtouch-processor.js`**, the SoundTouch audio worklet that `AudioPractice` loads from the site root. It comes from [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) under the LGPL.
- **The rest of the website**: the layout, the shared styles in `global.css`, the members' sign-in, and the pages that list the songs.

## Libraries

- [Astro](https://astro.build/) 5
- [tone](https://www.npmjs.com/package/tone) 15.1.22
- [@tonejs/midi](https://www.npmjs.com/package/@tonejs/midi) 2.0.28
- [@soundtouchjs/audio-worklet](https://www.npmjs.com/package/@soundtouchjs/audio-worklet) 2.1.0
- [PDF.js](https://mozilla.github.io/pdf.js/) 3.11.174, loaded from cdnjs for the score view

## Using this code

This repository is shared so people can read the code. It does not grant a license to reuse it. If you want to use part of it, get in touch with the Siskiyou Singers at info@siskiyousingers.org.
