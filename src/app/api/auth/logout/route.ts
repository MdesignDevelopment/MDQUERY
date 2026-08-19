import { NextRequest, NextResponse } from 'next/server';
import { revokeSession, SESSION_COOKIE } from '@/lib/auth';

export async function POST(req: NextRequest) {
  await revokeSession(req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}
