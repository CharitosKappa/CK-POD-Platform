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
      customerColumnsVersion: 2,
      sidebarCollapsed: false,
      customerColumns: [...defaultAdminPreferences.customerColumns],
      customerView: 'ALL',
      customerSort: 'LAST_SEEN_DESC',
      orderView: 'ALL',
      orderSort: 'DATE_DESC',
    });
    expect(parseAdminPreferences('{"sidebarCollapsed":true}')).toEqual({
      customerColumnsVersion: 2,
      sidebarCollapsed: true,
      customerColumns: [...defaultAdminPreferences.customerColumns],
      customerView: 'ALL',
      customerSort: 'LAST_SEEN_DESC',
      orderView: 'ALL',
      orderSort: 'DATE_DESC',
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
      customerColumnsVersion: 2,
      sidebarCollapsed: true,
      customerColumns: ['orders', 'spent'],
      customerView: 'HIGH_VALUE',
      customerSort: 'TOTAL_SPENT_DESC',
      orderView: 'IN_PROGRESS',
      orderSort: 'TOTAL_DESC',
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

  it('drops unknown customer columns and views while migrating newly introduced columns', () => {
    expect(
      parseAdminPreferences(
        '{"sidebarCollapsed":true,"customerColumns":["orders","unknown","orders"],"customerView":"NOPE"}',
      ),
    ).toEqual({
      customerColumnsVersion: 2,
      sidebarCollapsed: true,
      customerColumns: ['orders', 'dateAdded', 'dateUpdated'],
      customerView: 'ALL',
      customerSort: 'LAST_SEEN_DESC',
      orderView: 'ALL',
      orderSort: 'DATE_DESC',
    });
  });

  it('preserves hidden date columns after the column preferences migrate', () => {
    expect(
      parseAdminPreferences(
        '{"customerColumnsVersion":2,"sidebarCollapsed":true,"customerColumns":["orders"],"customerView":"ALL"}',
      ),
    ).toEqual({
      customerColumnsVersion: 2,
      sidebarCollapsed: true,
      customerColumns: ['orders'],
      customerView: 'ALL',
      customerSort: 'LAST_SEEN_DESC',
      orderView: 'ALL',
      orderSort: 'DATE_DESC',
    });
  });

  it('migrates the legacy New view to Recently added', () => {
    expect(
      parseAdminPreferences(
        '{"customerColumnsVersion":2,"sidebarCollapsed":false,"customerColumns":["orders"],"customerView":"NEW"}',
      ).customerView,
    ).toBe('RECENTLY_ADDED');
  });

  it('restores a supported customer sort and rejects unknown values', () => {
    expect(
      parseAdminPreferences(
        '{"customerColumnsVersion":2,"sidebarCollapsed":false,"customerColumns":["orders"],"customerView":"ALL","customerSort":"EMAIL_ASC"}',
      ).customerSort,
    ).toBe('EMAIL_ASC');
    expect(
      parseAdminPreferences(
        '{"customerColumnsVersion":2,"sidebarCollapsed":false,"customerColumns":["orders"],"customerView":"ALL","customerSort":"NOPE"}',
      ).customerSort,
    ).toBe('LAST_SEEN_DESC');
  });

  it('restores supported Orders view and sort preferences', () => {
    const preferences = parseAdminPreferences(
      '{"sidebarCollapsed":false,"orderView":"IN_PROGRESS","orderSort":"TOTAL_DESC"}',
    );
    expect(preferences.orderView).toBe('IN_PROGRESS');
    expect(preferences.orderSort).toBe('TOTAL_DESC');
  });
});
