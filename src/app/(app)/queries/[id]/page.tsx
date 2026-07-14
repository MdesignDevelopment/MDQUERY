'use client';

import { useParams } from 'next/navigation';
import { useUser } from '@/components/UserContext';
import QueryWorkspace from '@/components/QueryWorkspace';

/** Client page: renders instantly (skeleton) while the query loads — no server round trip on navigation. */
export default function QueryPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  return <QueryWorkspace id={Number(id)} user={user} />;
}
