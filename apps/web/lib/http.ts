import { NextResponse } from 'next/server';

import { ProjectConflictError } from '@let-it-be/domain';

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ProjectConflictError) {
    return NextResponse.json({ error: error.message, code: 'STALE_PROJECT' }, { status: 409 });
  }
  if (error instanceof Error && error.message === 'Project not found.') {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }
  if (error instanceof Error && error.message === 'Invalid email or password.') {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof Error && /valid email|password|unavailable/.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: 'Unable to complete this request.' }, { status: 500 });
}
