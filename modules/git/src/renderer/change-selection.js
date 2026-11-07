import { rangeSelection, toggleSelection } from '@nexusmd/core'

/**
 * The selection after a click on change `id`, in the order the lanes show them (`ordered`: [{ id }]).
 * A plain click selects only that change; Ctrl / Cmd toggles it; Shift adds the range from the focused
 * change (`focusId`) to it, keeping what was selected. Shift with nothing focused selects just `id`.
 */
export function nextSelection({ ordered, selected, focusId }, id, { shift = false, ctrl = false } = {}) {
  if (ctrl) return toggleSelection(selected, id)
  if (shift) return focusId ? rangeSelection(ordered, selected, focusId, id) : [id]
  return [id]
}
