// Registers the game's own password component (convex/components/authPassword) with convex-test, the way Convex
// Auth's registerPassword does for its own: the real component code runs, with its nested rate limiter.
import { register as registerRateLimiter } from '@convex-dev/rate-limiter/test';
import type { TestConvex } from 'convex-test';
import type { GenericSchema, SchemaDefinition } from 'convex/server';
import schema from '../convex/components/authPassword/schema';

const modules = import.meta.glob('../convex/components/authPassword/**/*.ts');

export function registerPassword(t: TestConvex<SchemaDefinition<GenericSchema, boolean>>, name = 'authPassword') {
  t.registerComponent(name, schema, modules);
  registerRateLimiter(t, `${name}/rateLimiter`);
}
