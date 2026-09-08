import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Password sign-in is no longer available. Request an email code instead.' },
    { status: 410 },
  );
}
