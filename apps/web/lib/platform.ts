import { cookies } from 'next/headers';

import { parseServerEnvironment } from '@let-it-be/config';
import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import {
  AssetService,
  CatalogSyncService,
  createFulfillmentAdapter,
  FulfillmentAdminService,
  FulfillmentRoutingService,
  IdentityService,
  ProjectService,
  type ActiveSession,
} from '@let-it-be/domain';

const sessionCookieName = 'let_it_be_session';

declare global {
  var letItBePool: SqlPool | undefined;
}

function databasePool(): SqlPool {
  if (!globalThis.letItBePool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for application requests.');
    globalThis.letItBePool = createDatabaseClient(connectionString).pool;
  }
  return globalThis.letItBePool;
}

export function services() {
  const pool = databasePool();
  return {
    identity: new IdentityService(pool),
    projects: new ProjectService(pool),
    assets: new AssetService(pool),
    fulfillmentAdmin: new FulfillmentAdminService(pool),
    pool,
  };
}

export function fulfillmentRuntime() {
  const environment = parseServerEnvironment(process.env);
  const pool = databasePool();
  const adapter = createFulfillmentAdapter({
    adapter: environment.FULFILLMENT_ADAPTER,
    baseUrl: environment.PRINTIFY_API_BASE_URL,
    ...(environment.PRINTIFY_API_TOKEN ? { apiToken: environment.PRINTIFY_API_TOKEN } : {}),
    ...(environment.PRINTIFY_SHOP_ID ? { shopId: environment.PRINTIFY_SHOP_ID } : {}),
    ...(environment.PRINTIFY_WEBHOOK_SECRET
      ? { webhookSecret: environment.PRINTIFY_WEBHOOK_SECRET }
      : {}),
  });
  return {
    catalogSync: new CatalogSyncService(pool, adapter),
    routing: new FulfillmentRoutingService(pool, adapter),
  };
}

export async function requireSession(createGuest = true): Promise<ActiveSession> {
  const store = await cookies();
  const token = store.get(sessionCookieName)?.value;
  const identity = services().identity;
  const existing = token ? await identity.getSession(token) : null;
  if (existing) return existing;
  if (!createGuest) throw new Error('Authentication is required.');

  const created = await identity.createGuestSession();
  store.set(sessionCookieName, created.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return {
    id: created.id,
    userId: created.userId,
    kind: created.kind,
    expiresAt: created.expiresAt,
  };
}
