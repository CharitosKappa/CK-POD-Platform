import { NextResponse, type NextRequest } from 'next/server';

const externalWebhookPaths = new Set([
  '/api/payments/webhook',
  '/api/fulfillment/printify/webhook',
]);

/** Browser mutations require a same-origin request; signed provider webhooks use their own boundary. */
export function middleware(request: NextRequest): NextResponse | undefined {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  if (
    !request.nextUrl.pathname.startsWith('/api/') ||
    ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
    externalWebhookPaths.has(request.nextUrl.pathname)
  )
    return nextWithRequestId(requestId, request.headers);
  if (!hasTrustedBrowserOrigin(request.headers))
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  return nextWithRequestId(requestId, request.headers);
}

function nextWithRequestId(requestId: string, requestHeaders: Headers): NextResponse {
  const headers = new Headers(requestHeaders);
  headers.set('x-request-id', requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  return response;
}

export function hasTrustedBrowserOrigin(headers: Headers): boolean {
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const config = { matcher: ['/api/:path*'] };
