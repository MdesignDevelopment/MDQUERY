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
