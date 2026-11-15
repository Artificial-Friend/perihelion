// Standalone entry for the field-operations prototypes: the Recovery race and the Hopper courier
// without the 3D solar system or the WebAssembly core. Same code as inside the game; a small host
// provides the title screen, panels, toasts and the modal.
import { morph } from '../ui/morph';
import { FieldUI, Host, MODES } from './ui';
import { esc } from '../game/util';
import { setClockSkew } from '../sim/clock';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const P: any = ((window as any).P = { debug: {} });

class StandaloneHost implements Host {
  scr = 'title';
  regions: Record<string, string> = {};
  field: FieldUI;
  constructor() {
    this.field = new FieldUI(this);
    document.addEventListener('click', e => {
      const el = (e.target as Element).closest('[data-act]') as HTMLElement | null;
      if (!el || (el as any).disabled) return;
      this.act(el.dataset.act!, el.dataset.v || '');
    });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeModal(); });
  }
  act(a: string, v: string) {
    if (a === 'close') { this.closeModal(); return; }
    if (this.field.act(a, v) && this.scr === 'field') { this.regions = {}; this.field.panels(this.field.now()); }
  }
  set(s: string) {
    this.scr = s; this.regions = {};
    $('#ui').innerHTML = s === 'field' ? this.field.screenHTML() : this.titleHTML();
  }
  region(id: string, html: string) {
    if (this.regions[id] === html) return;
    const el = document.getElementById(id); if (!el) return;
    this.regions[id] = html; morph(el, html);
  }
  toast(text: string, kind = '') {
    if (!text) return;
    const d = document.createElement('div'); d.className = 'toast ' + kind; d.textContent = text;
    $('#toasts').appendChild(d); setTimeout(() => d.remove(), 5500);
  }
  modal(html: string) { $('#mcard').innerHTML = html; $('#modal').hidden = false; }
  closeModal() { $('#modal').hidden = true; }
  titleHTML() {
    const desc = (m: 'rec' | 'hop') => `<p class="hint fdesc">${esc(MODES[m].blurb)}</p>`;
    return `<section class="screen title fieldtitle"><div class="wrap1">
      <h1>PERI<b>HELION</b></h1>
      <p class="lede">Field operations: two prototype ways to start a company from nothing, on Earth or on Mars. The world clock runs in real time for everyone; rival crews play by the same physics you do.</p>
      ${this.field.titleHTML()}
      <div class="fdescs"><div><b>${MODES.rec.name}</b>${desc('rec')}</div><div><b>${MODES.hop.name}</b>${desc('hop')}</div></div>
      <p class="hint" style="margin-top:16px;font-size:12px">Progress is kept in this browser. Add <code>#rec-mars</code> or <code>#hop-earth</code> to the address to jump straight in; <code>-dev</code> on the end shows a time-skip tray for testing.</p>
    </div></section>`;
  }
}

function boot() {
  const host = new StandaloneHost();
  P.debug = { ui: host, setClockSkew };
  host.set('title');
  const m = /^#(rec|hop)-(earth|mars)/.exec(location.hash);
  if (m) host.field.enter(m[1] as any, m[2] as any);
  document.getElementById('loading')?.classList.add('out');
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now; P.frames = (P.frames || 0) + 1;
    if (!P.pause && host.scr === 'field') { try { host.field.frame(dt); } catch (e) { console.error(e); } }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
boot();
