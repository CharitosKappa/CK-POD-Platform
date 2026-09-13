export const adminPreferencesStorageKey = 'let-it-be:admin-preferences:v1';

export type AdminPreferences = Readonly<{
  customerColumnsVersion: 2;
  sidebarCollapsed: boolean;
  customerColumns: CustomerColumn[];
  customerView: CustomerViewPreference;
  customerSort: CustomerSortPreference;
  orderView: OrderViewPreference;
  orderSort: OrderSortPreference;
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
export type CustomerSortPreference =
  | 'LAST_SEEN_DESC'
  | 'NAME_ASC'
  | 'NAME_DESC'
  | 'EMAIL_ASC'
  | 'EMAIL_DESC'
  | 'EMAIL_MARKETING_ASC'
  | 'EMAIL_MARKETING_DESC'
  | 'LOCATION_ASC'
  | 'LOCATION_DESC'
  | 'ORDER_COUNT_ASC'
  | 'ORDER_COUNT_DESC'
  | 'TOTAL_SPENT_ASC'
  | 'TOTAL_SPENT_DESC'
  | 'LAST_ORDER_ASC'
  | 'LAST_ORDER_DESC'
  | 'TAGS_ASC'
  | 'TAGS_DESC'
  | 'CUSTOMER_ADDED_ASC'
  | 'CUSTOMER_ADDED_DESC'
  | 'CUSTOMER_UPDATED_ASC'
  | 'CUSTOMER_UPDATED_DESC';
export type OrderViewPreference =
  'ALL' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'ATTENTION' | 'CANCELLED';
export type OrderSortPreference =
  | 'ORDER_NUMBER_ASC'
  | 'ORDER_NUMBER_DESC'
  | 'DATE_ASC'
  | 'DATE_DESC'
  | 'CUSTOMER_ASC'
  | 'CUSTOMER_DESC'
  | 'ITEMS_ASC'
  | 'ITEMS_DESC'
  | 'PAYMENT_ASC'
  | 'PAYMENT_DESC'
  | 'FULFILLMENT_ASC'
  | 'FULFILLMENT_DESC'
  | 'TOTAL_ASC'
  | 'TOTAL_DESC';

export const defaultAdminPreferences: AdminPreferences = Object.freeze({
  customerColumnsVersion: 2,
  sidebarCollapsed: false,
  customerColumns: [...customerColumns],
  customerView: 'ALL',
  customerSort: 'LAST_SEEN_DESC',
  orderView: 'ALL',
  orderSort: 'DATE_DESC',
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
      customerSort: isCustomerSort(parsed.customerSort) ? parsed.customerSort : 'LAST_SEEN_DESC',
      orderView: isOrderView(parsed.orderView) ? parsed.orderView : 'ALL',
      orderSort: isOrderSort(parsed.orderSort) ? parsed.orderSort : 'DATE_DESC',
    };
  } catch {
    return defaultAdminPreferences;
  }
}

function isOrderView(value: unknown): value is OrderViewPreference {
  return (
    typeof value === 'string' &&
    ['ALL', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'ATTENTION', 'CANCELLED'].includes(value)
  );
}

function isOrderSort(value: unknown): value is OrderSortPreference {
  return (
    typeof value === 'string' &&
    [
      'ORDER_NUMBER_ASC',
      'ORDER_NUMBER_DESC',
      'DATE_ASC',
      'DATE_DESC',
      'CUSTOMER_ASC',
      'CUSTOMER_DESC',
      'ITEMS_ASC',
      'ITEMS_DESC',
      'PAYMENT_ASC',
      'PAYMENT_DESC',
      'FULFILLMENT_ASC',
      'FULFILLMENT_DESC',
      'TOTAL_ASC',
      'TOTAL_DESC',
    ].includes(value)
  );
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

function isCustomerSort(value: unknown): value is CustomerSortPreference {
  return (
    typeof value === 'string' &&
    [
      'LAST_SEEN_DESC',
      'NAME_ASC',
      'NAME_DESC',
      'EMAIL_ASC',
      'EMAIL_DESC',
      'EMAIL_MARKETING_ASC',
      'EMAIL_MARKETING_DESC',
      'LOCATION_ASC',
      'LOCATION_DESC',
      'ORDER_COUNT_ASC',
      'ORDER_COUNT_DESC',
      'TOTAL_SPENT_ASC',
      'TOTAL_SPENT_DESC',
      'LAST_ORDER_ASC',
      'LAST_ORDER_DESC',
      'TAGS_ASC',
      'TAGS_DESC',
      'CUSTOMER_ADDED_ASC',
      'CUSTOMER_ADDED_DESC',
      'CUSTOMER_UPDATED_ASC',
      'CUSTOMER_UPDATED_DESC',
    ].includes(value)
  );
}
