import { NextResponse } from 'next/server';
import {
  OrderAdminActionAccessError,
  OrderAdminActionValidationError,
  type AdminStaffSession,
} from '@let-it-be/domain';
import { decodeOrderNumberRouteParam } from '../../../../../../lib/order-number-route';
import { requireAdminSession } from '../../../../../../lib/platform';

export type ActionContext = { params: Promise<{ orderNumber: string }> };
export function invalid(message = 'Enter valid order action fields.'): never {
  throw new OrderAdminActionValidationError(message);
}
export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    invalid(`Enter a valid ${name}.`);
  return value;
}
export function optionalText(value: unknown, name: string, max = 1000): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) invalid(`Enter a valid ${name}.`);
  return value;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    invalid('Enter a valid identifier.');
  return value;
}
export function integer(value: unknown, minimum = 0, maximum = 2_147_483_647): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    invalid('Enter a valid integer amount or quantity.');
  return value;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid('Select a valid option.');
  return value;
}
export function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid('Select a valid option.');
  return value as T;
}
export function reasonAndNote(body: Record<string, unknown>) {
  const note = optionalText(body.note, 'internal note');
  return { reasonCode: text(body.reasonCode, 'reason'), ...(note === undefined ? {} : { note }) };
}
export async function actionRequest(request: Request, context: ActionContext) {
  const session = await requireAdminSession();
  if (!session.staffMemberId || (session.role !== 'OWNER' && session.role !== 'OPERATIONS'))
    throw new OrderAdminActionAccessError('You do not have access to order actions.');
  const actor: AdminStaffSession & { role: 'OWNER' | 'OPERATIONS' } = {
    ...session,
    role: session.role,
  };
  const orderNumber = decodeOrderNumberRouteParam((await context.params).orderNumber);
  if (!/^#[1-9][0-9]*$/.test(orderNumber)) invalid('Enter a valid order number.');
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.trim().length < 12 || idempotencyKey.length > 120)
    invalid('Provide an idempotency key between 12 and 120 characters.');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    invalid('Enter a valid JSON request.');
  }
  return { session: actor, orderNumber, idempotencyKey, body };
}
export function actionResult(result: unknown, status = 200) {
  return NextResponse.json({ result }, { status });
}
