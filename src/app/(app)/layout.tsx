import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import Nav from '@/components/Nav';
import MonacoWarmup from '@/components/MonacoWarmup';
import { UserProvider } from '@/components/UserContext';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <UserProvider user={user}>
      <MonacoWarmup />
      <div className="flex h-screen overflow-hidden">
        <Nav user={user} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </UserProvider>
  );
}
