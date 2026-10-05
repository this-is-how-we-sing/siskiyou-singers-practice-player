/**
 * loop-howto — the card that explains the Loop button.
 *
 * The practice players ask for a loop with two presses of one button: once
 * where the passage starts, once where it ends. That is quick once you know
 * it and invisible until you do, so the first press opens this card.
 *
 * It keeps opening on every press that STARTS a loop until the singer clicks
 * "Do not show this again". It never opens on the press that CLOSES a loop:
 * that press is the one the singer is trying to land by ear, and a card in
 * front of it would be the opposite of help.
 *
 * One screen, not a tour. The scores walkthrough (HowItWorksModal.astro) runs
 * six slides because it explains a five-step pipeline. This explains one
 * gesture, and it is allowed to come back tomorrow, so it has to be readable
 * and gone in two seconds.
 *
 * Both players import this. The dialog and its styles are built once per page
 * and shared, whichever player asks for them first.
 */

const STORE_KEY = 'ss:loop-howto-dismissed:v1';
const WINDOW_KEY = '__ssLoopHowTo';

interface HowToWindow extends Window {
  [WINDOW_KEY]?: { dialog: HTMLDialogElement; setMarked: (text: string | null) => void };
}

/**
 * True once the singer has asked not to see the card again.
 *
 * localStorage throws in a private window with site data blocked. A card that
 * shows one time too many beats a player that fails to open.
 */
export function loopHowToDismissed(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

function dismiss(): void {
  try {
    localStorage.setItem(STORE_KEY, '1');
  } catch {
    /* nothing to do: the card simply shows again next time */
  }
}

const CSS = `
.lht {
  margin: auto;
  width: calc(100% - 2rem);
  max-width: 30rem;
  padding: 0;
  color: #f4f4f5;
  background: #18181b;
  border: 1px solid #3f3f46;
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.6);
}
.lht::backdrop { background: rgba(0,0,0,0.75); }
.lht[open] { animation: lht-pop 160ms ease-out; }
.lht[open]::backdrop { animation: lht-fade 160ms ease-out; }
@keyframes lht-pop { from { opacity: 0; transform: translateY(8px) scale(0.985); } }
@keyframes lht-fade { from { opacity: 0; } }

.lht-inner { display: flex; flex-direction: column; max-height: calc(100dvh - 2rem); }
.lht-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
  padding: 1.1rem 1.4rem 0.9rem;
  border-bottom: 1px solid #27272a;
}
.lht-head h2 { margin: 0; font-size: 1.2rem; font-weight: 600; color: #fff; }
.lht-body { padding: 1.2rem 1.4rem; overflow-y: auto; }

/* What the singer just did, when they got here by pressing the button. The
   card is worth more when it names the measure they are standing on. */
.lht-marked {
  display: flex; align-items: center; gap: 0.6rem;
  margin: 0 0 1.1rem; padding: 0.7rem 0.9rem;
  font-size: 0.95rem; color: #bbf7d0;
  background: rgba(74,222,128,0.10);
  border: 1px solid rgba(74,222,128,0.35);
  border-radius: 10px;
}
.lht-marked b { color: #fff; font-weight: 600; }
/* A class that sets display beats the browser's own rule for the hidden
   attribute, so the green bar stayed on screen with nothing in it when the
   card was opened from the ? button. */
.lht [hidden] { display: none !important; }
.lht-pip {
  width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto;
  background: #4ade80; box-shadow: 0 0 0 3px rgba(74,222,128,0.22);
}

.lht-art { display: block; width: 100%; max-width: 24rem; margin: 0 auto 1.2rem; height: auto; }

.lht-steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.9rem; }
.lht-steps li { display: flex; gap: 0.8rem; align-items: flex-start; }
.lht-num {
  flex: 0 0 auto; width: 1.8rem; height: 1.8rem; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.9rem; font-weight: 600; color: #fde68a;
  background: rgba(245,158,11,0.18);
  box-shadow: inset 0 0 0 1px rgba(245,158,11,0.45);
}
/* The audience skews 60+, so body copy is a full 1rem on a loose line. */
.lht-steps p { margin: 0.15rem 0 0; font-size: 1rem; line-height: 1.55; color: #d4d4d8; }
.lht-steps b { color: #fafafa; font-weight: 600; }

.lht-aside {
  margin: 1.1rem 0 0; padding-left: 0.85rem;
  border-left: 3px solid #3f3f46;
  font-size: 0.9rem; line-height: 1.6; color: #a1a1aa;
}
.lht-aside b { color: #e4e4e7; font-weight: 600; }
.lht-key {
  display: inline-block; padding: 0 0.35rem;
  font-size: 0.85em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #fde68a; background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.14); border-radius: 4px;
}

.lht-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 0.8rem;
  flex-wrap: wrap;
  padding: 0.9rem 1.4rem 1.1rem;
  border-top: 1px solid #27272a;
}
.lht-btn {
  min-height: 44px; padding: 0 1.1rem;
  font-family: inherit; font-size: 0.95rem; font-weight: 600;
  border-radius: 9px; cursor: pointer; white-space: nowrap;
}
.lht-got {
  color: #3a2a00; border: 0;
  background: linear-gradient(180deg, #f7c948 0%, #e0a800 100%);
}
.lht-got:hover { background: linear-gradient(180deg, #fbd35e 0%, #ecb200 100%); }
.lht-never {
  color: #a1a1aa; background: transparent;
  border: 1px solid #3f3f46; font-weight: 500;
}
.lht-never:hover { color: #fff; background: rgba(255,255,255,0.06); border-color: #52525b; }
.lht-btn:focus-visible { outline: 2px solid #facc15; outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .lht[open], .lht[open]::backdrop { animation: none; }
}
`;

/* The mechanism, drawn the way it looks on the progress bar: a green flag
   where the first press landed, a red flag where the second one did, and the
   gold band between them that is the loop. */
const ART = `
<svg class="lht-art" viewBox="0 0 320 96" role="img"
     aria-label="A progress bar with a green mark where the first press landed, a red mark where the second landed, and a gold band between them.">
  <rect x="8" y="30" width="304" height="30" rx="6" fill="#27272a" stroke="#3f3f46"/>
  <rect x="96" y="30" width="132" height="30" fill="rgba(250,204,21,0.22)"/>
  <g stroke="rgba(255,255,255,0.12)" stroke-width="1">
    <path d="M30 30v30M52 30v30M74 30v30M96 30v30M118 30v30M140 30v30M162 30v30M184 30v30M206 30v30M228 30v30M250 30v30M272 30v30M294 30v30"/>
  </g>
  <g>
    <rect x="94.5" y="28" width="3" height="34" rx="1.5" fill="#4ade80"/>
    <circle cx="96" cy="45" r="5" fill="#18181b" stroke="#4ade80" stroke-width="2"/>
    <text x="96" y="20" text-anchor="middle" fill="#4ade80" font-size="11" font-family="system-ui, sans-serif">1st press</text>
  </g>
  <g>
    <rect x="226.5" y="28" width="3" height="34" rx="1.5" fill="#f87171"/>
    <circle cx="228" cy="45" r="5" fill="#18181b" stroke="#f87171" stroke-width="2"/>
    <text x="228" y="20" text-anchor="middle" fill="#f87171" font-size="11" font-family="system-ui, sans-serif">2nd press</text>
  </g>
  <text x="162" y="82" text-anchor="middle" fill="#fde68a" font-size="11.5" font-family="system-ui, sans-serif">this is what repeats</text>
</svg>
`;

function build(): { dialog: HTMLDialogElement; setMarked: (text: string | null) => void } {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const dlg = document.createElement('dialog');
  dlg.className = 'lht';
  dlg.id = 'loop-howto';
  dlg.setAttribute('aria-labelledby', 'loop-howto-title');
  dlg.innerHTML = `
    <div class="lht-inner">
      <div class="lht-head">
        <h2 id="loop-howto-title">How to loop a passage</h2>
      </div>
      <div class="lht-body">
        <p class="lht-marked" id="loop-howto-marked" hidden>
          <span class="lht-pip" aria-hidden="true"></span>
          <span id="loop-howto-marked-text"></span>
        </p>
        ${ART}
        <ol class="lht-steps">
          <li><span class="lht-num">1</span><p>Press <b>Loop</b> where the rough patch <b>starts</b>. The music keeps going.</p></li>
          <li><span class="lht-num">2</span><p>Press it again where the patch <b>ends</b>. Those measures now repeat until you stop them.</p></li>
          <li><span class="lht-num">3</span><p>Missed it? Nudge either end with <b>&minus;</b> and <b>+</b>, one measure a press. Hold one down to travel.</p></li>
        </ol>
        <p class="lht-aside">
          <b>You can type it instead.</b> Click the measure number and type
          <span class="lht-key">33</span> for one end, or
          <span class="lht-key">33-40</span> for the whole passage. That is the quick way
          to a measure a long way from where you are.
        </p>
      </div>
      <div class="lht-foot">
        <button type="button" class="lht-btn lht-never" id="loop-howto-never">Do not show this again</button>
        <button type="button" class="lht-btn lht-got" id="loop-howto-got">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);

  const markedEl = dlg.querySelector<HTMLElement>('#loop-howto-marked')!;
  const markedText = dlg.querySelector<HTMLElement>('#loop-howto-marked-text')!;
  const setMarked = (text: string | null) => {
    if (text) {
      markedText.innerHTML = text;
      markedEl.hidden = false;
    } else {
      markedEl.hidden = true;
    }
  };

  dlg.querySelector('#loop-howto-got')!.addEventListener('click', () => dlg.close());
  dlg.querySelector('#loop-howto-never')!.addEventListener('click', () => {
    dismiss();
    dlg.close();
  });
  // A click on the dark area outside the card closes it, which is what people
  // expect. That click lands on the dialog itself, not on its contents.
  dlg.addEventListener('click', e => {
    if (e.target === dlg) dlg.close();
  });

  return { dialog: dlg, setMarked };
}

function instance() {
  const w = window as HowToWindow;
  if (!w[WINDOW_KEY]) w[WINDOW_KEY] = build();
  return w[WINDOW_KEY]!;
}

/**
 * Show the card.
 *
 * `markedAt` is the address the press just marked, spelled the way the player
 * spells it ("m. 33"). Pass null to open the card cold, which is what the
 * "How looping works" button in the loop bar does.
 */
export function openLoopHowTo(markedAt: string | null): void {
  const { dialog, setMarked } = instance();
  setMarked(
    markedAt
      ? `Loop starts at <b>${markedAt}</b>. The music is paused so you can read this.`
      : null,
  );
  if (!dialog.open) dialog.showModal();
}
