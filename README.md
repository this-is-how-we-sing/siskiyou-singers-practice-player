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

## How the player works with the libraries

None of the libraries is modified. The site installs them from npm as they are, with no patches and no overridden functions. Each one does its own job well, and the player's code fills the gaps between what a library does and what a choir rehearsal needs. The names below are functions and variables you can search for in the files.

### Tone.js (`MidiPractice.astro`)

- **One piano for the whole page.** A `Tone.Sampler` normally loads and decodes its own samples. With one sampler per voice part, a nine-part song held about 1.4 GB of decoded piano, and phones ran out of memory. `sharedPiano()` decodes the 30 samples once with `ToneAudioBuffers`, and every sampler on the page, plus every Download Mix, shares those buffers.
- **One Transport, many songs.** `Tone.Transport` is a single global, and the members' page has a player for every song. `activateTransport()` gives the Transport to the player that opens, and schedules that song's tempo changes and end point on it. `releaseTransport()` clears them again when the player closes, so two songs never play on top of each other.
- **Starting the sound inside the click.** Safari only lets a page start audio from code that runs during the click itself, before any `await`. `unlockAudio()` calls `Tone.start()` without waiting for it, and a `pointerdown` listener starts downloading Tone.js before the click finishes.
- **Safari putting the sound to sleep.** Safari has its own `interrupted` audio state, which is not in the Web Audio standard and which a page reload does not clear. `watchAudioState()` listens for state changes, stops the player claiming to play, and tells the singer what to do.
- **A rounding error in Tone's tick math.** Reading the Transport position just after `Transport.stop()` can return a tiny negative number, such as -2.6e-12, which Tone's own range check rejects. `activateTransport()` restarts each part at an explicit time of 0, and not at the "now" that `stop()` implies.
- **Solo that stays as loud as the full choir.** Turning the other parts down makes the whole mix quieter. `focusGain()` uses the measured loudness of each sample in `piano-sample-energy.json` to work out how much to raise the soloed part so the mix stays at the same loudness, up to `FOCUS_MAX` so it never clips.
- **Download Mix.** `Tone.Offline` renders the same notes at the same settings into an MP3, at a fixed 44.1 kHz because the MP3 encoder does not accept the 96 kHz some Macs use. `Tone.Offline` swaps the global audio context while it works, so the player pauses live playback first.

### @tonejs/midi (`MidiPractice.astro`)

- **Printed measure numbers.** The MIDI files write every repeat out in full, so bar 137 of a file can be measure 113 on the page. The `repeats` list for a song builds `printedOf` and the arrays next to it, which translate between the bar that is playing and the measure the singer sees.
- **Pickup bars.** Some files start with a pickup that the printed score does not number. A song marked `pickup` shifts the numbering by one bar (`pickupBars`), so a loop of measures 5 to 8 starts where the director means.
- **Time signature changes.** Tone ticks are converted at `Tone.Transport.PPQ = 192`, and every time signature in the file goes into `barStarts`, so the measure numbers stay right through meter changes.
- **Note names that match the score.** `keyUsesFlats()` reads the file's key signature, so the note readout says E♭ and not D♯ in a flat key.

### SoundTouch (`AudioPractice.astro`)

- **Slowing a recording without changing the pitch.** The SoundTouch audio worklet stretches the recording. Moving between two slow tempos, such as 70% to 80%, used to rebuild every audio node, and singers heard a stutter. `applyRate()` now changes the rate on the running nodes, and only rebuilds when the tempo crosses 100%, where the SoundTouch node is added or removed.
- **Phones and tablets.** iOS sends plain Web Audio output to the earpiece and not to the speaker. On a touch-screen device the player plays through `<audio>` elements and changes their `playbackRate` instead.

### PDF.js (both players)

- **Turning pages while the music plays.** A page takes about 200 ms to render, and a second page turn during a render used to disappear. `renderPage()` keeps the last requested page in `queuedPage` and renders it as soon as the current one finishes, so three fast taps go to the third page.
- **Finding the measure on the page.** `score-follow.js` joins two outputs of the score reader: the measure widths in the MusicXML for where each measure sits across the page, and the detected staff lines for where each system sits down the page. The result is a fraction of the page, so the player can draw the measure box at any zoom.

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
- [@breezystack/lamejs](https://www.npmjs.com/package/@breezystack/lamejs) 1.2.7, the MP3 encoder for Download Mix

## Using this code

This repository is shared so people can read the code. It does not grant a license to reuse it. If you want to use part of it, get in touch with the Siskiyou Singers at info@siskiyousingers.org.
