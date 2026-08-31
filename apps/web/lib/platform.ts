import { cookies } from 'next/headers';

import { operationalCapability, parseServerEnvironment } from '@let-it-be/config';
import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import {
  AssetService,
  CatalogSyncService,
  CommerceService,
  createFulfillmentAdapter,
  FakePaymentService,
  FakeTaxService,
  FulfillmentAdminService,
  FulfillmentRoutingService,
  IdentityService,
  MockupService,
  OrderOperationsService,
  CxOperationsService,
  LifecycleOrchestrator,
  KlaviyoLifecycleMessagingService,
  FakeLifecycleMessagingService,
  ProjectService,
  StripePaymentService,
  StripeTaxService,
  type ActiveSession,
} from '@let-it-be/domain';

import { generationRuntime } from './generation-runtime';

const sessionCookieName = 'let_it_be_session';

declare global {
  var letItBePool: SqlPool | undefined;
}

export function databasePool(): SqlPool {
  if (!globalThis.letItBePool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for application requests.');
    globalThis.letItBePool = createDatabaseClient(connectionString).pool;
  }
  return globalThis.letItBePool;
}

export function services() {
  const pool = databasePool();
  const lifecycle = lifecycleRuntime(pool);
  return {
    identity: new IdentityService(pool, lifecycle),
    projects: new ProjectService(pool, {}, lifecycle),
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

export async function commerceRuntime() {
  const environment = parseServerEnvironment(process.env);
  const pool = databasePool();
  const fulfillment = createFulfillmentAdapter({
    adapter: environment.FULFILLMENT_ADAPTER,
    baseUrl: environment.PRINTIFY_API_BASE_URL,
    ...(environment.PRINTIFY_API_TOKEN ? { apiToken: environment.PRINTIFY_API_TOKEN } : {}),
    ...(environment.PRINTIFY_SHOP_ID ? { shopId: environment.PRINTIFY_SHOP_ID } : {}),
    ...(environment.PRINTIFY_WEBHOOK_SECRET
      ? { webhookSecret: environment.PRINTIFY_WEBHOOK_SECRET }
      : {}),
  });
  const payments =
    environment.PAYMENT_ADAPTER === 'stripe'
      ? new StripePaymentService(
          environment.STRIPE_SECRET_KEY!,
          environment.STRIPE_WEBHOOK_SECRET!,
          environment.STRIPE_API_BASE_URL,
        )
      : new FakePaymentService();
  const { storage } = await generationRuntime();
  return new CommerceService(
    pool,
    payments,
    environment.TAX_ADAPTER === 'stripe'
      ? new StripeTaxService(environment.STRIPE_SECRET_KEY!, environment.STRIPE_API_BASE_URL)
      : new FakeTaxService(environment.DEVELOPMENT_TAX_RATE_BASIS_POINTS),
    fulfillment,
    new MockupService(pool, storage),
    undefined,
    lifecycleRuntime(pool, environment),
  );
}

export function cxOperationsRuntime() {
  const environment = parseServerEnvironment(process.env);
  const payments =
    environment.PAYMENT_ADAPTER === 'stripe'
      ? new StripePaymentService(
          environment.STRIPE_SECRET_KEY!,
          environment.STRIPE_WEBHOOK_SECRET!,
          environment.STRIPE_API_BASE_URL,
        )
      : new FakePaymentService();
  return new CxOperationsService(databasePool(), payments);
}

/** Trusted post-payment workflow runtime. Payment routes intentionally do not call this. */
export async function orderOperationsRuntime() {
  const environment = parseServerEnvironment(process.env);
  const pool = databasePool();
  const fulfillment = createFulfillmentAdapter({
    adapter: environment.FULFILLMENT_ADAPTER,
    baseUrl: environment.PRINTIFY_API_BASE_URL,
    ...(environment.PRINTIFY_API_TOKEN ? { apiToken: environment.PRINTIFY_API_TOKEN } : {}),
    ...(environment.PRINTIFY_SHOP_ID ? { shopId: environment.PRINTIFY_SHOP_ID } : {}),
    ...(environment.PRINTIFY_WEBHOOK_SECRET
      ? { webhookSecret: environment.PRINTIFY_WEBHOOK_SECRET }
      : {}),
  });
  const { storage } = await generationRuntime();
  return new OrderOperationsService(
    pool,
    storage,
    fulfillment,
    {
      fulfillmentAdapter: environment.FULFILLMENT_ADAPTER,
      realProductionSubmissionEnabled: operationalCapability(environment, 'PRODUCTION_SUBMISSION')
        .enabled,
    },
    undefined,
    lifecycleRuntime(pool, environment),
  );
}

function lifecycleRuntime(pool: SqlPool, parsed?: ReturnType<typeof parseServerEnvironment>) {
  const environment = parsed ?? parseServerEnvironment(process.env);
  const messaging =
    environment.LIFECYCLE_ADAPTER === 'klaviyo'
      ? new KlaviyoLifecycleMessagingService(
          environment.KLAVIYO_API_KEY!,
          environment.KLAVIYO_API_BASE_URL,
        )
      : new FakeLifecycleMessagingService();
  return new LifecycleOrchestrator(
    pool,
    messaging,
    environment.LIFECYCLE_ADAPTER === 'klaviyo' ? 'KLAVIYO' : 'FAKE',
    operationalCapability(environment, 'LIFECYCLE_MARKETING').enabled,
  );
}

export async function requireSession(createGuest = true): Promise<ActiveSession> {
  const store = await cookies();
  const token = store.get(sessionCookieName)?.value;
  const identity = services().identity;
  const existing = token ? await identity.getSession(token) : null;
  if (existing) return existing;
  if (!createGuest) throw new Error('Authentication is required.');

  const created = await identity.createGuestSession();
  setSessionCookie(store, created.token);
  return {
    id: created.id,
    userId: created.userId,
    kind: created.kind,
    expiresAt: created.expiresAt,
  };
}

export function setSessionCookie(store: Awaited<ReturnType<typeof cookies>>, token: string): void {
  store.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure:
      process.env.SESSION_COOKIE_SECURE === 'true' ||
      process.env.NODE_ENV === 'production' ||
      process.env.APP_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSessionCookie(store: Awaited<ReturnType<typeof cookies>>): void {
  store.set(sessionCookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure:
      process.env.SESSION_COOKIE_SECURE === 'true' ||
      process.env.NODE_ENV === 'production' ||
      process.env.APP_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
