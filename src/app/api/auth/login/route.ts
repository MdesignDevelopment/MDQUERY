import { NextResponse } from 'next/server';
import { makeSessionValue, SESSION_COOKIE, verifyPassword } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: Request) {
  const { email, password } = await req.json();
  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  const { rows } = await query(
    'SELECT id, password_hash, active FROM users WHERE lower(email) = lower($1)',
    [email.trim()],
  );
  const user = rows[0];
  // Same message for unknown email / wrong password / deactivated — no account probing
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, makeSessionValue(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
