export type OrderSelectionState = Readonly<{
  selected: ReadonlySet<string>;
  allMatchingSelected: boolean;
  excluded: ReadonlySet<string>;
}>;

export function clearOrderSelection(): OrderSelectionState {
  return { selected: new Set(), allMatchingSelected: false, excluded: new Set() };
}

export function selectAllMatchingOrders(): OrderSelectionState {
  return { selected: new Set(), allMatchingSelected: true, excluded: new Set() };
}

export function toggleOrder(state: OrderSelectionState, id: string): OrderSelectionState {
  if (state.allMatchingSelected) return { ...state, excluded: toggled(state.excluded, id) };
  return { ...state, selected: toggled(state.selected, id) };
}

export function toggleOrderPage(
  state: OrderSelectionState,
  visibleIds: readonly string[],
): OrderSelectionState {
  const key = state.allMatchingSelected ? 'excluded' : 'selected';
  const source = state[key];
  const pageIsSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => (state.allMatchingSelected ? !source.has(id) : source.has(id)));
  const next = new Set(source);
  for (const id of visibleIds) {
    if (state.allMatchingSelected) {
      if (pageIsSelected) next.add(id);
      else next.delete(id);
    } else if (pageIsSelected) next.delete(id);
    else next.add(id);
  }
  return { ...state, [key]: next };
}

export function countOrderSelection(state: OrderSelectionState, matchingTotal: number) {
  return state.allMatchingSelected
    ? Math.max(0, matchingTotal - state.excluded.size)
    : state.selected.size;
}

export function isOrderSelected(state: OrderSelectionState, id: string) {
  return state.allMatchingSelected ? !state.excluded.has(id) : state.selected.has(id);
}

function toggled(source: ReadonlySet<string>, value: string) {
  const next = new Set(source);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
