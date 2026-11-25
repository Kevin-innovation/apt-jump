import authPassword from '@convex-dev/auth/components/password/convex.config.js';
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
