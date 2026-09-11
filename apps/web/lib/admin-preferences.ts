export const adminPreferencesStorageKey = 'let-it-be:admin-preferences:v1';

export type AdminPreferences = Readonly<{
  sidebarCollapsed: boolean;
  customerColumns: CustomerColumn[];
  customerView: CustomerViewPreference;
}>;

export const customerColumns = [
  'subscription',
  'location',
  'orders',
  'spent',
  'lastOrder',
  'tags',
] as const;
export type CustomerColumn = (typeof customerColumns)[number];
export type CustomerViewPreference =
  'ALL' | 'NEW' | 'RETURNING' | 'HIGH_VALUE' | 'EMAIL_SUBSCRIBERS';

export const defaultAdminPreferences: AdminPreferences = Object.freeze({
  sidebarCollapsed: false,
  customerColumns: [...customerColumns],
  customerView: 'ALL',
});

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export function parseAdminPreferences(value: string | null): AdminPreferences {
  if (!value) return defaultAdminPreferences;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPreferenceRecord(parsed) || typeof parsed.sidebarCollapsed !== 'boolean') {
      return defaultAdminPreferences;
    }
    const parsedColumns = Array.isArray(parsed.customerColumns)
      ? parsed.customerColumns.filter((column): column is CustomerColumn =>
          customerColumns.includes(column as CustomerColumn),
        )
      : [...customerColumns];
    const parsedView = isCustomerView(parsed.customerView) ? parsed.customerView : 'ALL';
    return {
      sidebarCollapsed: parsed.sidebarCollapsed,
      customerColumns: [...new Set(parsedColumns)],
      customerView: parsedView,
    };
  } catch {
    return defaultAdminPreferences;
  }
}

export function readAdminPreferences(storage: ReadableStorage): AdminPreferences {
  try {
    return parseAdminPreferences(storage.getItem(adminPreferencesStorageKey));
  } catch {
    return defaultAdminPreferences;
  }
}

export function writeAdminPreferences(
  storage: WritableStorage,
  preferences: AdminPreferences,
): boolean {
  try {
    storage.setItem(adminPreferencesStorageKey, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

function isPreferenceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCustomerView(value: unknown): value is CustomerViewPreference {
  return (
    typeof value === 'string' &&
    ['ALL', 'NEW', 'RETURNING', 'HIGH_VALUE', 'EMAIL_SUBSCRIBERS'].includes(value)
  );
}
