import type { SqlClient, SqlPool } from '@let-it-be/db';

import { GenerationCreditError } from './ai-contracts';
import type { ActiveSession } from './identity';

export interface CreditServiceOptions {
  guestFreeCredits?: number;
  registeredFreeCredits?: number;
}

interface CreditAccountRow {
  id: string;
  current_balance: number;
}

export interface CreditAccount {
  id: string;
  balance: number;
}

/**
 * Ledger-first credit accounting. `current_balance` is a locked convenience
 * projection; credit_ledger remains the source of every balance mutation.
 */
export class CreditService {
  private readonly guestFreeCredits: number;
  private readonly registeredFreeCredits: number;

  public constructor(
    private readonly pool: SqlPool,
    options: CreditServiceOptions = {},
  ) {
    this.guestFreeCredits = options.guestFreeCredits ?? 1;
    this.registeredFreeCredits = options.registeredFreeCredits ?? 0;
  }

  async assertGenerationCapacity(
    client: SqlClient,
    session: ActiveSession,
  ): Promise<CreditAccount> {
    const account = await this.ensureAccount(client, session);
    const pending = await client.query<{ pending: number }>(
      `SELECT count(*)::int AS pending FROM app.generations
       WHERE credit_account_id = $1 AND credit_status = 'PENDING'
         AND status IN ('QUEUED', 'PROCESSING', 'VALIDATING')`,
      [account.id],
    );
    if ((pending.rows[0]?.pending ?? 0) >= account.balance) {
      throw new GenerationCreditError('No generation credits are currently available.');
    }
    return account;
  }

  async consumeDelivered(
    client: SqlClient,
    input: { accountId: string; generationId: string },
  ): Promise<CreditAccount> {
    const alreadyConsumed = await client.query<{ id: string }>(
      `SELECT id FROM app.credit_ledger
       WHERE generation_id = $1 AND entry_type = 'CONSUME' LIMIT 1`,
      [input.generationId],
    );
    if (alreadyConsumed.rows[0]) return this.lockAccount(client, input.accountId);

    const balance = await this.lockAccount(client, input.accountId);
    if (balance.balance < 1) {
      throw new GenerationCreditError('No generation credits are currently available.');
    }
    const updated = await client.query<CreditAccountRow>(
      `UPDATE app.credit_accounts SET current_balance = current_balance - 1, updated_at = now()
       WHERE id = $1 AND current_balance >= 1 RETURNING id, current_balance`,
      [input.accountId],
    );
    const account = mapAccount(requireRow(updated.rows[0], 'Credit balance changed unexpectedly.'));
    await client.query(
      `INSERT INTO app.credit_ledger (
        credit_account_id, generation_id, entry_type, amount, balance_after, idempotency_key, metadata
      ) VALUES ($1, $2, 'CONSUME', -1, $3, $4, $5::jsonb)`,
      [
        account.id,
        input.generationId,
        account.balance,
        `consume-generation:${input.generationId}`,
        JSON.stringify({ reason: 'validated-generation-delivered' }),
      ],
    );
    return account;
  }

  async refundSystemFailure(
    client: SqlClient,
    input: { accountId: string; generationId: string; reason: string },
  ): Promise<CreditAccount> {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM app.credit_ledger
       WHERE generation_id = $1 AND entry_type = 'REFUND' LIMIT 1`,
      [input.generationId],
    );
    if (existing.rows[0]) return this.lockAccount(client, input.accountId);

    await this.lockAccount(client, input.accountId);
    const updated = await client.query<CreditAccountRow>(
      `UPDATE app.credit_accounts SET current_balance = current_balance + 1, updated_at = now()
       WHERE id = $1 RETURNING id, current_balance`,
      [input.accountId],
    );
    const account = mapAccount(requireRow(updated.rows[0], 'Could not refund generation credit.'));
    await client.query(
      `INSERT INTO app.credit_ledger (
        credit_account_id, generation_id, entry_type, amount, balance_after, idempotency_key, metadata
      ) VALUES ($1, $2, 'REFUND', 1, $3, $4, $5::jsonb)`,
      [
        account.id,
        input.generationId,
        account.balance,
        `refund-generation:${input.generationId}`,
        JSON.stringify({ reason: input.reason }),
      ],
    );
    return account;
  }

  async getBalance(session: ActiveSession): Promise<CreditAccount | null> {
    const result = await this.pool.query<CreditAccountRow>(
      `SELECT id, current_balance FROM app.credit_accounts
       WHERE (owner_type = 'GUEST' AND owner_session_id = $1)
          OR (owner_type = 'USER' AND owner_user_id = $2::uuid)`,
      [session.id, session.userId],
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  private async ensureAccount(client: SqlClient, session: ActiveSession): Promise<CreditAccount> {
    const ownerType = session.userId ? 'USER' : 'GUEST';
    const created = await client.query<CreditAccountRow>(
      `INSERT INTO app.credit_accounts (owner_type, owner_session_id, owner_user_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
       RETURNING id, current_balance`,
      [ownerType, session.userId ? null : session.id, session.userId],
    );
    const account = created.rows[0]
      ? mapAccount(created.rows[0])
      : await this.lockAccountForOwner(client, session);

    if (!created.rows[0]) return account;
    const grant = session.userId ? this.registeredFreeCredits : this.guestFreeCredits;
    if (grant === 0) return account;

    const updated = await client.query<CreditAccountRow>(
      `UPDATE app.credit_accounts SET current_balance = current_balance + $1, updated_at = now()
       WHERE id = $2 RETURNING id, current_balance`,
      [grant, account.id],
    );
    const credited = mapAccount(requireRow(updated.rows[0], 'Could not grant initial credits.'));
    await client.query(
      `INSERT INTO app.credit_ledger (
        credit_account_id, entry_type, amount, balance_after, idempotency_key, metadata
      ) VALUES ($1, 'GRANT', $2, $3, $4, $5::jsonb)`,
      [
        credited.id,
        grant,
        credited.balance,
        `initial-grant:${credited.id}`,
        JSON.stringify({ ownerType }),
      ],
    );
    return credited;
  }

  private async lockAccountForOwner(
    client: SqlClient,
    session: ActiveSession,
  ): Promise<CreditAccount> {
    const result = await client.query<CreditAccountRow>(
      `SELECT id, current_balance FROM app.credit_accounts
       WHERE (owner_type = 'GUEST' AND owner_session_id = $1)
          OR (owner_type = 'USER' AND owner_user_id = $2::uuid)
       FOR UPDATE`,
      [session.id, session.userId],
    );
    return mapAccount(requireRow(result.rows[0], 'Could not locate credit account.'));
  }

  private async lockAccount(client: SqlClient, accountId: string): Promise<CreditAccount> {
    const result = await client.query<CreditAccountRow>(
      'SELECT id, current_balance FROM app.credit_accounts WHERE id = $1 FOR UPDATE',
      [accountId],
    );
    return mapAccount(requireRow(result.rows[0], 'Could not locate credit account.'));
  }
}

function mapAccount(row: CreditAccountRow): CreditAccount {
  return { id: row.id, balance: row.current_balance };
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}
