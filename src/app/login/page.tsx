'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (r.ok) {
      router.push('/dictionary');
      return;
    }
    setError((await r.json()).error ?? 'Sign-in failed.');
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-[380px] rounded-md border border-edge bg-panel p-6">
        <div className="mono text-xs font-semibold tracking-wide">
          MD<span className="text-[var(--accent-hi)]">/</span>QUERY
        </div>
        <h1 className="mb-1 text-lg font-semibold">Query Dictionary</h1>
        <p className="mb-5 text-xs text-ink-faint">
          System of record for SQL / PL/SQL.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs">
            <span className="mb-1 block text-ink-dim">Email</span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@mdesignsolutions.be"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-ink-dim">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
            />
          </label>
          {error && (
            <div className="rounded-sm border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)', background: 'rgba(241,76,76,.06)' }} role="alert">
              {error}
            </div>
          )}
          <button className="btn btn-primary w-full justify-center py-1.5" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-[10px] leading-relaxed text-ink-faint">
          Forgot your password? Ask an admin to reset it.
        </p>
      </div>
    </main>
  );
}
