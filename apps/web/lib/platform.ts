import { cookies } from 'next/headers';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { IdentityService, ProjectService, type ActiveSession } from '@let-it-be/domain';

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
  return { identity: new IdentityService(pool), projects: new ProjectService(pool), pool };
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
