/** Pulsing placeholder bars shown while data is being fetched. */
export function SkeletonBar({ w = 'w-full', h = 'h-3' }: { w?: string; h?: string }) {
  return <span className={`inline-block ${w} ${h} animate-pulse rounded-sm bg-panel-2`} aria-hidden />;
}

export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-label="Loading" role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2 border-b border-edge px-3 py-2" style={{ opacity: 1 - i * 0.09 }}>
          <SkeletonBar w="w-3" />
          <SkeletonBar w="w-36" />
          <SkeletonBar w="w-64" />
          <span className="flex-1" />
          <SkeletonBar w="w-16" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonWorkspace() {
  return (
    <div className="flex h-full flex-col" aria-label="Loading" role="status">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-4 py-2">
        <SkeletonBar w="w-32" />
        <SkeletonBar w="w-20" />
        <span className="flex-1" />
        <SkeletonBar w="w-24" />
      </div>
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-4 py-2.5">
        <SkeletonBar w="w-44" h="h-5" />
        <SkeletonBar w="w-56" h="h-5" />
        <span className="flex-1" />
        <SkeletonBar w="w-40" h="h-5" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 space-y-2 bg-bg p-4">
          {Array.from({ length: 10 }, (_, i) => (
            <SkeletonBar key={i} w={['w-2/3', 'w-1/2', 'w-3/4', 'w-1/3', 'w-2/5'][i % 5]} />
          ))}
        </div>
        <div className="w-80 border-l border-edge bg-panel p-4">
          <SkeletonBar w="w-24" />
        </div>
      </div>
    </div>
  );
}
