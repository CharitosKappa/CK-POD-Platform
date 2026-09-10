import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import type { ActiveSession } from './identity';

export class AccountValidationError extends Error {}

export interface AccountProfile {
  email: string;
  firstName: string;
  lastName: string;
  revision: number;
}

export interface SavedAddress {
  id: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
  phone: string | null;
  isDefault: boolean;
  revision: number;
}

export interface AccountDesign {
  projectId: string;
  prompt: string;
  generationId: string | null;
  previewAssetId: string | null;
  updatedAt: Date;
}

export interface CreditLedgerEntry {
  id: string;
  entryType: string;
  amount: number;
  balanceAfter: number;
  createdAt: Date;
}

export interface AccountOrder {
  orderNumber: string;
  status: string;
  itemCount: number;
  totalCents: number;
  createdAt: Date;
}

export class AccountService {
  public constructor(private readonly pool: SqlPool) {}

  async profile(session: ActiveSession): Promise<AccountProfile> {
    const userId = requireUser(session);
    const result = await this.pool.query<{
      email: string;
      first_name: string | null;
      last_name: string | null;
      revision: number | null;
    }>(
      `SELECT u.email, p.first_name, p.last_name, p.revision
       FROM app.users u LEFT JOIN app.account_profiles p ON p.user_id = u.id
       WHERE u.id = $1 AND u.email_verified_at IS NOT NULL`,
      [userId],
    );
    const row = requireRow(result.rows[0], 'Account not found.');
    return {
      email: row.email,
      firstName: row.first_name ?? '',
      lastName: row.last_name ?? '',
      revision: row.revision ?? 1,
    };
  }

  async updateProfile(
    session: ActiveSession,
    input: { firstName: string; lastName: string; expectedRevision: number },
  ): Promise<AccountProfile> {
    const userId = requireUser(session);
    const firstName = normalizedName(input.firstName, 'first name');
    const lastName = normalizedName(input.lastName, 'last name');
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new AccountValidationError('Your profile changed. Refresh it and try again.');
    }
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO app.account_profiles (user_id, first_name, last_name)
         VALUES ($1, '', '') ON CONFLICT (user_id) DO NOTHING`,
        [userId],
      );
      const result = await client.query<{ user_id: string }>(
        `UPDATE app.account_profiles
         SET first_name = $2, last_name = $3, revision = revision + 1, updated_at = now()
         WHERE user_id = $1 AND revision = $4 RETURNING user_id`,
        [userId, firstName, lastName, input.expectedRevision],
      );
      if (!result.rows[0]) {
        throw new AccountValidationError('Your profile changed. Refresh it and try again.');
      }
    });
    return this.profile(session);
  }

  async addresses(session: ActiveSession): Promise<SavedAddress[]> {
    const userId = requireUser(session);
    const result = await this.pool.query<AddressRow>(
      `SELECT id, recipient_name, line1, line2, city, state_code, postal_code, country_code, phone,
              is_default, revision
       FROM app.saved_addresses WHERE user_id = $1
       ORDER BY is_default DESC, updated_at DESC`,
      [userId],
    );
    return result.rows.map(mapAddress);
  }

  async saveAddress(
    session: ActiveSession,
    input: AddressInput & { id?: string; expectedRevision?: number },
  ): Promise<SavedAddress> {
    const userId = requireUser(session);
    const address = validateAddress(input);
    return withTransaction(this.pool, async (client) => {
      if (input.id) {
        if (!Number.isInteger(input.expectedRevision)) {
          throw new AccountValidationError('Your address changed. Refresh it and try again.');
        }
        if (address.isDefault) await clearDefaultAddress(client, userId, input.id);
        const updated = await client.query<AddressRow>(
          `UPDATE app.saved_addresses
           SET recipient_name = $3, line1 = $4, line2 = $5, city = $6, state_code = $7,
               postal_code = $8, country_code = $9, phone = $10, is_default = $11,
               revision = revision + 1, updated_at = now()
           WHERE id = $1 AND user_id = $2 AND revision = $12
           RETURNING id, recipient_name, line1, line2, city, state_code, postal_code, country_code,
                     phone, is_default, revision`,
          [
            input.id,
            userId,
            address.recipientName,
            address.line1,
            address.line2,
            address.city,
            address.stateCode,
            address.postalCode,
            address.countryCode,
            address.phone,
            address.isDefault,
            input.expectedRevision,
          ],
        );
        return mapAddress(
          requireRow(updated.rows[0], 'Your address changed. Refresh it and try again.'),
        );
      }
      const hasAddress = await client.query<{ id: string }>(
        'SELECT id FROM app.saved_addresses WHERE user_id = $1 LIMIT 1',
        [userId],
      );
      const isDefault = address.isDefault || !hasAddress.rows[0];
      if (isDefault) await clearDefaultAddress(client, userId);
      const created = await client.query<AddressRow>(
        `INSERT INTO app.saved_addresses (
           user_id, recipient_name, line1, line2, city, state_code, postal_code, country_code, phone, is_default
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, recipient_name, line1, line2, city, state_code, postal_code, country_code,
                   phone, is_default, revision`,
        [
          userId,
          address.recipientName,
          address.line1,
          address.line2,
          address.city,
          address.stateCode,
          address.postalCode,
          address.countryCode,
          address.phone,
          isDefault,
        ],
      );
      return mapAddress(requireRow(created.rows[0], 'Could not save your address.'));
    });
  }

  async deleteAddress(
    session: ActiveSession,
    input: { id: string; expectedRevision: number },
  ): Promise<void> {
    const userId = requireUser(session);
    const deleted = await this.pool.query<{ id: string }>(
      `DELETE FROM app.saved_addresses
       WHERE id = $1 AND user_id = $2 AND revision = $3 RETURNING id`,
      [input.id, userId, input.expectedRevision],
    );
    if (!deleted.rows[0])
      throw new AccountValidationError('Your address changed. Refresh it and try again.');
  }

  async designs(session: ActiveSession, limit = 24): Promise<AccountDesign[]> {
    const userId = requireUser(session);
    const result = await this.pool.query<{
      project_id: string;
      prompt: string;
      generation_id: string | null;
      preview_asset_id: string | null;
      updated_at: Date;
    }>(
      `SELECT p.id AS project_id, d.prompt, preview.generation_id, preview.preview_asset_id, p.updated_at
       FROM app.projects p
       JOIN app.project_creation_drafts d ON d.project_id = p.id
       LEFT JOIN LATERAL (
         SELECT g.id AS generation_id, a.id AS preview_asset_id FROM app.generations g
         JOIN app.assets a ON a.generation_id = g.id
          AND a.asset_type = 'PREVIEW' AND a.status = 'ACTIVE'
         WHERE g.project_id = p.id AND g.status = 'SUCCEEDED'
         ORDER BY g.completed_at DESC NULLS LAST, a.created_at DESC LIMIT 1
       ) preview ON true
       WHERE p.owner_type = 'USER' AND p.owner_user_id = $1 AND p.status <> 'ARCHIVED'
       ORDER BY p.updated_at DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map((row) => ({
      projectId: row.project_id,
      prompt: row.prompt,
      generationId: row.generation_id,
      previewAssetId: row.preview_asset_id,
      updatedAt: row.updated_at,
    }));
  }

  async credits(
    session: ActiveSession,
  ): Promise<{ balance: number; entries: CreditLedgerEntry[] }> {
    const userId = requireUser(session);
    const account = await this.pool.query<{ id: string; current_balance: number }>(
      `SELECT id, current_balance FROM app.credit_accounts
       WHERE owner_type = 'USER' AND owner_user_id = $1`,
      [userId],
    );
    const row = account.rows[0];
    if (!row) return { balance: 0, entries: [] };
    const entries = await this.pool.query<{
      id: string;
      entry_type: string;
      amount: number;
      balance_after: number;
      created_at: Date;
    }>(
      `SELECT id, entry_type, amount, balance_after, created_at FROM app.credit_ledger
       WHERE credit_account_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [row.id],
    );
    return {
      balance: row.current_balance,
      entries: entries.rows.map((entry) => ({
        id: entry.id,
        entryType: entry.entry_type,
        amount: entry.amount,
        balanceAfter: entry.balance_after,
        createdAt: entry.created_at,
      })),
    };
  }

  async orders(session: ActiveSession, limit = 24): Promise<AccountOrder[]> {
    const userId = requireUser(session);
    const result = await this.pool.query<{
      order_number: string;
      status: string;
      item_count: number;
      total_cents: number;
      created_at: Date;
    }>(
      `SELECT o.order_number, o.status, coalesce(sum(oi.quantity), 0)::int AS item_count,
              (o.pricing_snapshot ->> 'totalCents')::int AS total_cents, o.created_at
       FROM app.orders o LEFT JOIN app.order_items oi ON oi.order_id = o.id
       WHERE o.owner_type = 'USER' AND o.owner_user_id = $1
       GROUP BY o.id ORDER BY o.created_at DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map((row) => ({
      orderNumber: row.order_number,
      status: row.status,
      itemCount: row.item_count,
      totalCents: row.total_cents,
      createdAt: row.created_at,
    }));
  }
}

interface AddressRow {
  id: string;
  recipient_name: string;
  line1: string;
  line2: string | null;
  city: string;
  state_code: string;
  postal_code: string;
  country_code: string;
  phone: string | null;
  is_default: boolean;
  revision: number;
}

interface AddressInput {
  recipientName: string;
  line1: string;
  line2?: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
  phone?: string | null;
  isDefault?: boolean;
}

function requireUser(session: ActiveSession): string {
  if (!session.userId) throw new Error('Authentication is required.');
  return session.userId;
}

function normalizedName(value: string, label: string): string {
  const name = value.trim();
  if (!name || name.length > 80) throw new AccountValidationError(`Enter a valid ${label}.`);
  return name;
}

function validateAddress(input: AddressInput): Required<AddressInput> {
  const recipientName = normalizedName(input.recipientName, 'recipient name');
  const line1 = input.line1.trim();
  const city = input.city.trim();
  const stateCode = input.stateCode.trim().toUpperCase();
  const postalCode = input.postalCode.trim();
  const countryCode = input.countryCode.trim().toUpperCase();
  const line2 = input.line2?.trim() || null;
  const phone = input.phone?.trim() || null;
  if (
    !line1 ||
    line1.length > 120 ||
    (line2 && line2.length > 120) ||
    !city ||
    city.length > 80 ||
    !/^[A-Z]{2}$/.test(stateCode) ||
    !/^\d{5}(?:-\d{4})?$/.test(postalCode) ||
    countryCode !== 'US' ||
    (phone !== null && !/^[+0-9().\-\s]{7,25}$/.test(phone))
  ) {
    throw new AccountValidationError('Enter a complete US delivery address.');
  }
  return {
    recipientName,
    line1,
    line2,
    city,
    stateCode,
    postalCode,
    countryCode,
    phone,
    isDefault: Boolean(input.isDefault),
  };
}

async function clearDefaultAddress(
  client: SqlClient,
  userId: string,
  exceptId?: string,
): Promise<void> {
  await client.query(
    `UPDATE app.saved_addresses SET is_default = false, updated_at = now()
     WHERE user_id = $1 AND is_default = true ${exceptId ? 'AND id <> $2' : ''}`,
    exceptId ? [userId, exceptId] : [userId],
  );
}

function mapAddress(row: AddressRow): SavedAddress {
  return {
    id: row.id,
    recipientName: row.recipient_name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    stateCode: row.state_code,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    phone: row.phone,
    isDefault: row.is_default,
    revision: row.revision,
  };
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new AccountValidationError(message);
  return row;
}
