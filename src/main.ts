import { Audio8 } from './audio';
import { Bot } from './bot';
import { Game, type GameEvent } from './game';
import { Input } from './input';
import { PatchTest } from './patchtest';
import { STEP, type JumpInput } from './physics';
import { Renderer } from './render';
import { SaveFile } from './storage';
import { UI, type Act, type ScreenName } from './ui';

export type Phase = 'title' | 'playing' | 'countdown' | 'paused' | 'dying' | 'result';
declare global {
  interface Window { patch?: EventTarget & { quality?: 'low' | 'medium' | 'high' } }
}

const testing = new URLSearchParams(location.search).get('patch-test') === '1';
const canvas = document.getElementById('game') as HTMLCanvasElement;
// A test run must not touch the player's records.
const save = testing ? new SaveFile(() => ({ getItem: () => null, setItem: () => {} })) : new SaveFile();
const audio = new Audio8(save.data);
const ui = new UI(save);
const input = new Input(canvas);
const view = new Renderer(canvas);

const DEMO_SEED = 7;
const TEST_SEED = 4;
let phase: Phase = 'title';
let game = new Game(DEMO_SEED);
let demo = new Bot();
let acc = 0;
let last = performance.now();
let phaseAt = last;
/** Screen that settings or credits return to. */
let returnTo: ScreenName = 'title';
/** Was a jump being held when play paused? */
let heldAtPause = false;
let assistHold = false;
let lastCount = 0;

function setPhase(p: Phase): void { phase = p; phaseAt = performance.now(); }

function startDemo(): void {
  game = new Game(DEMO_SEED);
  demo = new Bot();
  acc = 0;
  view.reset();
}

function title(): void {
  setPhase('title');
  startDemo();
  audio.stop();
  ui.hud(false); ui.hint(false); ui.count(null);
  ui.show('title');
}

function startRun(): void {
  game = new Game(testing ? TEST_SEED : Math.floor(Math.random() * 2 ** 31));
  view.reset();
  acc = 0;
  heldAtPause = assistHold = false;
  input.release();
  ui.show(null);
  ui.count(null);
  ui.hud(true); ui.hint(true);
  setPhase('playing');
  audio.start();
}

function pause(): void {
  if (phase !== 'playing' && phase !== 'countdown') return;
  if (phase === 'playing') heldAtPause = game.player.jumping;
  setPhase('paused');
  input.release();
  audio.stop();
  ui.count(null); ui.hint(false);
  ui.show('pause');
}

function resume(): void {
  if (phase !== 'paused') return;
  lastCount = 0;
  ui.show(null);
  setPhase('countdown');
}

function act(a: Act): void {
  // A jump press made while falling must not skip the result.
  if (phase === 'result' && performance.now() - phaseAt < 450 && (a === 'restart' || a === 'home')) return;
  const s = save.data;
  switch (a) {
    case 'start': case 'restart': startRun(); break;
    case 'resume': resume(); break;
    case 'home': title(); break;
    case 'settings': case 'credits': returnTo = ui.screen ?? 'title'; ui.show(a); break;
    case 'back': ui.show(returnTo); break;
    case 'mute': s.muted = !s.muted; break;
    case 'music': s.music = (s.music + 1) % 4; break;
    case 'sfx': s.sfx = (s.sfx + 1) % 4; break;
    case 'shake': s.shake = !s.shake; break;
  }
  if (a === 'mute' || a === 'music' || a === 'sfx' || a === 'shake') {
    save.save();
    audio.apply();
    view.shakeOn = s.shake;
    ui.refresh();
  }
  audio.play('ui');
}

ui.onAct = (a) => { if (!testing) act(a); };
input.locked = testing;
input.onMenu = (a) => ui.menu(a);
input.onGesture = () => audio.unlock();
input.onMute = () => act('mute');
input.onPause = () => {
  if (phase === 'playing' || phase === 'countdown') pause();
  else if (ui.screen === 'settings' || ui.screen === 'credits') act('back');
  else if (phase === 'paused') act('resume');
  else if (phase === 'title') act('start');
  else if (phase === 'result') act('restart');
};
input.onDevice = () => ui.setDevice(input.device);
input.onBlur = pause;
ui.setDevice(input.device);
document.getElementById('btn-pause')!.addEventListener('click', () => { if (!testing) pause(); });

const test = testing
  ? new PatchTest({
      phase: () => phase, game: () => game, start: startRun, pause, resume, restart: startRun, canvas,
      visible: (id) => !!document.getElementById(id)?.checkVisibility(),
    })
  : null;

function onEvent(e: GameEvent): void {
  view.onEvent(e, game);
  if (phase !== 'playing') return;
  test?.onEvent(e);
  switch (e.type) {
    case 'jump': audio.play('jump'); break;
    case 'land': audio.play('land'); break;
    case 'coin': audio.play(e.value > 1 ? 'gold' : 'coin'); break;
    case 'perfectBonus': audio.play('perfect'); break;
    case 'risk': audio.play('risk'); break;
    case 'stumble': audio.play('stumble'); input.rumble(120, 0.5); break;
    case 'wall': audio.play('stumble'); input.rumble(160, 0.7); break;
    case 'fell':
      audio.stop();
      audio.play('fall');
      input.rumble(220, 0.8);
      setPhase('dying');
      break;
  }
}

function runInput(): JumpInput {
  if (test) return test.input();
  const pressed = input.takePress();
  // After a pause mid-jump, finish that jump for the player unless they take over.
  if (assistHold && (pressed || !game.player.jumping)) assistHold = false;
  return { pressed, held: input.held || assistHold };
}

function simulate(dt: number, next: () => JumpInput): void {
  acc = Math.min(acc + dt, 0.25);
  while (acc >= STEP) {
    acc -= STEP;
    game.step(next());
    if (phase === 'playing') test?.afterStep();
    for (const e of game.drain()) onEvent(e);
    if (game.dead) { acc = 0; break; }
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  input.pollPads();
  const inPhase = performance.now() - phaseAt;
  switch (phase) {
    case 'title':
      simulate(dt, () => demo.next(game));
      if (game.dead || game.distance > 900) startDemo();
      break;
    case 'playing':
      simulate(dt, runInput);
      if (game.distance > 30) ui.hint(false);
      ui.update(game);
      break;
    case 'countdown': {
      const left = 3 - inPhase / 600;
      const n = Math.ceil(left);
      if (n > 0 && n !== lastCount) { lastCount = n; audio.play('count'); }
      ui.count(n > 0 ? n : null);
      if (left <= 0) {
        input.clearEdge();
        assistHold = heldAtPause;
        acc = 0;
        setPhase('playing');
        audio.start();
      }
      break;
    }
    case 'dying':
      if (inPhase > 650) {
        const isBest = save.record(game.score, game.distance);
        if (isBest) audio.play('best');
        setPhase('result');
        input.release();
        ui.hud(false); ui.hint(false);
        ui.result(game, isBest);
      }
      break;
  }
  audio.night = view.nightAt(game.distance);
  view.draw(game, phase === 'paused' || phase === 'countdown' ? 0 : dt, phase === 'playing' || phase === 'title');
  test?.frame();
}

const applyQuality = () => view.setQuality(window.patch?.quality ?? 'high');
window.patch?.addEventListener?.('qualitychange', applyQuality);
let dpr = devicePixelRatio;
addEventListener('resize', () => { dpr = devicePixelRatio; view.resize(); });
setInterval(() => { if (dpr !== devicePixelRatio) { dpr = devicePixelRatio; view.resize(); } }, 1000);

view.shakeOn = save.data.shake;
applyQuality();
// Building numbers are painted once, so wait briefly for the font.
Promise.race([document.fonts.load('11px Galmuri11', '동점'), new Promise((r) => setTimeout(r, 1500))])
  .catch(() => {})
  .finally(() => { title(); requestAnimationFrame(frame); });
