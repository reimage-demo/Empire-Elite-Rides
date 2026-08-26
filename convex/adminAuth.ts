import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  hashSessionToken,
  requireActiveSession,
  SESSION_ABSOLUTE_LIFETIME_MS,
} from "./lib/sessionToken";

const REQUIRED_ALGORITHM = "pbkdf2-hmac-sha256";
const MINIMUM_ITERATIONS = 600_000;
const DERIVED_KEY_BITS = 256;
const MAXIMUM_FAILED_ATTEMPTS = 4;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_KEY = "admin-login";
const encoder = new TextEncoder();

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("Administrator authentication is not configured.");
  return value;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function constantTimeBytesEqual(actual: Uint8Array, expected: Uint8Array): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

async function constantTimeTextEqual(actual: string, expected: string): Promise<boolean> {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return constantTimeBytesEqual(
    new Uint8Array(actualDigest),
    new Uint8Array(expectedDigest),
  );
}

async function verifyPassword(password: string): Promise<boolean> {
  const algorithm = requiredEnvironmentValue("ADMIN_PASSWORD_ALGORITHM");
  const iterations = Number(requiredEnvironmentValue("ADMIN_PASSWORD_ITERATIONS"));
  const salt = requiredEnvironmentValue("ADMIN_PASSWORD_SALT");
  const pepper = requiredEnvironmentValue("ADMIN_PASSWORD_PEPPER");
  const expectedHash = decodeBase64Url(requiredEnvironmentValue("ADMIN_PASSWORD_HASH"));

  if (
    algorithm !== REQUIRED_ALGORITHM ||
    !Number.isSafeInteger(iterations) ||
    iterations < MINIMUM_ITERATIONS ||
    expectedHash.length !== DERIVED_KEY_BITS / 8
  ) {
    throw new Error("Administrator authentication is not configured.");
  }

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${password.length}:${password}${pepper}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedHash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations,
    },
    passwordKey,
    DERIVED_KEY_BITS,
  );

  return constantTimeBytesEqual(new Uint8Array(derivedHash), expectedHash);
}

function createSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const login = mutation({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, { username, password }) => {
    const now = Date.now();
    const attemptRecord = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", LOGIN_RATE_LIMIT_KEY))
      .unique();
    const activeWindow =
      attemptRecord && now - attemptRecord.windowStartedAt < LOGIN_LOCKOUT_MS;
    if (activeWindow && attemptRecord.count >= MAXIMUM_FAILED_ATTEMPTS) {
      return { token: "", role: "" };
    }

    const expectedUsername = requiredEnvironmentValue("ADMIN_USERNAME");
    const [usernameMatches, passwordMatches] = await Promise.all([
      constantTimeTextEqual(username, expectedUsername),
      verifyPassword(password),
    ]);
    if (!usernameMatches || !passwordMatches) {
      if (!attemptRecord) {
        await ctx.db.insert("rateLimits", {
          key: LOGIN_RATE_LIMIT_KEY,
          windowStartedAt: now,
          count: 1,
        });
      } else if (!activeWindow) {
        await ctx.db.patch(attemptRecord._id, { windowStartedAt: now, count: 1 });
      } else {
        await ctx.db.patch(attemptRecord._id, { count: attemptRecord.count + 1 });
      }
      return { token: "", role: "" };
    }

    if (attemptRecord) await ctx.db.delete(attemptRecord._id);

    const configuredRole = process.env.ADMIN_ROLE;
    const role =
      configuredRole && ["owner", "admin", "manager", "dispatcher", "viewer"].includes(configuredRole)
        ? configuredRole
        : "owner";
    const token = createSessionToken();
    const tokenHash = await hashSessionToken(token);

    await ctx.db.insert("adminSessions", {
      tokenHash,
      username: expectedUsername,
      role,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + SESSION_ABSOLUTE_LIFETIME_MS,
    });
    return { token, role };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const tokenHash = await hashSessionToken(token);
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!session) return { invalidated: false };
    await ctx.db.delete(session._id);
    return { invalidated: true };
  },
});

export const touchSession = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireActiveSession(ctx, token);
    return { active: true };
  },
});
