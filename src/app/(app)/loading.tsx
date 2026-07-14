import { SkeletonRows } from '@/components/Skeleton';

/** App Router loading boundary: paints immediately during any server-side wait. */
export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge bg-panel px-4 py-3">
        <span className="inline-block h-4 w-40 animate-pulse rounded-sm bg-panel-2" />
      </div>
      <SkeletonRows rows={10} />
    </div>
  );
}
