import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
// Monday 00:05 in Korea (Sunday 15:05 UTC): pay the week that has just ended.
crons.weekly('pay weekly rewards', { dayOfWeek: 'sunday', hourUTC: 15, minuteUTC: 5 }, internal.rewards.payLastWeek, {});
export default crons;
