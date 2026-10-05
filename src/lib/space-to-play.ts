/**
 * The space bar starts and stops the open practice player.
 *
 * A singer asked for it on 2026-09-29: Apple Music, YouTube and BandLab
 * all do it, and on this site the space bar scrolled the page instead, so the
 * singer had to scroll back and click Pause.
 *
 * Only one player is open at a time (opening one closes the rest, through
 * window.__ssPracticeClosers), so the open one is the one the key controls.
 * With no player open, the space bar scrolls the page as it always did.
 *
 * The key is left alone when it already means something:
 * - in a text box, a select or anything editable, it types a space;
 * - on a control a keyboard user moved to with Tab, it presses that control,
 *   which is how a keyboard user presses every button on the page;
 * - with Shift, Ctrl, Alt or Cmd held, it does whatever the browser does;
 * - when a control handles the key itself (a note box previews its note).
 *
 * A control that has focus because the mouse clicked it is different. Chrome
 * and Firefox keep focus on a clicked button, so after a click on Solo the
 * space bar would press Solo again. There the space bar goes to the player.
 *
 * :focus-visible cannot tell the two apart here. Chrome makes the focused
 * element match it as soon as a key goes down, so inside the keydown handler
 * a clicked button already looks like a Tab-focused one. The page records
 * instead whether each focus came right after a pointer press.
 *
 * The player's own Play button does the toggling, through a click, so the key
 * gets exactly what a tap gets: the audio unlock, the icon and the mini
 * player. A key press counts as a user gesture, so browsers allow the audio.
 */

export type SpacePlayer = {
  /** True while the player's panel is on screen. */
  isOpen: () => boolean;
  /** The button whose click starts and stops playback. */
  playButton: HTMLElement;
};

const TYPING = 'input:not([type=button]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=reset]):not([type=submit]), textarea, select, [contenteditable]:not([contenteditable=false])';
const CONTROL = 'button, a[href], input, summary, [tabindex], [role=button], [role=checkbox], [role=switch], [role=slider], [role=menuitem], [role=tab]';

// The element that last took focus from a mouse, finger or pen. A focus
// counts as the pointer's when it follows a pointer press within this long
// and no key went down in between. The key rule matters: a Tab can come a
// fraction of a second after a click, and that focus is the keyboard's.
const POINTER_FOCUS_MS = 1000;
let pointerPressAt = -Infinity;
let pointerFocused: Element | null = null;

function wantsTheKey(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(TYPING)) return true;
  if (!target.matches(CONTROL)) return false;
  return target !== pointerFocused;
}

export function registerSpaceToPlay(player: SpacePlayer): void {
  const w = window as any;
  const players: SpacePlayer[] = (w.__ssSpacePlayers ||= []);
  players.push(player);
  if (w.__ssSpaceListening) return;
  w.__ssSpaceListening = true;

  document.addEventListener('pointerdown', (e) => { pointerPressAt = e.timeStamp; },
    { capture: true, passive: true });
  document.addEventListener('keydown', () => { pointerPressAt = -Infinity; }, true);
  document.addEventListener('focusin', (e) => {
    pointerFocused = e.timeStamp - pointerPressAt < POINTER_FOCUS_MS ? (e.target as Element) : null;
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.defaultPrevented) return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (wantsTheKey(e.target)) return;

    const open = players.find((p) => p.playButton.isConnected && p.isOpen());
    if (!open) return;

    // Stop the page scroll, and on a mouse-focused button stop the browser
    // from also pressing that button when the key comes up.
    e.preventDefault();
    // Holding the key down repeats it. One press is one toggle.
    if (e.repeat) return;
    open.playButton.click();
  });
}
