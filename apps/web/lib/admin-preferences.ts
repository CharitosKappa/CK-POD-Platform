export const adminPreferencesStorageKey = 'let-it-be:admin-preferences:v1';

export type AdminPreferences = Readonly<{
  customerColumnsVersion: 2;
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
  'dateAdded',
  'dateUpdated',
] as const;
export type CustomerColumn = (typeof customerColumns)[number];
export type CustomerViewPreference =
  | 'ALL'
  | 'RECENTLY_ADDED'
  | 'PROSPECTS'
  | 'FIRST_TIME'
  | 'RETURNING'
  | 'HIGH_VALUE'
  | 'EMAIL_SUBSCRIBERS';

export const defaultAdminPreferences: AdminPreferences = Object.freeze({
  customerColumnsVersion: 2,
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
    const migratedColumns =
      parsed.customerColumnsVersion === 2
        ? parsedColumns
        : [...parsedColumns, 'dateAdded' as const, 'dateUpdated' as const];
    const parsedView =
      parsed.customerView === 'NEW'
        ? 'RECENTLY_ADDED'
        : isCustomerView(parsed.customerView)
          ? parsed.customerView
          : 'ALL';
    return {
      customerColumnsVersion: 2,
      sidebarCollapsed: parsed.sidebarCollapsed,
      customerColumns: [...new Set(migratedColumns)],
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
    [
      'ALL',
      'RECENTLY_ADDED',
      'PROSPECTS',
      'FIRST_TIME',
      'RETURNING',
      'HIGH_VALUE',
      'EMAIL_SUBSCRIBERS',
    ].includes(value)
  );
}
