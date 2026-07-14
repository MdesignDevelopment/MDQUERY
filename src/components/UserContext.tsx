'use client';

import { createContext, useContext } from 'react';
import type { User } from '@/lib/types';

/**
 * The signed-in user, resolved once server-side in the (app) layout and shared
 * with all client pages — so navigating between pages never blocks on another
 * auth/DB round trip. API routes still enforce auth on every request.
 */
const Ctx = createContext<User | null>(null);

export function UserProvider({ user, children }: { user: User; children: React.ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export function useUser(): User {
  const u = useContext(Ctx);
  if (!u) throw new Error('useUser must be used inside the signed-in app layout');
  return u;
}
