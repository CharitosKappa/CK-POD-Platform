--> statement-breakpoint
CREATE UNIQUE INDEX checkout_attempts_active_cart_idx
  ON app.checkout_attempts(cart_id)
  WHERE status IN ('READY', 'PAYMENT_PENDING');
