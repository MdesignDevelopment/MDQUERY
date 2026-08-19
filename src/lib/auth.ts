import { createHash, createHmac, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { query } from './db';
import type { User } from './types';

/**
 * Session auth: the mdq_session cookie carries an opaque random token; the
 * server holds a hash of it in the `sessions` table. Identity is established
 * exclusively via "Sign in with MD Portal" (src/app/api/auth/mdportal/*) —
 * this app never stores or checks a password of its own. Storing a hash of
 * the token (never the token itself) means logout can revoke the session
 * with a single UPDATE, which isn't possible at all with a plain
 * signed-value cookie short of rotating the app-wide secret.
 */

// In production (Vercel, or the Docker prod compose) a real secret is required —
// the insecure dev fallback would let anyone forge a session cookie otherwise.
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET must be set in production (see .env.example).');
}
const SECRET = process.env.SESSION_SECRET ?? 'dev-secret';
const COOKIE = 'mdq_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Exported for reuse by the MD Portal SSO transaction cookie (see
// src/app/api/auth/mdportal/*), which needs a "signed opaque value"
// primitive for a different payload than the session token.
export function sign(value: string): string {
  return createHmac('sha256', SECRET).update(value).digest('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Create a new session for a user; returns the raw token to put in the cookie. */
export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, new Date(Date.now() + SESSION_TTL_MS)],
  );
  return token;
}

/** Revoke the session behind a raw cookie token (logout). No-op if already gone. */
export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [hashToken(token)]);
}

export const SESSION_COOKIE = COOKIE;

// Session micro-cache: every API call authenticates, so avoid re-reading the
// user row on each one. 15s TTL keeps role changes/deactivation/revocation
// near-instant. Keyed by token hash (not user id) since a user can hold
// multiple valid sessions at once.
const USER_TTL_MS = 15_000;
const sessionCache: Map<string, { u: User; at: number }> =
  ((globalThis as any).__mdqSessionCache ??= new Map());

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const hit = sessionCache.get(tokenHash);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.u;
  const { rows } = await query<User>(
    `SELECT u.id, u.email, u.name, u.role, u.department
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active`,
    [tokenHash],
  );
  const u = rows[0] ?? null;
  if (u) sessionCache.set(tokenHash, { u, at: Date.now() });
  else sessionCache.delete(tokenHash);
  return u;
}

/** Drop a user's cached sessions (call after role/active/name changes). */
export function invalidateUserCache(id: number): void {
  for (const [tokenHash, entry] of sessionCache) {
    if (entry.u.id === id) sessionCache.delete(tokenHash);
  }
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AuthError('Not signed in', 401);
  return u;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export function isCuratorOrAdmin(u: User): boolean {
  return u.role === 'curator' || u.role === 'admin';
}

/** Who may act as a peer reviewer on promotion/update requests (§2.1). */
export function canReview(u: User): boolean {
  return isCuratorOrAdmin(u) || u.department === 'Support';
}
