// The game's copy of Convex Auth's password component, mounted under the same name (convex/components/authPassword).
import authPassword from './components/authPassword/convex.config.js';
import authUsername from '@convex-dev/auth/components/username/convex.config.js';
import auth from '@convex-dev/auth/convex.config.js';
import rateLimiter from '@convex-dev/rate-limiter/convex.config.js';
import { defineApp } from 'convex/server';

const app = defineApp();
app.use(auth);
app.use(authPassword);
app.use(authUsername);
app.use(rateLimiter);
export default app;
