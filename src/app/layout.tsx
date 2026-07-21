import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'M.Design Query Dictionary',
  description: 'Centralized dictionary of SQL / PL/SQL queries — system of record, never an execution engine.',
  icons: { icon: '/logo.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('mdq-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
