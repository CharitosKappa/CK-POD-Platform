import { Suspense } from 'react';

import { EditorClient } from './editor-client';

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <main>
          <p role="status">Loading your editor…</p>
        </main>
      }
    >
      <EditorClient />
    </Suspense>
  );
}
