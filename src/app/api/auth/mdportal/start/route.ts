import { createHash, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { sign } from '@/lib/auth';

// "Sign in with MD Portal" (OIDC-lite SSO) — step 1 of 2, and the ONLY way to
// sign in (this app has no local password login). Builds a PKCE pair + state,
// stashes them in a short-lived signed cookie, and sends the browser to MD
// Portal's /oauth/authorize.

export const dynamic = 'force-dynamic';

const TXN_COOKIE = 'mdq_oidc_txn';

export async function GET(req: NextRequest) {
  const issuer = process.env.MD_PORTAL_ISSUER;
  const clientId = process.env.MD_PORTAL_CLIENT_ID;
  const baseUrl = process.env.MDQUERY_BASE_URL;
  if (!issuer || !clientId || !baseUrl) {
    // No safe base URL to redirect to yet — this is the one case where
    // falling back to req.url is the least-bad option (a misconfigured
    // deployment with nowhere better to send the user).
    return NextResponse.redirect(new URL('/login?error=sso_not_configured', baseUrl ?? req.url));
  }

  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  // Own random values we set and read straight back — no need to trust their
  // shape, but the HMAC still guards against tampering/truncation in transit.
  const payload = JSON.stringify({ state, codeVerifier });
  const txnValue = `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;

  const authorizeUrl = new URL('/oauth/authorize', issuer);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', `${baseUrl}/api/auth/mdportal/callback`);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(TXN_COOKIE, txnValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10,
  });
  return res;
}
