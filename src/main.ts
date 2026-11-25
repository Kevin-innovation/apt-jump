import { Audio8 } from './audio';
import { Bot } from './bot';
import { Editor } from './editor';
import { Game, type GameEvent } from './game';
import { Input } from './input';
import { buildCourse, blankMap, PRACTICE, type GameMap } from './maps';
import { downloadMap, MapScreen } from './mapscreen';
import { MapStore, MAX_MAPS } from './mapstore';
import { PatchTest } from './patchtest';
import { OnlineScreens } from './online/screens';
import { errorText, onlineUrl } from './online/types';
import { Recorder } from './replay';
import { STEP, type JumpInput } from './physics';
import { Renderer } from './render';
import { SaveFile } from './storage';
import { UI, type Act, type ScreenName } from './ui';

export type Phase = 'title' | 'playing' | 'countdown' | 'paused' | 'dying' | 'result' | 'editor' | 'issuing';
/** What is being played, so a restart repeats it and scores never mix. */
type Mode = { kind: 'endless' } | { kind: 'map'; map: GameMap; id: string | null; from: 'maps' | 'editor' };
declare global {
  interface Window { patch?: EventTarget & { quality?: 'low' | 'medium' | 'high' } }
}

const testing = new URLSearchParams(location.search).get('patch-test') === '1';
const canvas = document.getElementById('game') as HTMLCanvasElement;
// A test run must not touch the player's records.
const nowhere = () => ({ getItem: () => null, setItem: () => {} });
const save = testing ? new SaveFile(nowhere) : new SaveFile();
const maps = testing ? new MapStore(nowhere) : new MapStore();
const audio = new Audio8(save.data);
const ui = new UI(save);
const input = new Input(canvas);
const view = new Renderer(canvas);
const editor = new Editor();

const DEMO_SEED = 7;
const TEST_SEED = 4;
let phase: Phase = 'title';
let mode: Mode = { kind: 'endless' };
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
let leaving = false;
/** The ranked run being played, when the server issued one. */
let ranked: { runId: string; recorder: Recorder } | null = null;
let starting = 0;
/** The window lost focus while a run was being issued. */
let awayAtStart = false;

function setPhase(p: Phase): void { phase = p; phaseAt = performance.now(); }

function startDemo(): void {
  game = new Game(DEMO_SEED);
  demo = new Bot();
  acc = 0;
  view.reset();
}

function title(): void {
  starting++;
  ranked = null;
  setPhase('title');
  startDemo();
  audio.stop();
  ui.hud(false); ui.hint(false); ui.count(null);
  ui.show('title');
}

function openMaps(): void {
  if (phase !== 'title') title();
  mapScreen.message('');
  mapScreen.refresh();
  ui.show('maps');
}

function openEditor(map: GameMap, id: string | null): void {
  editor.open(map, id);
  showEditor();
}
function showEditor(): void {
  audio.stop();
  ui.hud(false); ui.hint(false); ui.count(null);
  setPhase('editor');
  ui.show('editor');
}

/** True when the map is safely on the shelf. */
function saveMap(): boolean {
  editor.flush();
  const s = maps.put(editor.map, editor.id);
  if (!s) { editor.message(`맵은 ${MAX_MAPS}개까지 보관할 수 있습니다. 파일로 내려받거나 다른 맵을 지우세요.`); return false; }
  editor.id = s.id;
  editor.dirty = false;
  editor.message(maps.available ? '저장했습니다.' : '이 브라우저에는 저장할 수 없습니다. 파일로 내려받아 두세요.');
  return true;
}

function playMap(map: GameMap, id: string | null, from: 'maps' | 'editor'): void {
  mode = { kind: 'map', map: structuredClone(map), id, from };
  startRun();
}

/** Where leaving a run goes. */
function leave(): void {
  if (mode.kind === 'endless') title();
  else if (mode.from === 'editor') showEditor();
  else openMaps();
}

/** Endless runs of a signed-in player are issued by the server; everything else starts at once. */
function startRun(): void {
  const online = onlineUi.online;
  const ticket = ++starting;
  if (testing || mode.kind !== 'endless' || !online || !onlineUi.signedIn) { begin(null, ''); return; }
  ui.show(null);
  ui.hud(false); ui.hint(false);
  audio.stop();
  awayAtStart = false;
  setPhase('issuing');
  ui.wait('기록 준비 중…');
  let settled = false;
  const go = (run: { runId: string; seed: number } | null, why: string) => {
    if (settled || ticket !== starting || phase !== 'issuing') return;
    settled = true;
    begin(run, why);
  };
  online.start().then((r) => go(r, ''), (e) => go(null, errorText(e)));
  setTimeout(() => go(null, '온라인 응답이 늦어 이번 판은 순위에 오르지 않습니다.'), 3000);
}

function begin(run: { runId: string; seed: number } | null, why: string): void {
  const away = phase === 'issuing' && awayAtStart;
  ui.wait('');
  ranked = run && { runId: run.runId, recorder: new Recorder() };
  ui.onlineNote(why);
  game = mode.kind === 'map' ? new Game(buildCourse(mode.map)) : new Game(run ? run.seed : testing ? TEST_SEED : Math.floor(Math.random() * 2 ** 31));
  ui.homeLabel(mode.kind === 'endless' ? '타이틀로' : mode.from === 'editor' ? '편집기로' : '맵 목록으로');
  view.reset();
  acc = 0;
  heldAtPause = assistHold = false;
  input.release();
  ui.show(null);
  ui.count(null);
  ui.hud(true); ui.hint(true);
  setPhase('playing');
  audio.start();
  if (away) pause();
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
    case 'start': mode = { kind: 'endless' }; startRun(); break;
    case 'restart': startRun(); break;
    case 'resume': resume(); break;
    case 'home': if (phase === 'title') title(); else leave(); break;
    case 'maps': openMaps(); break;
    case 'ranking': ui.show('ranking'); onlineUi.openRanking(); break;
    case 'newmap': openEditor(blankMap(), null); break;
    case 'import': mapScreen.pickFile(); break;
    case 'ed-save': saveMap(); break;
    case 'ed-export': editor.flush(); downloadMap(editor.map); break;
    case 'ed-test':
      editor.flush();
      if (editor.valid) playMap(editor.map, null, 'editor');
      else editor.message('아래 문제를 먼저 고쳐 주세요.');
      break;
    case 'ed-back':
      editor.flush();
      // Leaving keeps the work; when it can't be kept, a second press leaves anyway.
      if (editor.dirty && !leaving && !saveMap()) { leaving = true; break; }
      leaving = false;
      setPhase('editor');
      openMaps();
      break;
    case 'settings': case 'credits': case 'items': returnTo = ui.screen ?? 'title'; ui.show(a); break;
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


const mapScreen = new MapScreen(maps, {
  play: (map, id) => playMap(map, id, 'maps'),
  edit: (map, id) => openEditor(map, id),
});
const onlineUi = new OnlineScreens(maps, {
  play: (map, id) => playMap(map, id, 'maps'),
  edit: (map, id) => openEditor(map, id),
});
mapScreen.onRefresh = () => onlineUi.refreshMaps();

/** Hands a finished ranked run in; the result screen says how it went. */
function submitRun(): void {
  const run = ranked, online = onlineUi.online;
  ranked = null;
  if (!run || !online) return;
  const at = ++starting;
  const say = (t: string) => { if (at === starting) ui.onlineNote(t); };
  ui.onlineNote('순위에 등록하는 중…');
  online.finish(run.runId, run.recorder.text()).then(
    (r) => say(r.best ? `이번 주 최고 기록 ${r.score.toLocaleString('ko-KR')}점을 등록했습니다!` : '이번 주 최고 기록에는 미치지 못했습니다.'),
    (e) => say(errorText(e)),
  );
}

ui.onAct = (a) => { if (!testing) act(a); };
input.locked = testing;
input.onMenu = (a) => ui.menu(a);
input.onGesture = () => audio.unlock();
input.onMute = () => act('mute');
input.onPause = () => {
  if (phase === 'playing' || phase === 'countdown') pause();
  else if (ui.screen === 'settings' || ui.screen === 'credits' || ui.screen === 'items') act('back');
  else if (phase === 'paused') act('resume');
  else if (phase === 'title' && ui.screen === 'title') act('start');
  else if (phase === 'result') act('restart');
};
input.onDevice = () => ui.setDevice(input.device);
input.onBlur = () => { if (phase === 'issuing') awayAtStart = true; else pause(); };
ui.setDevice(input.device);
document.getElementById('btn-pause')!.addEventListener('click', () => { if (!testing) pause(); });

const test = testing
  ? new PatchTest({
      phase: () => phase, game: () => game, pause, resume, restart: startRun, canvas,
      startMap: () => playMap(PRACTICE, null, 'maps'),
      startEndless: () => { mode = { kind: 'endless' }; startRun(); },
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
    case 'coin': audio.play(e.kind); break;
    case 'airjump': audio.play('air'); break;
    case 'stomp': audio.play('stomp'); input.rumble(60, 0.4); break;
    case 'power': audio.play(e.kind === 'boost' || e.kind === 'slow' ? e.kind : 'power'); break;
    case 'shielded': audio.play('shield'); input.rumble(90, 0.5); break;
    case 'mission': audio.play('mission'); break;
    case 'speedup': audio.play('up'); break;
    case 'roadExit': audio.play('risk'); break;
    case 'goal':
      audio.stop();
      audio.play('goal');
      setPhase('dying');
      break;
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
    const j = next();
    if (phase === 'playing') ranked?.recorder.add(j);
    game.step(j);
    if (phase === 'playing') test?.afterStep();
    for (const e of game.drain()) onEvent(e);
    if (game.over) { acc = 0; break; }
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
      if (game.over || game.distance > 900) startDemo();
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
      if (inPhase > (game.finished ? 1100 : 650)) {
        // Made maps keep their own best; only the endless city counts as a record.
        const shelf = mode.kind === 'map' && mode.id ? maps.get(mode.id) : undefined;
        const isBest = mode.kind === 'endless' ? save.record(game.score, game.distance)
          : shelf ? maps.record(shelf.id, game.score, game.finished) : false;
        const best = mode.kind === 'endless' ? save.data.best : shelf ? shelf.best : null;
        if (isBest) audio.play('best');
        setPhase('result');
        input.release();
        ui.hud(false); ui.hint(false);
        ui.result(game, isBest, best);
        submitRun();
      }
      break;
  }
  if (phase === 'editor') { editor.draw(dt); return; }
  audio.tempo = (1 + Math.min(0.25, (game.level - 1) * 0.022)) * (game.player.boostTime > 0 ? 1.12 : game.player.slowTime > 0 ? 0.85 : 1);
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

// Online is optional: without an address, or if it can't load, the game is complete as it is.
const url = testing ? null : onlineUrl(import.meta.env.VITE_CONVEX_URL as string | undefined, import.meta.env.DEV);
if (url) {
  onlineUi.connecting = true;
  onlineUi.refresh();
  import('./online/island').then((m) => onlineUi.attach(m.connect(url)), () => { onlineUi.connecting = false; onlineUi.refresh(); });
}
// Building numbers are painted once, so wait briefly for the font.
Promise.race([document.fonts.load('11px Galmuri11', '동점'), new Promise((r) => setTimeout(r, 1500))])
  .catch(() => {})
  .finally(() => { title(); requestAnimationFrame(frame); });
