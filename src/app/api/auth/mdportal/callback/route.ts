import { createRemoteJWKSet, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { createSession, SESSION_COOKIE, sign } from '@/lib/auth';
import { query } from '@/lib/db';

// "Sign in with MD Portal" (OIDC-lite SSO) — step 2 of 2, and the only way to
// sign in. Exchanges the code for MD Portal's id_token (server-to-server),
// verifies it, resolves or provisions the matching MdQuery account, and signs
// in via the same mdq_session cookie every other part of this app already
// expects — currentUser(), the (app) layout, and UserContext need zero
// changes, since they only ever look at the cookie + DB row.

export const dynamic = 'force-dynamic';

const TXN_COOKIE = 'mdq_oidc_txn';

interface Txn {
  state: string;
  codeVerifier: string;
}

function readTxnCookie(raw: string | undefined): Txn | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (sign(payload) !== sig) return null;

  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed.state !== 'string' || typeof parsed.codeVerifier !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

interface IdTokenClaims {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

// createRemoteJWKSet caches/refetches keys internally, so a module-level
// instance per issuer is the right lifetime — no need to rebuild it per request.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(issuer: string) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

function clearTxnCookie(res: NextResponse) {
  res.cookies.set(TXN_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const issuer = process.env.MD_PORTAL_ISSUER;
  // Where to actually send the token/JWKS requests, if different from the
  // public issuer identity — e.g. a container-network address in local dev,
  // or an internal load balancer in some deployments. Verification below
  // still checks claims against `issuer`, never against this address, so
  // this can never weaken what a valid token is allowed to say. Defaults to
  // `issuer` itself, which is correct for a normal single-URL deployment.
  const internalUrl = process.env.MD_PORTAL_INTERNAL_URL || issuer;
  const clientId = process.env.MD_PORTAL_CLIENT_ID;
  const clientSecret = process.env.MD_PORTAL_CLIENT_SECRET;
  const baseUrl = process.env.MDQUERY_BASE_URL;
  // Every redirect below is built from this configured base URL, never from
  // req.url: behind `next dev --hostname 0.0.0.0` (and likely behind most
  // reverse proxies in production) req.url resolves to a 0.0.0.0 address
  // that no browser can navigate to.
  if (!issuer || !clientId || !clientSecret || !baseUrl) {
    return NextResponse.redirect(new URL('/login?error=sso_not_configured', baseUrl ?? req.url));
  }

  const { searchParams } = req.nextUrl;

  // MD Portal's access-policy rejection (see the OidcClient registry) — a
  // uniform outcome every relying-party app handles identically, without
  // implementing its own allowlist.
  if (searchParams.get('error') === 'access_denied') {
    return clearTxnCookie(
      NextResponse.redirect(new URL('/login?error=sso_not_authorized', baseUrl)),
    );
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const fail = () =>
    clearTxnCookie(NextResponse.redirect(new URL('/login?error=sso_failed', baseUrl)));
  if (!code || !state) return fail();

  const txn = readTxnCookie(req.cookies.get(TXN_COOKIE)?.value);
  if (!txn || txn.state !== state) return fail();

  const tokenRes = await fetch(new URL('/oauth/token', internalUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      redirect_uri: `${baseUrl}/api/auth/mdportal/callback`,
      code_verifier: txn.codeVerifier,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenRes.ok) return fail();
  const { id_token: idToken } = (await tokenRes.json()) as { id_token: string };

  let claims: IdTokenClaims;
  try {
    const { payload } = await jwtVerify(idToken, getJwks(internalUrl), { issuer, audience: clientId });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.firstName !== 'string' ||
      typeof payload.lastName !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      return fail();
    }
    claims = {
      sub: payload.sub,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      role: payload.role,
    };
  } catch {
    return fail();
  }

  // Resolve by MD Portal's stable id first (every login after the first),
  // then by email (first-ever SSO login for this account, linking it for
  // next time), else provision a brand-new account at the lowest role tier.
  let user = (
    await query<{ id: number }>('SELECT id FROM users WHERE sso_subject = $1', [claims.sub])
  ).rows[0];

  if (!user) {
    const byEmail = (
      await query<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower($1)', [
        claims.email,
      ])
    ).rows[0];

    if (byEmail) {
      await query('UPDATE users SET sso_subject = $1 WHERE id = $2', [claims.sub, byEmail.id]);
      user = byEmail;
    } else {
      const name = `${claims.firstName} ${claims.lastName}`.trim() || claims.email;
      const created = await query<{ id: number }>(
        `INSERT INTO users (email, name, role, department, active, sso_subject)
         VALUES ($1, $2, 'user', 'Support', TRUE, $3) RETURNING id`,
        [claims.email, name, claims.sub],
      );
      user = created.rows[0];
    }
  }

  const res = NextResponse.redirect(new URL('/dictionary', baseUrl));
  res.cookies.set(SESSION_COOKIE, await createSession(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return clearTxnCookie(res);
}
