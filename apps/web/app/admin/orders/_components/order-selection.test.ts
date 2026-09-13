import { describe, expect, it } from 'vitest';

import {
  clearOrderSelection,
  countOrderSelection,
  selectAllMatchingOrders,
  toggleOrder,
  toggleOrderPage,
} from './order-selection';

const ids = Array.from({ length: 30 }, (_, index) => `order-${index + 1}`);

describe('order directory selection', () => {
  it('selects and clears every order on the current page', () => {
    const selected = toggleOrderPage(clearOrderSelection(), ids);
    expect([...selected.selected]).toEqual(ids);
    expect(toggleOrderPage(selected, ids).selected.size).toBe(0);
  });

  it('selects all matching results while allowing row exclusions', () => {
    const all = selectAllMatchingOrders();
    const excluded = toggleOrder(all, ids[0]!);
    expect(excluded.allMatchingSelected).toBe(true);
    expect(excluded.excluded).toEqual(new Set([ids[0]]));
    expect(countOrderSelection(excluded, 162)).toBe(161);
    expect(toggleOrder(excluded, ids[0]!).excluded.size).toBe(0);
  });

  it('toggles the visible page as exclusions during all-result selection', () => {
    const all = selectAllMatchingOrders();
    const excludedPage = toggleOrderPage(all, ids);
    expect(excludedPage.excluded.size).toBe(30);
    expect(toggleOrderPage(excludedPage, ids).excluded.size).toBe(0);
  });
});
