import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { commerceRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ cartId: string }> },
): Promise<NextResponse> {
  try {
    const { cartId } = await context.params;
    return NextResponse.json({
      cart: await (await commerceRuntime()).getCart(await requireSession(), cartId),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
): Promise<NextResponse> {
  try {
    const { cartId } = await context.params;
    const body = (await request.json()) as {
      itemId?: string;
      quantity?: number;
      expectedRevision?: number;
    };
    if (
      !body.itemId ||
      body.quantity === undefined ||
      !Number.isInteger(body.quantity) ||
      body.expectedRevision === undefined ||
      !Number.isInteger(body.expectedRevision)
    ) {
      return NextResponse.json({ error: 'Valid cart quantity data is required.' }, { status: 400 });
    }
    const cart = await (
      await commerceRuntime()
    ).updateCartQuantity(await requireSession(), cartId, {
      quantity: body.quantity,
      itemId: body.itemId,
      expectedRevision: body.expectedRevision,
    });
    return NextResponse.json({ cart });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
): Promise<NextResponse> {
  try {
    const { cartId } = await context.params;
    const body = (await request.json()) as { itemId?: string; expectedRevision?: number };
    if (
      !body.itemId ||
      body.expectedRevision === undefined ||
      !Number.isInteger(body.expectedRevision)
    ) {
      return NextResponse.json({ error: 'A valid cart revision is required.' }, { status: 400 });
    }
    const cart = await (
      await commerceRuntime()
    ).removeCartItem(await requireSession(), cartId, {
      itemId: body.itemId,
      expectedRevision: body.expectedRevision,
    });
    return NextResponse.json({ cart });
  } catch (error) {
    return handleRouteError(error);
  }
}
