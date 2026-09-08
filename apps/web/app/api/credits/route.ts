import { NextResponse } from 'next/server';

import { generationRuntime } from '../../../lib/generation-runtime';
import { handleRouteError } from '../../../lib/http';
import { requireSession } from '../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const { runtime } = await generationRuntime();
    const account = await runtime.credits.getOrCreateBalance(await requireSession());
    return NextResponse.json(
      { balance: account.balance },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
