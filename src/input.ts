export type MenuAction = 'up' | 'down' | 'confirm' | 'back';
export type Device = 'key' | 'touch' | 'pad';
const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyX', 'KeyZ']);
const MENU_KEYS: Record<string, MenuAction> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', Backspace: 'back',
};

/** Keys pressed in a text box or slider belong to it, not to the game. */
const typing = (e: Event) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;

/** One set of actions from keyboard, pointer and any standard gamepad. */
export class Input {
  device: Device = matchMedia('(pointer: coarse)').matches ? 'touch' : 'key';
  /** Returns true when a menu used the action. */
  onMenu: (a: MenuAction) => boolean = () => false;
  onPause: () => void = () => {};
  onMute: () => void = () => {};
  onGesture: () => void = () => {};
  onDevice: () => void = () => {};
  onBlur: () => void = () => {};
  /** While true, nothing a person does reaches the game (Patch's test). */
  locked = false;

  private keys = new Set<string>();
  private pointers = new Set<number>();
  private padJump = false;
  private edge = false;
  private padPrev = new Set<number>();
  private padPrimed = false;
  private stickPrev = 0;

  constructor(surface: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (this.locked || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || typing(e)) return;
      this.onGesture();
      this.setDevice('key');
      if (e.code === 'KeyP' || e.code === 'KeyM') {
        e.preventDefault();
        if (!e.repeat) (e.code === 'KeyP' ? this.onPause : this.onMute)();
        return;
      }
      const menu = MENU_KEYS[e.code];
      const moves = menu === 'up' || menu === 'down';
      if (menu && e.repeat && !moves) { e.preventDefault(); return; }
      if (menu && this.onMenu(menu)) { e.preventDefault(); return; }
      if (JUMP_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) { this.keys.add(e.code); this.edge = true; }
      }
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      // Menus act on keydown: stop the browser clicking the focused button again on release.
      if (e.code === 'Space' && !typing(e)) e.preventDefault();
    });
    surface.addEventListener('pointerdown', (e) => {
      if (this.locked || e.button !== 0) return;
      e.preventDefault();
      this.setDevice(e.pointerType === 'mouse' ? 'key' : 'touch');
      this.pointers.add(e.pointerId);
      try { surface.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      this.edge = true;
    });
    const up = (e: PointerEvent) => void this.pointers.delete(e.pointerId);
    addEventListener('pointerup', (e) => { up(e); if (!this.locked) this.onGesture(); });
    addEventListener('pointercancel', up);
    addEventListener('pointerdown', () => { if (!this.locked) this.onGesture(); });
    addEventListener('contextmenu', (e) => e.preventDefault());
    const blur = () => { this.release(); if (!this.locked) this.onBlur(); };
    addEventListener('blur', blur);
    document.addEventListener('visibilitychange', () => { if (document.hidden) blur(); });
  }

  private setDevice(d: Device): void {
    if (d !== this.device) { this.device = d; this.onDevice(); }
  }

  release(): void {
    this.keys.clear();
    this.pointers.clear();
    this.padJump = false;
    this.edge = false;
    this.padPrimed = false;
  }
  /** Forget presses made before play (re)starts. */
  clearEdge(): void { this.edge = false; }
  get held(): boolean { return this.keys.size > 0 || this.pointers.size > 0 || this.padJump; }
  takePress(): boolean { const e = this.edge; this.edge = false; return e; }

  /** Once a frame: no event carries pad buttons. */
  pollPads(): void {
    if (this.locked || !navigator.getGamepads) return;
    const now = new Set<number>();
    let x = 0, y = 0, any = false;
    for (const pad of navigator.getGamepads()) {
      if (!pad?.connected || pad.mapping !== 'standard') continue;
      any = true;
      pad.buttons.forEach((b, i) => { if (b.pressed && i !== 16) now.add(i); });
      const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > Math.hypot(x, y)) { x = ax; y = ay; }
    }
    if (!any) {
      this.padPrev.clear();
      this.padJump = this.padPrimed = false;
      this.stickPrev = 0;
      return;
    }
    if (!this.padPrimed && !this.padPrev.size && now.size) this.onGesture();
    const pressed = (i: number) => this.padPrimed && now.has(i) && !this.padPrev.has(i);
    const pushed = Math.hypot(x, y) > 0.5;
    const stick = pushed && Math.abs(y) > 0.4 ? Math.sign(y) : 0;
    const stickMoved = stick !== 0 && stick !== this.stickPrev;
    const anyPress = [...now].some(pressed);
    const confirm = pressed(0);
    const actions = { up: pressed(12) || (stickMoved && stick < 0), down: pressed(13) || (stickMoved && stick > 0), back: pressed(1), pause: pressed(9) };
    this.padPrev = now;
    this.padPrimed = true;
    this.stickPrev = stick;
    if (!now.has(0)) this.padJump = false;
    if (anyPress) this.onGesture();
    if (anyPress || pushed) this.setDevice('pad');
    if (actions.up) this.onMenu('up');
    if (actions.down) this.onMenu('down');
    if (actions.back) this.onMenu('back');
    if (actions.pause) this.onPause();
    else if (confirm && !this.onMenu('confirm')) { this.padJump = true; this.edge = true; }
  }

  rumble(duration: number, strong: number): void {
    if (this.device !== 'pad') return;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (pad?.mapping !== 'standard') continue;
      pad.vibrationActuator?.playEffect?.('dual-rumble', { duration, strongMagnitude: strong, weakMagnitude: strong / 2 })?.catch(() => {});
    }
  }
}
