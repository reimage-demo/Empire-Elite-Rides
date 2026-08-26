import { internalMutation } from "./_generated/server";
import { SESSION_INACTIVITY_TIMEOUT_MS } from "./lib/sessionToken";

export const cleanupExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sessions = await ctx.db.query("adminSessions").collect();
    const expired = sessions.filter((session) => {
      const lastActiveAt = session.lastActiveAt ?? session.createdAt;
      return (
        session.expiresAt <= now ||
        now - lastActiveAt >= SESSION_INACTIVITY_TIMEOUT_MS
      );
    });
    for (const session of expired) await ctx.db.delete(session._id);
    return { removed: expired.length };
  },
});
