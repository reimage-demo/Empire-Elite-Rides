const encoder = new TextEncoder();

export const SESSION_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;

export async function hashSessionToken(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(token)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function requireActiveSession(ctx: any, token: string) {
  const tokenHash = await hashSessionToken(token);
  const session = await ctx.db
    .query("adminSessions")
    .withIndex("by_token_hash", (q: any) => q.eq("tokenHash", tokenHash))
    .unique();
  const now = Date.now();
  const lastActiveAt = session?.lastActiveAt ?? session?.createdAt;
  const expired =
    !session ||
    session.expiresAt <= now ||
    now - lastActiveAt >= SESSION_INACTIVITY_TIMEOUT_MS;

  if (expired) {
    if (session && typeof ctx.db.delete === "function") await ctx.db.delete(session._id);
    throw new Error("UNAUTHORIZED");
  }

  if (typeof ctx.db.patch === "function") {
    await ctx.db.patch(session._id, { lastActiveAt: now });
    return { ...session, lastActiveAt: now };
  }
  return session;
}
