import { describe, expect, it } from 'vitest';

import {
  defaultAdminPreferences,
  parseAdminPreferences,
  readAdminPreferences,
  writeAdminPreferences,
  type AdminPreferences,
} from './admin-preferences';

describe('admin preferences', () => {
  it.each([null, '', 'not-json', '{}', '[]', '{"sidebarCollapsed":"yes"}'])(
    'uses expanded defaults for unsupported value %s',
    (value) => {
      expect(parseAdminPreferences(value)).toEqual(defaultAdminPreferences);
    },
  );

  it('accepts explicit expanded and collapsed values', () => {
    expect(parseAdminPreferences('{"sidebarCollapsed":false}')).toEqual({
      sidebarCollapsed: false,
      customerColumns: [...defaultAdminPreferences.customerColumns],
      customerView: 'ALL',
    });
    expect(parseAdminPreferences('{"sidebarCollapsed":true}')).toEqual({
      sidebarCollapsed: true,
      customerColumns: [...defaultAdminPreferences.customerColumns],
      customerView: 'ALL',
    });
  });

  it('persists and restores the sidebar choice through a storage-compatible boundary', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };

    const saved: AdminPreferences = {
      sidebarCollapsed: true,
      customerColumns: ['orders', 'spent'],
      customerView: 'HIGH_VALUE',
    };
    expect(writeAdminPreferences(storage, saved)).toBe(true);
    expect(readAdminPreferences(storage)).toEqual(saved);
  });

  it('fails safely when browser storage is unavailable', () => {
    const unavailable = {
      getItem() {
        throw new Error('Storage unavailable');
      },
      setItem() {
        throw new Error('Storage unavailable');
      },
    };

    expect(readAdminPreferences(unavailable)).toEqual(defaultAdminPreferences);
    expect(writeAdminPreferences(unavailable, defaultAdminPreferences)).toBe(false);
  });

  it('drops unknown customer columns and views while keeping valid preferences', () => {
    expect(
      parseAdminPreferences(
        '{"sidebarCollapsed":true,"customerColumns":["orders","unknown","orders"],"customerView":"NOPE"}',
      ),
    ).toEqual({ sidebarCollapsed: true, customerColumns: ['orders'], customerView: 'ALL' });
  });
});
