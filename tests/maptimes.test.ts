// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';
import { Bot } from '../src/bot';
import { Game } from '../src/game';
import { timeOf } from '../src/mapreplay';
import { buildCourse, PRACTICE, serializeMap, type GameMap } from '../src/maps';
import { Recorder, SIM_VERSION } from '../src/replay';

// Real sign-in is in auth.test.ts: here the caller's identity names the user row.
vi.mock('@convex-dev/auth/server', async (original) => ({
  ...(await original<object>()),
  getAuthUserId: async (ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) => (await ctx.auth.getUserIdentity())?.subject ?? null,
}));

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const NOW = Date.UTC(2026, 10, 25, 3);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  const player = async (nickname: string) => {
    const id = await t.run((ctx) => ctx.db.insert('users', { nickname, nickKey: nickname }));
    return { id, as: t.withIdentity({ subject: id }) };
  };
  const a = await player('에이'), b = await player('비이');
  const mapId = await a.as.mutation(api.maps.publish, { json: serializeMap(PRACTICE) });
  return { t, a, b, mapId };
}
/** The bot's run of a map, to wherever it ends. */
function play(map: GameMap) {
  const g = new Game(buildCourse(map)), bot = new Bot(), rec = new Recorder();
  while (!g.over && rec.steps < 100_000) { const j = bot.next(g); rec.add(j); g.step(j); g.drain(); }
  return { text: rec.text(), ms: timeOf(rec.steps), finished: g.finished };
}
const run = play(PRACTICE);
let clock = NOW;
const later = (ms: number) => vi.setSystemTime(clock += ms);
beforeEach(() => { clock = NOW; });

describe('map times', () => {
  it('saves a run that really finishes, once, and shows it by map', async () => {
    expect(run.finished).toBe(true);
    const { t, a, b, mapId } = await setup();
    await expect(t.mutation(api.maptimes.start, { mapId, version: SIM_VERSION })).rejects.toThrow('로그인');
    const { runId } = await b.as.mutation(api.maptimes.start, { mapId, version: SIM_VERSION });
    later(run.ms + 1000);
    expect(await b.as.action(api.maptimes.finish, { runId, replay: run.text })).toEqual({ timeMs: run.ms, best: true });
    await expect(b.as.action(api.maptimes.finish, { runId, replay: run.text })).rejects.toThrow('이미 제출');
    expect((await b.as.query(api.maptimes.board, { mapId }))!.mine).toEqual({ rank: 1, timeMs: run.ms });
    expect((await t.query(api.maptimes.board, { mapId }))!.top).toEqual([{ rank: 1, nickname: '비이', timeMs: run.ms, mine: false }]);
    expect((await a.as.query(api.maps.list, { order: 'new', paginationOpts: { numItems: 10, cursor: null } })).page[0]).toMatchObject({ best: run.ms, bestTied: 1 });
  });

  it('refuses unfinished, too quick and suspended submissions', async () => {
    const { t, b, mapId } = await setup();
    const start = () => b.as.mutation(api.maptimes.start, { mapId, version: SIM_VERSION });
    const one = await start();
    later(run.ms + 1000);
    await expect(b.as.action(api.maptimes.finish, { runId: one.runId, replay: 'A9' })).rejects.toThrow('확인되지 않는');
    const two = await start();
    later(Math.max(0, run.ms - 6000));
    await expect(b.as.action(api.maptimes.finish, { runId: two.runId, replay: run.text })).rejects.toThrow('확인되지 않는');
    const three = await start();
    later(run.ms + 1000);
    await t.run((ctx) => ctx.db.patch(b.id, { suspended: true }));
    await expect(b.as.action(api.maptimes.finish, { runId: three.runId, replay: run.text })).rejects.toThrow('정지된 계정');
    expect(await t.run((ctx) => ctx.db.query('mapTimes').collect())).toEqual([]);
  });

  it('keeps each map and each content of a map apart, deleting no time', async () => {
    const { t, a, b, mapId } = await setup();
    later(5000);
    const flat = structuredClone(PRACTICE);
    flat.title = '다른 맵';
    const other = await a.as.mutation(api.maps.publish, { json: serializeMap(flat) });
    const { runId } = await b.as.mutation(api.maptimes.start, { mapId, version: SIM_VERSION });
    // The map changes while the run is under way: the run still belongs to what was played.
    later(5000);
    const changed = structuredClone(PRACTICE);
    changed.pace.base += 1;
    await a.as.mutation(api.maps.update, { id: mapId, json: serializeMap(changed) });
    later(run.ms + 1000);
    await b.as.action(api.maptimes.finish, { runId, replay: run.text });
    expect((await t.query(api.maptimes.board, { mapId }))!.top).toEqual([]);
    expect((await t.query(api.maptimes.board, { mapId: other }))!.top).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('mapTimes').collect())).toHaveLength(1);
  });
});
