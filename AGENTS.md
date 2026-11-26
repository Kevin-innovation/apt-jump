# AGENTS.md — 아파트 점프 (apt-jump)

This file overrides the parent folder's SKYWARD/flight instructions for this repository only. The parent documents stay as they are.

## Roles (Herdr, hc)

| Who | Role |
| --- | --- |
| Codex | Orchestrates, reviews, integrates, and does the final verification (browser, build, deploy checks). |
| Claude Code | Main developer. |
| OpenCode | Sub-developer, working in parallel in its own git worktree and branch. |

- One writer per working tree. Parallel writers use separate worktrees and branches, with file scopes agreed by Codex.
- Keep testing small: run the tests the change needs, plus typecheck and build once. No repeated full-suite runs.
- Find terminal addresses with `hc ls`. Never assume fixed IDs: the old `t4`/`t1` addresses in parent docs are obsolete.
- Report to the supervisor address given in each task with `hc send`. Long reports go in `CLAUDE_REPORT.md`, and only the path is sent.
- No subagents unless the orchestrator assigns them. A review-only task authorizes no edits, commits, pushes or deploys.
- Stop only processes/terminals you started, by exact id.

## Branches

- `main` is production. Work happens on `apt-jump/*` branches (for example `apt-jump/fix-ranking-auth`).
- `feature/flight-combat` is an old name that doesn't fit this game. Keep it, and don't delete it.
- No commit, push, merge or deploy without the user's explicit approval, passed on by Codex. Never force push.

## Deploying

- The user chose Vercel (frontend, <https://apt-jump-wine.vercel.app>) plus Convex production (`honorable-guanaco-452`). That choice takes precedence over Patch as the default host for this game.
- Deploy both together: Convex functions first (or at the same time), then Vercel. A web-only deploy calls functions the server doesn't have, and runs stop being saved.
- Patches, deploys and difficulty changes keep the weekly leaderboard. It starts afresh only on Monday 00:00 KST (user requirement, replacing the earlier reset-on-deploy rule). Never delete score rows. See `DEVELOPMENT.md`.

## Patch

- Keep Patch toolbox-first: search Patch's toolbox and asset library before making or fetching anything the game needs.
- Patch publishing isn't planned right now. Don't publish (`pch publish`) without the user's explicit instruction.

## Commands

```sh
npm install
npm test          # vitest, including the real Convex Auth flows in convex-test
npm run build     # tsc + vite build to dist/
npx tsc --noEmit -p convex
```
