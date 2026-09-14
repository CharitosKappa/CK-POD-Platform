import { type ShippingAddressInput } from '@let-it-be/domain';
import { handleOrderActionRouteError as handleRouteError } from '../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../lib/platform';
import {
  actionRequest,
  actionResult,
  object,
  reasonAndNote,
  text,
  optionalText,
  integer,
  uuid,
  invalid,
  type ActionContext,
} from '../_actions/request';
export const dynamic = 'force-dynamic';
function email(value: unknown): string {
  const result = text(value, 'email', 254);
  if (!/^\S+@\S+\.\S+$/.test(result.trim())) invalid('Enter a valid email.');
  return result;
}
function phone(value: unknown): string | undefined {
  const result = optionalText(value, 'phone', 25);
  if (result && !/^[+0-9().\-\s]{7,25}$/.test(result.trim()))
    invalid('Enter a valid phone number.');
  return result;
}
function address(raw: unknown): ShippingAddressInput {
  const body = object(raw, [
    'recipientName',
    'email',
    'phone',
    'line1',
    'line2',
    'city',
    'stateCode',
    'postalCode',
    'countryCode',
  ]);
  const phoneValue = phone(body.phone),
    line2 = optionalText(body.line2, 'address line', 200);
  const countryCode = text(body.countryCode, 'country', 2);
  if (!/^[A-Z]{2}$/.test(countryCode)) invalid('Enter a two-letter country code.');
  return {
    recipientName: text(body.recipientName, 'recipient', 200),
    email: email(body.email),
    line1: text(body.line1, 'address line', 200),
    city: text(body.city, 'city', 100),
    stateCode: text(body.stateCode, 'state', 100),
    postalCode: text(body.postalCode, 'postal code', 20),
    countryCode,
    ...(phoneValue === undefined ? {} : { phone: phoneValue }),
    ...(line2 === undefined ? {} : { line2 }),
  };
}
export async function POST(request: Request, context: ActionContext) {
  try {
    const {
      session,
      body: raw,
      orderNumber,
      idempotencyKey,
    } = await actionRequest(request, context);
    const body = object(raw, [
      'reasonCode',
      'note',
      'items',
      'discountCents',
      'shippingCents',
      'shippingAddress',
      'customerEmail',
      'customerPhone',
      'tags',
    ]);
    let items;
    if (body.items !== undefined) {
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100)
        invalid('Select valid order items.');
      items = body.items.map((rawItem) => {
        const item = object(rawItem, ['orderItemId', 'productVariantId', 'quantity']);
        return {
          ...(item.orderItemId === undefined ? {} : { orderItemId: uuid(item.orderItemId) }),
          productVariantId: uuid(item.productVariantId),
          quantity: integer(item.quantity, 1, 99),
        };
      });
      const ids = items.flatMap((item) =>
        item.orderItemId ? [item.orderItemId.toLowerCase()] : [],
      );
      if (new Set(ids).size !== ids.length) invalid('Select each order item only once.');
    }
    let tags;
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags) || body.tags.length > 100) invalid('Enter valid tags.');
      tags = body.tags.map((tag) => text(tag, 'tag', 80));
    }
    const input = {
      ...reasonAndNote(body),
      orderNumber,
      idempotencyKey,
      ...(items === undefined ? {} : { items }),
      ...(tags === undefined ? {} : { tags }),
      ...(body.discountCents === undefined ? {} : { discountCents: integer(body.discountCents) }),
      ...(body.shippingCents === undefined ? {} : { shippingCents: integer(body.shippingCents) }),
      ...(body.shippingAddress === undefined
        ? {}
        : { shippingAddress: address(body.shippingAddress) }),
      ...(body.customerEmail === undefined ? {} : { customerEmail: email(body.customerEmail) }),
      ...(body.customerPhone === undefined ? {} : { customerPhone: phone(body.customerPhone)! }),
    };
    return actionResult(await (await orderAdminActionsRuntime()).actions.editOrder(session, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
