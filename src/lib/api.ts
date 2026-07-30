import { NextResponse } from 'next/server';
import { AuthError, requireUser } from './auth';
import { HttpError } from './store';
import type { User } from './types';

type Ctx = { params: Promise<Record<string, string>> };

/** Wrap a route handler: auth, error mapping, JSON responses. */
export function handler(fn: (req: Request, user: User, params: Record<string, string>) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      const user = await requireUser();
      const params = ctx?.params ? await ctx.params : {};
      return await fn(req, user, params);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message, ...(typeof e.extra === 'object' ? e.extra : {}) }, { status: e.status });
      }
      if (e instanceof AuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      // Defense-in-depth: a raw Postgres constraint error (e.g. a genuine race
      // on a uniqueness check) should never surface as a bare "Internal error" —
      // translate the common ones into something the user can act on.
      const code = (e as { code?: string })?.code;
      if (code === '23505') {
        return NextResponse.json({ error: 'That value is already in use — someone (or another tab) saved the same thing first. Reload and try again.' }, { status: 409 });
      }
      if (code === '23503') {
        return NextResponse.json({ error: 'That references something that no longer exists — it may have just been deleted. Reload and try again.' }, { status: 409 });
      }
      console.error(e);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  };
}

export function json(data: unknown, status = 200): Response {
  return NextResponse.json(data, { status });
}

export function idParam(params: Record<string, string>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid id');
  return id;
}
