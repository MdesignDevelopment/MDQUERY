'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const SSO_ERROR_MESSAGES: Record<string, string> = {
  sso_failed: 'Sign-in with MD Portal failed. Please try again.',
  sso_not_authorized: "Your MD Portal account isn't authorized for MdQuery — contact an admin.",
  sso_not_configured: 'Sign-in with MD Portal is not set up on this deployment.',
};

function LoginForm() {
  const searchParams = useSearchParams();
  const ssoError = SSO_ERROR_MESSAGES[searchParams.get('error') ?? ''];

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
        {ssoError && (
          <div
            className="mb-3 rounded-sm border px-2 py-1.5 text-[11px]"
            style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)', background: 'rgba(241,76,76,.06)' }}
            role="alert"
          >
            {ssoError}
          </div>
        )}
        <a
          href="/api/auth/mdportal/start"
          className="btn btn-primary w-full justify-center py-1.5"
        >
          Sign in with MD Portal
        </a>
        <p className="mt-4 text-[10px] leading-relaxed text-ink-faint">
          Access is managed through your M.Design account. Contact an admin if you
          don&apos;t have one yet.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
