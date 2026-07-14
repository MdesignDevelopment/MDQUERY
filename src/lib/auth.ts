import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { query } from './db';
import type { User } from './types';

/**
 * Dev/session auth: signed cookie carrying the user id.
 * Production swap: SSO against the M.Design identity provider (OIDC via
 * NextAuth.js or Supabase Auth); role claims map onto users.role.
 */

const SECRET = process.env.SESSION_SECRET ?? 'dev-secret';
const COOKIE = 'mdq_session';

function sign(value: string): string {
  return createHmac('sha256', SECRET).update(value).digest('hex');
}

export function makeSessionValue(userId: number): string {
  const payload = String(userId);
  return `${payload}.${sign(payload)}`;
}

export function parseSessionValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const id = Number(payload);
  return Number.isInteger(id) ? id : null;
}

export const SESSION_COOKIE = COOKIE;

/** scrypt password hashing — no external deps; format "salt:hash" (hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && timingSafeEqual(expected, test);
}

// Session micro-cache: every API call authenticates, so avoid re-reading the
// user row on each one. 15s TTL keeps role changes/deactivation near-instant.
const USER_TTL_MS = 15_000;
const userCache: Map<number, { u: User; at: number }> =
  ((globalThis as any).__mdqUserCache ??= new Map());

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const id = parseSessionValue(store.get(COOKIE)?.value);
  if (id == null) return null;
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.u;
  const { rows } = await query<User>('SELECT id, email, name, role, department FROM users WHERE id = $1 AND active', [id]);
  const u = rows[0] ?? null;
  if (u) userCache.set(id, { u, at: Date.now() });
  else userCache.delete(id);
  return u;
}

/** Drop a user from the session cache (call after role/active/name changes). */
export function invalidateUserCache(id: number): void {
  userCache.delete(id);
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
