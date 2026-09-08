import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

const SESSION_TTL_DAYS = 7;
const EMAIL_CODE_TTL_MS = 10 * 60_000;
const MAX_EMAIL_CODE_ATTEMPTS = 5;
const DEVELOPMENT_EMAIL_CODE_PEPPER =
  'local-development-email-code-pepper-change-before-production';

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
  email_verified_at: Date;
}

interface EmailLoginChallengeRow {
  id: string;
  code_hash: string;
  expires_at: Date;
  attempt_count: number;
}

export interface EmailCodeDelivery {
  deliver(input: { email: string; code: string; expiresAt: Date }): Promise<void>;
}

export interface IdentityServiceOptions {
  codeDelivery?: EmailCodeDelivery;
  codePepper?: string;
}

/** Local-only adapter. It intentionally writes the code only to the local server log. */
export class LocalEmailCodeDelivery implements EmailCodeDelivery {
  async deliver(input: { email: string; code: string; expiresAt: Date }): Promise<void> {
    console.info(
      JSON.stringify({
        event: 'development.email_login_code_delivered',
        email: input.email,
        code: input.code,
        expiresAt: input.expiresAt.toISOString(),
      }),
    );
  }
}

/** Deterministic adapter for tests; it never sends email or opens a network connection. */
export class InMemoryEmailCodeDelivery implements EmailCodeDelivery {
  public readonly deliveries: Array<{ email: string; code: string; expiresAt: Date }> = [];

  async deliver(input: { email: string; code: string; expiresAt: Date }): Promise<void> {
    this.deliveries.push(input);
  }

  latestCodeFor(email: string): string | undefined {
    const normalizedEmail = normalizeEmail(email);
    return [...this.deliveries].reverse().find((delivery) => delivery.email === normalizedEmail)
      ?.code;
  }
}

export class InvalidEmailCodeError extends Error {
  public constructor() {
    super('The code is invalid or has expired.');
  }
}

export class IdentityService {
  private readonly codeDelivery: EmailCodeDelivery;
  private readonly codePepper: string;

  public constructor(
    private readonly pool: SqlPool,
    options: IdentityServiceOptions = {},
  ) {
    this.codeDelivery = options.codeDelivery ?? new LocalEmailCodeDelivery();
    this.codePepper = options.codePepper ?? DEVELOPMENT_EMAIL_CODE_PEPPER;
  }

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

  async requestEmailCode(email: string): Promise<{ expiresAt: Date }> {
    const normalizedEmail = normalizeEmail(email);
    const code = generateEmailCode();
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);
    const emailHash = hashEmail(normalizedEmail);
    const codeHash = hashEmailCode(normalizedEmail, code, this.codePepper);
    const challenge = await withTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE app.email_login_challenges
         SET consumed_at = now()
         WHERE email_hash = $1 AND consumed_at IS NULL`,
        [emailHash],
      );
      const result = await client.query<{ id: string }>(
        `INSERT INTO app.email_login_challenges (email_hash, code_hash, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [emailHash, codeHash, expiresAt],
      );
      return requireRow(result.rows[0], 'Could not create an email sign-in challenge.');
    });

    try {
      await this.codeDelivery.deliver({ email: normalizedEmail, code, expiresAt });
    } catch (error) {
      await this.pool.query(
        'UPDATE app.email_login_challenges SET consumed_at = now() WHERE id = $1',
        [challenge.id],
      );
      throw error;
    }
    return { expiresAt };
  }

  async verifyEmailCode(
    session: ActiveSession,
    email: string,
    code: string,
  ): Promise<SessionWithToken> {
    const normalizedEmail = normalizeEmail(email);
    if (!/^\d{6}$/.test(code)) throw new InvalidEmailCodeError();
    const emailHash = hashEmail(normalizedEmail);

    return withTransaction(this.pool, async (client) => {
      const challengeResult = await client.query<EmailLoginChallengeRow>(
        `SELECT id, code_hash, expires_at, attempt_count
         FROM app.email_login_challenges
         WHERE email_hash = $1 AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [emailHash],
      );
      const challenge = challengeResult.rows[0];
      if (!challenge) throw new InvalidEmailCodeError();
      if (
        challenge.expires_at <= new Date() ||
        challenge.attempt_count >= MAX_EMAIL_CODE_ATTEMPTS
      ) {
        await client.query(
          'UPDATE app.email_login_challenges SET consumed_at = now() WHERE id = $1',
          [challenge.id],
        );
        throw new InvalidEmailCodeError();
      }

      const expectedCodeHash = Buffer.from(challenge.code_hash, 'hex');
      const suppliedCodeHash = Buffer.from(
        hashEmailCode(normalizedEmail, code, this.codePepper),
        'hex',
      );
      const validCode =
        expectedCodeHash.length === suppliedCodeHash.length &&
        timingSafeEqual(expectedCodeHash, suppliedCodeHash);
      if (!validCode) {
        await client.query(
          `UPDATE app.email_login_challenges
           SET attempt_count = attempt_count + 1,
               consumed_at = CASE WHEN attempt_count + 1 >= $2 THEN now() ELSE NULL END
           WHERE id = $1`,
          [challenge.id, MAX_EMAIL_CODE_ATTEMPTS],
        );
        throw new InvalidEmailCodeError();
      }

      await client.query(
        'UPDATE app.email_login_challenges SET consumed_at = now() WHERE id = $1',
        [challenge.id],
      );
      const userResult = await client.query<UserRow>(
        `INSERT INTO app.users (email, password_hash, email_verified_at)
         VALUES ($1, NULL, now())
         ON CONFLICT (email) DO UPDATE SET email_verified_at = COALESCE(app.users.email_verified_at, now()), updated_at = now()
         RETURNING id, email, email_verified_at`,
        [normalizedEmail],
      );
      const user = requireRow(userResult.rows[0], 'Could not establish the account.');
      return this.attachUserAndMigrate(client, session, user.id);
    });
  }

  /**
   * Internal fixture/provisioning helper retained for domain integration tests.
   * It is not exposed by a consumer API; real consumer accounts use verifyEmailCode.
   */
  async register(
    session: ActiveSession,
    email: string,
    _legacyPassword?: string,
  ): Promise<SessionWithToken> {
    void _legacyPassword;
    const normalizedEmail = normalizeEmail(email);
    return withTransaction(this.pool, async (client) => {
      const userResult = await client.query<UserRow>(
        `INSERT INTO app.users (email, password_hash, email_verified_at)
         VALUES ($1, NULL, now())
         ON CONFLICT (email) DO UPDATE SET email_verified_at = COALESCE(app.users.email_verified_at, now()), updated_at = now()
         RETURNING id, email, email_verified_at`,
        [normalizedEmail],
      );
      const user = requireRow(userResult.rows[0], 'Could not provision an account.');
      return this.attachUserAndMigrate(client, session, user.id);
    });
  }

  async getAuthenticatedUser(userId: string): Promise<{ id: string; email: string } | null> {
    const result = await this.pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM app.users WHERE id = $1 AND email_verified_at IS NOT NULL',
      [userId],
    );
    return result.rows[0] ?? null;
  }

  private async attachUserAndMigrate(
    client: SqlClient,
    session: ActiveSession,
    userId: string,
  ): Promise<SessionWithToken> {
    await client.query(
      `UPDATE app.projects
       SET owner_type = 'USER', owner_user_id = $1, owner_session_id = NULL,
           expires_at = now() + interval '90 days', updated_at = now()
       WHERE owner_type = 'GUEST' AND owner_session_id = $2`,
      [userId, session.id],
    );
    await client.query(
      `UPDATE app.carts SET owner_type = 'USER', owner_user_id = $1, owner_session_id = NULL, updated_at = now()
       WHERE owner_type = 'GUEST' AND owner_session_id = $2`,
      [userId, session.id],
    );
    await client.query(
      `UPDATE app.orders SET owner_type = 'USER', owner_user_id = $1, owner_session_id = NULL, updated_at = now()
       WHERE owner_type = 'GUEST' AND owner_session_id = $2`,
      [userId, session.id],
    );
    await migrateCreditAccount(client, session.id, userId);
    const token = randomBytes(32).toString('base64url');
    const result = await client.query<SessionRow>(
      `INSERT INTO app.sessions (token_hash, user_id, session_kind, expires_at)
       VALUES ($1, $2, 'AUTHENTICATED', now() + ($3::text || ' days')::interval)
       RETURNING id, user_id, session_kind, expires_at`,
      [hashToken(token), userId, String(SESSION_TTL_DAYS)],
    );
    const row = requireRow(result.rows[0], 'Could not establish authenticated session.');
    await client.query(`DELETE FROM app.sessions WHERE id = $1`, [session.id]);
    return {
      id: row.id,
      userId: row.user_id,
      kind: row.session_kind,
      expiresAt: row.expires_at,
      token,
    };
  }

  async invalidate(session: ActiveSession): Promise<void> {
    await this.pool.query(`DELETE FROM app.sessions WHERE id = $1`, [session.id]);
  }
}

async function migrateCreditAccount(
  client: SqlClient,
  sessionId: string,
  userId: string,
): Promise<void> {
  const guest = await client.query<{ id: string; current_balance: number }>(
    `SELECT id, current_balance FROM app.credit_accounts
     WHERE owner_type = 'GUEST' AND owner_session_id = $1 FOR UPDATE`,
    [sessionId],
  );
  const guestAccount = guest.rows[0];
  if (!guestAccount) return;
  const user = await client.query<{ id: string; current_balance: number }>(
    `SELECT id, current_balance FROM app.credit_accounts
     WHERE owner_type = 'USER' AND owner_user_id = $1 FOR UPDATE`,
    [userId],
  );
  const userAccount = user.rows[0];
  if (!userAccount) {
    await client.query(
      `UPDATE app.credit_accounts
       SET owner_type = 'USER', owner_user_id = $1, owner_session_id = NULL, updated_at = now()
       WHERE id = $2`,
      [userId, guestAccount.id],
    );
    return;
  }
  await client.query(
    'UPDATE app.credit_ledger SET credit_account_id = $1 WHERE credit_account_id = $2',
    [userAccount.id, guestAccount.id],
  );
  await client.query(
    `UPDATE app.credit_accounts SET current_balance = current_balance + $1, updated_at = now()
     WHERE id = $2`,
    [guestAccount.current_balance, userAccount.id],
  );
  await client.query('DELETE FROM app.credit_accounts WHERE id = $1', [guestAccount.id]);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(email: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid email address.');
  }
  return normalizedEmail;
}

export function generateEmailCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

export function hashEmailCode(email: string, code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`${email}:${code}`).digest('hex');
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}
