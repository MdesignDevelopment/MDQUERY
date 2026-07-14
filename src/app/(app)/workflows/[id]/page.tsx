'use client';

import { useParams } from 'next/navigation';
import { useUser } from '@/components/UserContext';
import WorkflowWorkspace from '@/components/WorkflowWorkspace';

/** Client page: renders instantly (skeleton) while the workflow loads — no server round trip on navigation. */
export default function WorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  return <WorkflowWorkspace id={Number(id)} user={user} />;
}
