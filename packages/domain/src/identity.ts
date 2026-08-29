import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

const scrypt = promisify(scryptCallback);
const SESSION_TTL_DAYS = 7;

export type SessionKind = 'GUEST' | 'AUTHENTICATED';

export interface ActiveSession {
  id: string;
  userId: string | null;
  kind: SessionKind;
  expiresAt: Date;
}

export interface SessionWithToken extends ActiveSession {
  token: string;
}

interface SessionRow {
  id: string;
  user_id: string | null;
  session_kind: SessionKind;
  expires_at: Date;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

export class IdentityService {
  public constructor(private readonly pool: SqlPool) {}

  async createGuestSession(): Promise<SessionWithToken> {
    const token = randomBytes(32).toString('base64url');
    const result = await this.pool.query<SessionRow>(
      `INSERT INTO app.sessions (token_hash, session_kind, expires_at)
       VALUES ($1, 'GUEST', now() + ($2::text || ' days')::interval)
       RETURNING id, user_id, session_kind, expires_at`,
      [hashToken(token), String(SESSION_TTL_DAYS)],
    );
    const row = requireRow(result.rows[0], 'Could not create guest session.');

    return { id: row.id, userId: null, kind: row.session_kind, expiresAt: row.expires_at, token };
  }

  async getSession(token: string): Promise<ActiveSession | null> {
    const result = await this.pool.query<SessionRow>(
      `UPDATE app.sessions
       SET last_seen_at = now()
       WHERE token_hash = $1 AND expires_at > now()
       RETURNING id, user_id, session_kind, expires_at`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, userId: row.user_id, kind: row.session_kind, expiresAt: row.expires_at }
      : null;
  }

  async register(session: ActiveSession, email: string, password: string): Promise<ActiveSession> {
    validateCredentials(email, password);
    const normalizedEmail = email.trim().toLowerCase();

    return withTransaction(this.pool, async (client) => {
      const passwordHash = await hashPassword(password);
      const userResult = await client.query<UserRow>(
        `INSERT INTO app.users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email, password_hash`,
        [normalizedEmail, passwordHash],
      );
      const user = requireRow(userResult.rows[0], 'Could not create account.');
      return this.attachUserAndMigrate(client, session, user.id);
    });
  }

  async login(session: ActiveSession, email: string, password: string): Promise<ActiveSession> {
    const normalizedEmail = email.trim().toLowerCase();
    const userResult = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash FROM app.users WHERE email = $1',
      [normalizedEmail],
    );
    const user = userResult.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new Error('Invalid email or password.');
    }

    return withTransaction(this.pool, (client) =>
      this.attachUserAndMigrate(client, session, user.id),
    );
  }

  private async attachUserAndMigrate(
    client: SqlClient,
    session: ActiveSession,
    userId: string,
  ): Promise<ActiveSession> {
    await client.query(
      `UPDATE app.projects
       SET owner_type = 'USER', owner_user_id = $1, owner_session_id = NULL,
           expires_at = now() + interval '90 days', updated_at = now()
       WHERE owner_type = 'GUEST' AND owner_session_id = $2`,
      [userId, session.id],
    );
    const result = await client.query<SessionRow>(
      `UPDATE app.sessions
       SET user_id = $1, session_kind = 'AUTHENTICATED', last_seen_at = now()
       WHERE id = $2
       RETURNING id, user_id, session_kind, expires_at`,
      [userId, session.id],
    );
    const row = requireRow(result.rows[0], 'Could not establish authenticated session.');
    return { id: row.id, userId: row.user_id, kind: row.session_kind, expiresAt: row.expires_at };
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, encoded] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !encoded) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(encoded, 'base64url');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function validateCredentials(email: string, password: string): void {
  if (!/^\S+@\S+\.\S+$/.test(email.trim()) || password.length < 12) {
    throw new Error('Use a valid email and a password of at least 12 characters.');
  }
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}
