import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const internalApi: any = internal;
const crons = cronJobs();

crons.interval(
  "remove expired administrator sessions",
  { minutes: 5 },
  internalApi.adminAuthMaintenance.cleanupExpiredSessions,
);

crons.interval(
  "release expired Stripe Checkout reservations",
  { minutes: 5 },
  internalApi.paymentRecords.expirePendingCheckouts,
);

export default crons;
