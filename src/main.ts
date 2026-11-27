import { inject, track } from '@vercel/analytics';
import { Audio8 } from './audio';
import { AchievementView } from './online/achievementview';
import { Bot } from './bot';
import { Editor } from './editor';
import { FirstVisit } from './entry';
import { watchReleases } from './updates';
import { Game, type GameEvent } from './game';
import { Input } from './input';
import { buildCourse, blankMap, PRACTICE, type GameMap, parseMap } from './maps';
import { downloadMap, MapScreen } from './mapscreen';
import { MapStore, MAX_MAPS } from './mapstore';
import { PatchTest } from './patchtest';
import { AdminScreen } from './online/admin';
import { OnlineScreens } from './online/screens';
import { ShopView } from './online/shopview';
import { DailyView } from './online/dailyview';
import { errorText, onlineUrl, Refusal } from './online/types';
import { timeOf, timeText } from './mapreplay';
import { pauseAllowanceMs, Recorder } from './replay';
import { weekEnd, weekKey } from './week';
import { SEGMENT } from './world';
import { STEP, type JumpInput } from './physics';
import { Renderer } from './render';
import { SaveFile } from './storage';
import { UI, type Act, type ScreenName } from './ui';

export type Phase = 'title' | 'playing' | 'countdown' | 'paused' | 'dying' | 'result' | 'editor' | 'issuing';
/** What is being played, so a restart repeats it and scores never mix. */
/** `shared` marks a published map: only its runs are ranked by time, never the shelf's or the editor's. */
type Mode = { kind: 'endless' } | { kind: 'map'; map: GameMap; id: string | null; from: 'maps' | 'editor'; shared?: string };
declare global {
  interface Window { patch?: EventTarget & { quality?: 'low' | 'medium' | 'high' } }
}

const testing = new URLSearchParams(location.search).get('patch-test') === '1';
// Page views for Vercel Web Analytics: cookieless, only on the real site (a test run counts for nothing).
if (!testing) inject({ mode: import.meta.env.PROD ? 'production' : 'development' });
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
let warnTick = -1;
let leaving = false;
/** The ranked run being played, when the server issued one. */
let ranked: { runId: string; recorder: Recorder; map: boolean } | null = null;
/** A ranked city's stretch seeds known so far, fetched as the run goes; and when the run began, for the pause allowance. */
let city: { runId: string; seeds: number[]; asking: boolean; lastAsk: number; startedAt: number } | null = null;
/** Why this run counts for no ranking, shown while it starts (and again on the result). */
let unrankedNote = '';
let starting = 0;
/** The window lost focus while a run was being issued. */
let awayAtStart = false;
const firstVisit = new FirstVisit();
let booted = false;
/**
 * The loading cover stays until the title can be shown as it will stay: fonts ready and the account known, so no
 * button changes under the player's eyes. It never waits longer than COVER_WAIT.
 */
const COVER_WAIT = 3500;
let coverExpired = false;
function uncover(): void { if (booted) document.getElementById('boot')!.hidden = true; }
setTimeout(() => { coverExpired = true; uncover(); }, COVER_WAIT);
let updating = false;

function syncEntry(): void {
  const account = onlineUi.online?.account();
  const release = onlineUi.online?.release();
  document.querySelectorAll<HTMLElement>('.release-announcement').forEach(el => {
    el.hidden = !release;
    if (release) {
      const detail = '업데이트가 적용됐어요. 주간 기록은 유지돼요. 순위는 월요일 00:00(KST)에만 새로 시작해요.';
      el.textContent = el.closest('#title, #welcome') ? '업데이트 적용 · 주간 기록 유지' : detail;
      el.title = detail;
    }
  });
  ui.versionNews(release ? '업데이트 적용 · 주간 기록 유지' : '');
  // The same two slots either way: sign up / log in, or my account / log out. The ranking has its own button.
  const signedIn = account?.status === 'in';
  const slot = (id: string, act: string, text: string) => { const b = document.getElementById(id)!; b.dataset.act = act; b.textContent = text; };
  // One slot for the account (log in, or my account where logging out is); the shop always beside it.
  slot('title-account', signedIn ? 'account' : 'login', signedIn ? '내 계정' : '로그인');
  if (booted && !testing && !updating && phase === 'title' && ui.screen === 'title' && account && firstVisit.shouldShow(account.status)) ui.show('welcome');
  if (account?.status === 'in' && ui.screen === 'welcome') title();
  guardAdmin(account?.status === 'in');
}

/** Leaves nothing of the admin page once the account is logged out, revoked or changed. */
function guardAdmin(signedIn: boolean): void {
  const leave = () => {
    adminUi.clear();
    if (ui.screen === 'admin') { ui.show('account'); onlineUi.openAccount(null); }
  };
  if (!signedIn) leave();
  else void onlineUi.online?.admin.amI().then((yes) => { if (!yes) leave(); }, () => {});
}

function setPhase(p: Phase): void { phase = p; phaseAt = performance.now(); }

function startDemo(): void {
  // A different city behind the title each time.
  game = new Game(Math.floor(Math.random() * 2 ** 31));
  demo = new Bot();
  acc = 0;
  view.reset();
}

function title(): void {
  starting++;
  ranked = null; city = null;
  setPhase('title');
  startDemo();
  audio.stop();
  ui.hud(false); ui.hint(false); ui.count(null);
  ui.show('title');
  if (booted) syncEntry();
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
  editor.message(maps.available ? '내 맵에 저장했어요. 다른 사람과 나누려면 유저 맵 › 내 맵에서 「공유」를 누르세요.' : '이 브라우저에는 저장할 수 없습니다. 내 맵 목록에서 내보내기로 파일을 받아 두세요.');
  return true;
}

function playMap(map: GameMap, id: string | null, from: 'maps' | 'editor', shared?: string): void {
  mode = { kind: 'map', map: structuredClone(map), id, from, shared };
  startRun();
}

/** Where leaving a run goes. */
function leave(): void {
  if (mode.kind === 'endless') title();
  else if (mode.from === 'editor') showEditor();
  else openMaps();
}

/** How long a run waits to be issued: longer than the server's wait for the release manifest (ranking.ts). */
const START_WAIT = 6000;

/** Endless runs of a signed-in player are issued by the server; everything else starts at once. */
function startRun(): void {
  const online = onlineUi.online;
  const ticket = ++starting;
  const shared = mode.kind === 'map' ? mode.shared : undefined;
  if (testing || (mode.kind !== 'endless' && !shared) || !online) { begin(null, ''); return; }
  const account = online.account();
  if (!onlineUi.signedIn) {
    begin(null, account.status === 'in' ? '닉네임을 정하면 순위에 오릅니다. 이번 판은 순위에 오르지 않습니다.'
      : account.status === 'loading' ? '계정을 확인하는 중이라 이번 판은 순위에 오르지 않습니다.' : shared ? '로그인하면 맵 기록이 등록돼요.' : '');
    return;
  }
  ui.show(null);
  ui.hud(false); ui.hint(false);
  audio.stop();
  awayAtStart = false;
  setPhase('issuing');
  ui.wait('기록 준비 중…');
  let settled = false;
  const go = (run: Issued | null, why: string) => {
    if (settled || ticket !== starting || phase !== 'issuing') return;
    settled = true;
    begin(run, why);
  };
  const issue: Promise<Issued> = shared
    ? online.mapStart(shared).then((r) => {
        const map = parseMap(r.json).map;
        if (!map) throw new Refusal('이 맵을 열 수 없습니다.');
        return { runId: r.runId, map };
      })
    : online.start();
  issue.then((r) => go(r, ''), (e) => go(null, errorText(e)));
  setTimeout(() => go(null, '온라인 응답이 늦어 이번 판은 순위에 오르지 않습니다.'), START_WAIT);
}

/** What the server issued: a city's seed, or a published map as it is now. */
interface Issued { runId: string; seed?: number; seeds?: number[]; map?: GameMap }

function begin(run: Issued | null, why: string): void {
  const away = phase === 'issuing' && awayAtStart;
  ui.wait('');
  ranked = run && { runId: run.runId, recorder: new Recorder(), map: mode.kind === 'map' };
  if (!testing) track('run_start', { mode: mode.kind === 'map' ? 'map' : run ? 'ranked' : 'guest' });
  // The content the server fixed this run to is the one played.
  if (mode.kind === 'map' && run?.map) mode = { ...mode, map: run.map };
  ui.onlineNote(why);
  unrankedNote = why;
  const c = run?.seeds ? { runId: run.runId, seeds: [...run.seeds], asking: false, lastAsk: 0, startedAt: performance.now() } : null;
  city = c;
  game = mode.kind === 'map' ? new Game(buildCourse(mode.map))
    : c ? new Game((k) => c.seeds[k] ?? null)
    : new Game(run?.seed !== undefined ? run.seed : testing ? TEST_SEED : Math.floor(Math.random() * 2 ** 31));
  ui.homeLabel(mode.kind === 'endless' ? '타이틀로' : mode.from === 'editor' ? '편집기로' : '맵 목록으로');
  view.reset();
  acc = 0;
  heldAtPause = assistHold = false;
  input.release();
  ui.show(null);
  ui.count(null);
  ui.hud(true); ui.hint(true);
  if (unrankedNote) ui.wait(unrankedNote);
  setPhase('playing');
  audio.start();
  if (away) pause();
}

/** Asks for the next stretch seeds well before the city needs them. */
function feedSeeds(): void {
  const c = city, online = onlineUi.online;
  if (!c || !ranked || !online || c.asking || c.seeds.length * SEGMENT > game.player.x + 14000) return;
  const now = performance.now();
  if (now - c.lastAsk < 1500) return;
  c.asking = true; c.lastAsk = now;
  online.seeds(c.runId).then((s) => { if (s.length > c.seeds.length) c.seeds = s; }, () => {}).finally(() => { c.asking = false; });
}

/** Seconds of pausing left before the run can't be ranked any more; null when it isn't ranked. */
function pauseLeft(): number | null {
  if (!city || !ranked) return null;
  const used = (performance.now() - city.startedAt) / 1000 - game.time;
  return pauseAllowanceMs(game.time * 1000) / 1000 - used;
}

/** Ends ranking for this run, saying why, while it goes on. */
function unrank(why: string): void {
  ranked = null; city = null;
  unrankedNote = why;
  ui.onlineNote(why);
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
  if (updating) return;
  // A jump press made while falling must not skip the result.
  if (phase === 'result' && performance.now() - phaseAt < 450 && (a === 'restart' || a === 'home')) return;
  const s = save.data;
  switch (a) {
    case 'guest': firstVisit.dismiss(); title(); break;
    case 'signup': case 'login': case 'account':
      firstVisit.dismiss();
      ui.show('account'); onlineUi.openAccount(a === 'account' ? null : a === 'signup');
      requestAnimationFrame(() => document.getElementById(onlineUi.signedIn ? 'nick' : 'auth-id')?.focus({ preventScroll: true }));
      break;
    case 'logout': firstVisit.dismiss(); onlineUi.signOut(); break;
    case 'admin': ui.show('admin'); void adminUi.open(); break;
    case 'achievements': ui.show('achievements'); void achievements.open(); break;
    case 'shop': ui.show('shop'); void shop.open(); break;
    case 'daily': ui.show('daily'); void daily.open(); break;
    case 'start': mode = { kind: 'endless' }; startRun(); break;
    case 'restart': startRun(); break;
    case 'resume': resume(); break;
    case 'home': if (phase === 'title') title(); else leave(); break;
    case 'maps': openMaps(); break;
    case 'ranking': if (ui.screen === 'welcome') firstVisit.dismiss(); ui.show('ranking'); onlineUi.openRanking(); break;
    case 'newmap': openEditor(blankMap(), null); break;
    case 'import': mapScreen.pickFile(); break;
    case 'ed-save': saveMap(); break;
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
      mapScreen.tab('mine');
      break;
    case 'settings': case 'credits': case 'items': case 'notes': returnTo = ui.screen ?? 'title'; ui.show(a); break;
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
  playShared: (map, shared) => playMap(map, null, 'maps', shared),
  times: (shared) => { ui.show('maptimes'); onlineUi.openTimes(shared); },
});
addEventListener('beforeunload', (event) => {
  if (!updating && (editor.dirty || onlineUi.online?.pending())) {
    event.preventDefault(); event.returnValue = '';
  }
});
mapScreen.onRefresh = () => onlineUi.refreshMaps();
onlineUi.myCards = () => mapScreen.cards;
const adminUi = new AdminScreen(() => onlineUi.online);
const connected = () => onlineUi.online ?? (() => { throw new Refusal('온라인 연결 뒤에 보여요.'); })();
const shop = new ShopView(() => onlineUi.online, () => onlineUi.signedIn, (id) => view.setCostume(id));
const daily = new DailyView(() => onlineUi.online, () => onlineUi.signedIn, () => {});
const achievements = new AchievementView(document.getElementById('achievement-view')!, {
  catalog: async () => connected().catalog(),
  equip: async (id) => connected().equip(id),
  equipBadge: async (id) => connected().equipBadge(id),
  signedIn: () => onlineUi.signedIn,
});
/** Who the achievements on screen belong to. */
let achiever = '';
/** Another account, or none: nothing of the last one stays, and an open page is read again. */
function syncAchievements(): void {
  const a = onlineUi.online?.account();
  const who = a ? `${a.status}|${a.nickname ?? ''}` : '';
  if (who === achiever) return;
  achiever = who;
  achievements.clear();
  // The runner wears what this account wears, or the courier's own.
  shop.clear();
  view.setCostume(null);
  if (a?.status === 'in') void onlineUi.online?.shop().then((s) => { if (s && achiever === who) view.setCostume(s.costume); }, () => {});
  void daily.refreshChip();
  if (ui.screen === 'achievements') void achievements.open();
}

/** Hands a finished ranked run in; the result screen says how it went. */
function submitRun(): void {
  const run = ranked, online = onlineUi.online;
  ranked = null;
  if (!run || !online) return;
  const at = ++starting;
  const say = (t: string) => { if (at === starting) ui.onlineNote(t); };
  if (run.map) {
    if (!game.finished) { say('완주해야 기록이 등록돼요.'); return; }
    say('기록을 등록하는 중…');
    online.mapFinish(run.runId, run.recorder.text()).then(
      (r) => {
        say(r.best ? `${timeText(r.timeMs)} 내 최단 기록을 등록했어요!` : '내 최단 기록에는 못 미쳤어요.');
        if (ui.screen === 'maptimes') void onlineUi.refreshTimes();
      },
      (e) => say(errorText(e)),
    );
    return;
  }
  ui.onlineNote('순위에 등록하는 중…');
  online.finish(run.runId, run.recorder.text()).then(
    (r) => {
      const paid = r.coins ? ` · 코인 +${r.coins.toLocaleString('ko-KR')}` : '';
      const missions = r.daily.map((d) => ` · 미션 「${d.text}」 완료 +${d.reward.toLocaleString('ko-KR')}`).join('');
      const line = (r.best ? `이번 주 최고 기록 ${r.score.toLocaleString('ko-KR')}점 등록!` : '이번 주 최고 기록에는 못 미쳤어요') + paid + missions;
      void daily.refreshChip();
      say(line);
      // Where that leaves the player this week, right on the result.
      online.board(weekKey(online.now())).then((b) => {
        if (b.mine?.rank) say(`${line} · 이번 주 ${b.mine.rank}위`);
        else if (b.mine) say(`${line} · 이번 주 1000위 밖`);
      }, () => {});
      // The ranking may already be open from the result screen, showing the board from before this run.
      void onlineUi.refreshBoard();
    },
    (e) => say(errorText(e)),
  );
}

ui.onAct = (a) => { if (!testing) act(a); };
input.locked = testing;
input.onMenu = (a) => ui.menu(a);
input.onGesture = () => audio.unlock();
input.onMute = () => act('mute');
input.onEscape = () => {
  if (updating) return false;
  if (phase === 'playing' || phase === 'countdown') { pause(); return true; }
  if (ui.screen === 'achievements' && achievements.back()) return true;
  // The title has nowhere further back to go.
  return ui.screen !== null && ui.screen !== 'title' && ui.menu('back');
};
input.onPause = () => {
  if (updating) return;
  if (phase === 'playing' || phase === 'countdown') pause();
  else if (ui.screen === 'settings' || ui.screen === 'credits' || ui.screen === 'items' || ui.screen === 'notes') act('back');
  else if (phase === 'paused') act('resume');
  else if (phase === 'title' && ui.screen === 'title') act('start');
  else if (phase === 'result') act('restart');
};
input.onDevice = () => ui.setDevice(input.device);
input.onBlur = () => { if (phase === 'issuing') awayAtStart = true; else pause(); };
ui.setDevice(input.device);
document.getElementById('btn-pause')!.addEventListener('click', () => { if (!testing) pause(); });
// On the press, not the click: a slide is timed.
document.getElementById('btn-slide')!.addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressSlide(); });

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
    case 'slide': audio.play('land'); break;
    case 'dive': audio.play('air'); break;
    case 'smash': audio.play('stomp'); input.rumble(60, 0.4); break;
    case 'dodge': audio.play('risk'); break;
    case 'breakin': audio.play('shield'); input.rumble(110, 0.6); break;
    case 'escape': audio.play('risk'); break;
    case 'power': audio.play(e.kind === 'boost' ? e.kind : 'power'); break;
    case 'shielded': audio.play('shield'); input.rumble(90, 0.5); break;
    case 'mission': audio.play('mission'); break;
    case 'speedup': audio.play('up'); break;
    case 'roadExit': audio.play('risk'); break;
    case 'fever': audio.play('fever'); input.rumble(80, 0.4); break;
    case 'comboSaved': audio.play('save'); input.rumble(90, 0.5); break;
    case 'saveGained': audio.play('save'); break;
    case 'comboCash': audio.play('mission'); break;
    case 'lap': audio.play('lap'); break;
    case 'splash': audio.play('splash'); break;
    case 'crumble': audio.play('crumble'); input.rumble(140, 0.6); break;
    case 'rush': audio.play('rush'); break;
    case 'hooked': audio.play('hook'); input.rumble(100, 0.5); break;
    case 'goal':
      audio.stop();
      audio.play('goal');
      setPhase('dying');
      break;
    case 'perfectBonus': audio.play('perfect'); break;
    case 'risk': audio.play('risk'); break;
    case 'stumble': audio.play('stumble'); input.rumble(120, 0.5); break;
    case 'wall': audio.play('stumble'); input.rumble(160, 0.7); break;
    case 'trafficHit':
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
  return { pressed, held: input.held || assistHold, slide: input.takeSlide() };
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
      feedSeeds();
      // A tick each half second while a combo's clock is about to run out.
      if (ui.danger(game) && Math.floor(game.time * 2) !== warnTick) { warnTick = Math.floor(game.time * 2); audio.play('warn'); }
      if (city && 'fallback' in game.world && game.world.fallback) unrank('연결이 늦어 이번 판은 순위에 오르지 않습니다.');
      if (game.distance > (unrankedNote ? 150 : 30)) ui.hint(false);
      ui.update(game, input.held || assistHold);
      break;
    case 'paused': {
      const left = pauseLeft();
      if (left !== null && left <= 0) unrank('일시정지가 길어 이번 판은 순위에 오르지 않습니다.');
      ui.pauseNote(left === null ? (unrankedNote && mode.kind === 'endless' ? unrankedNote : '') : `순위 기록 중 · 일시정지 여유 ${Math.ceil(left)}초`);
      break;
    }
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
        if (mode.kind === 'map' && mode.shared) ui.bestNote(game.finished ? `완주 시간 ${timeText(timeOf(Math.round(game.time / STEP)))}` : '완주하지 못했어요');
        submitRun();
      }
      break;
  }
  if (phase === 'editor') { editor.draw(dt); return; }
  audio.tempo = (1 + Math.min(0.25, (game.level - 1) * 0.022)) * (game.player.boostTime > 0 ? 1.12 : 1);
  audio.night = view.nightAt(game.distance);
  audio.mood = phase === 'title' ? 'none' : game.lapEvent;
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
  import('./online/island').then((m) => {
    const online = m.connect(url);
    onlineUi.attach(online);
    online.onAccount(() => { syncEntry(); syncAchievements(); if (online.account().status !== 'loading') uncover(); });
    syncEntry(); syncAchievements();
    if (online.account().status !== 'loading') uncover();
  }, () => { onlineUi.connecting = false; onlineUi.refresh(); uncover(); });
}

function offerUpdate(version: string): void {
  reloadSoon('updated', version, '새 버전이 도착했어요', '지금 업데이트', (seconds, wasRunning) => `${seconds}초 뒤 새 버전으로 자동 새로고침합니다. 주간 기록은 유지됩니다.${wasRunning ? ' 진행 중인 판은 종료되며 순위에 등록되지 않습니다.' : ''} 저장된 맵과 로그인은 유지됩니다.`);
}

/** Tells the player why the page is about to reload, then does: saving an editor draft first, as an update does. */
function reloadSoon(param: string, value: string, heading: string, action: string, say: (seconds: number, wasRunning: boolean) => string): void {
  if (updating) return;
  document.getElementById('update-title')!.textContent = heading;
  document.getElementById('update-now')!.textContent = action;
  updating = true;
  const wasRunning = phase === 'playing' || phase === 'countdown' || phase === 'issuing' || phase === 'paused';
  starting++; ranked = null;
  pause(); input.release(); input.locked = true; audio.stop();
  if (phase === 'issuing') setPhase('paused');
  const notice = document.getElementById('update-notice')!;
  const message = document.getElementById('update-message')!;
  const now = document.getElementById('update-now') as HTMLButtonElement;
  const exportMap = document.getElementById('update-export') as HTMLButtonElement;
  let safe = true;
  if (phase === 'editor' && editor.dirty) {
    editor.flush();
    // Keep the draft, including invalid courses, without ever overwriting an unrelated map.
    safe = saveMap() && maps.available;
    exportMap.hidden = safe;
  }
  notice.hidden = false;
  const reload = () => {
    const next = new URL(location.href); next.searchParams.set(param, value);
    location.replace(next.href);
  };
  now.onclick = reload;
  exportMap.onclick = () => { downloadMap(editor.map); reload(); };
  if (!safe) {
    message.textContent = '새 버전을 적용하려면 새로고침이 필요합니다. 편집 중인 맵을 파일로 보관한 뒤 업데이트해 주세요.';
    now.hidden = true; exportMap.focus(); return;
  }
  let seconds = 5;
  const text = () => { message.textContent = say(seconds, wasRunning); };
  text(); now.focus();
  const timer = setInterval(() => { seconds--; text(); if (seconds <= 0) { clearInterval(timer); reload(); } }, 1000);
}
if (!testing && import.meta.env.PROD) watchReleases(__RELEASE_ID__, offerUpdate);

/**
 * Monday 00:00 in Korea starts a new weekly board: everyone online is told and their page starts afresh, so no
 * one keeps last week's board. A run under way is finished and handed in first; the server's clock decides.
 */
let weekEnds = 0;
if (!testing) setInterval(() => {
  const online = onlineUi.online;
  if (!online || updating) return;
  const now = online.now();
  if (!weekEnds) { weekEnds = weekEnd(now); return; }
  if (now < weekEnds) return;
  const busy = phase === 'playing' || phase === 'countdown' || phase === 'paused' || phase === 'issuing' || phase === 'dying' || online.pending();
  if (busy) return;
  reloadSoon('week', weekKey(now), '새 주간 순위 시작!', '지금 새로고침', (seconds) => `새 주간 순위가 시작됐어요! ${seconds}초 뒤 새로고침합니다. 지난주 기록은 지난주 순위에 그대로 남아요.`);
}, 1000);
// Building numbers are painted once, so wait briefly for the font.
Promise.race([document.fonts.load('11px Galmuri11', '동점'), new Promise((r) => setTimeout(r, 1500))])
  .catch(() => {})
  .finally(() => {
    title(); booted = true; syncEntry(); requestAnimationFrame(frame);
    // Without an online service, or once its account is known, there is nothing left to change.
    const known = onlineUi.online && onlineUi.online.account().status !== 'loading';
    if (!url || known || coverExpired) uncover();
  });
