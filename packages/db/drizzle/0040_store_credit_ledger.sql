CREATE TABLE app.store_credit_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id uuid NOT NULL UNIQUE
    REFERENCES app.customer_profiles(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  current_balance_cents integer NOT NULL DEFAULT 0
    CHECK (current_balance_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.store_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_credit_account_id uuid NOT NULL
    REFERENCES app.store_credit_accounts(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('CREDIT', 'DEBIT')),
  amount_cents integer NOT NULL CHECK (
    (entry_type = 'CREDIT' AND amount_cents > 0)
    OR (entry_type = 'DEBIT' AND amount_cents < 0)
  ),
  balance_after_cents integer NOT NULL CHECK (balance_after_cents >= 0),
  reason text NOT NULL CHECK (
    reason IN ('REFUND', 'PROMOTION', 'CUSTOMER_SERVICE', 'OTHER')
  ),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  actor_staff_member_id uuid NOT NULL
    REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_credit_account_id, idempotency_key)
);

CREATE INDEX store_credit_ledger_account_created_idx
  ON app.store_credit_ledger(store_credit_account_id, created_at DESC, id DESC);

CREATE INDEX store_credit_ledger_actor_created_idx
  ON app.store_credit_ledger(actor_staff_member_id, created_at DESC);
