// packages/ui/src/views/db-grid-menus.js
//
// The Browse grid's right-click menus, as DbMenu items (see db-menu.jsx). Pure: the page passes
// what's true of the clicked header or cell, and the actions to run.

const SEP = { separator: true }

/**
 * A column header's menu.
 * @param {{ column: string, sorted: 'asc'|'desc'|null, anyMinimised: boolean, foreignKey: object|null,
 *   onSort(dir: 'asc'|'desc'|null), onMinimise(), onRestoreAll(), onCopyName(), onCopyValues(),
 *   onFilterEmpty(empty: boolean), onGoToKey(fk) }} ctx
 */
export function headerMenuItems(ctx) {
  const { sorted, anyMinimised, foreignKey } = ctx
  return [
    { label: 'Sort ascending', icon: 'arrow-up', disabled: sorted === 'asc', onSelect: () => ctx.onSort('asc') },
    { label: 'Sort descending', icon: 'arrow-down', disabled: sorted === 'desc', onSelect: () => ctx.onSort('desc') },
    ...(sorted ? [{ label: 'Clear sort', icon: 'x', onSelect: () => ctx.onSort(null) }] : []),
    SEP,
    { label: 'Minimise column', icon: 'collapse', onSelect: ctx.onMinimise },
    ...(anyMinimised ? [{ label: 'Show all minimised columns', icon: 'expand', onSelect: ctx.onRestoreAll }] : []),
    SEP,
    { label: 'Copy column name', icon: 'copy', onSelect: ctx.onCopyName },
    { label: 'Copy values', icon: 'copy', onSelect: ctx.onCopyValues },
    SEP,
    { label: 'Show only empty (NULL)', icon: 'filter', onSelect: () => ctx.onFilterEmpty(true) },
    { label: 'Show only not empty', icon: 'filter', onSelect: () => ctx.onFilterEmpty(false) },
    ...(foreignKey ? [{ label: 'Go to foreign key target…', icon: 'link', title: `→ ${foreignKey.refTable}`, onSelect: () => ctx.onGoToKey(foreignKey) }] : []),
  ]
}

/**
 * A row's menu, for the clicked cell. `count` is how many rows the copy and delete items act on
 * (the ticked rows, when the click was on one of several); edit, Set to NULL, duplicate and follow
 * act on the clicked row only. A view gets the copy items alone.
 * @param {{ canEdit: boolean, editReason: string|null, columnReadonly: boolean, columnBoolean: boolean,
 *   nullable: boolean|null (null: not known yet), isView: boolean, count: number, canDelete: boolean, deleteReason: string,
 *   canDuplicate: boolean, follows: object[], references: object[],
 *   onEdit(), onSetNull(), onCopyCell(), onCopyRows(), onCopyInsert(), onDuplicate(), onFollow(target), onDelete() }} ctx
 */
export function rowMenuItems(ctx) {
  const { canEdit, editReason, columnReadonly, columnBoolean, nullable, isView, count, follows, references } = ctx
  const many = count > 1
  const copies = [
    { label: 'Copy cell', icon: 'copy', onSelect: ctx.onCopyCell },
    { label: many ? `Copy ${count} rows` : 'Copy row', icon: 'copy', onSelect: ctx.onCopyRows },
    { label: many ? `Copy ${count} rows as INSERT` : 'Copy as INSERT', icon: 'copy', onSelect: ctx.onCopyInsert },
  ]
  if (isView) return copies

  // Off for the whole table first (no key), then for this column (the database writes it, or
  // it's a checkbox clicked in place).
  const editOff = !canEdit ? editReason : columnReadonly ? 'Set by the database' : columnBoolean ? 'Click its checkbox to change it' : null
  const nullOff = !canEdit ? editReason : null
  const links = [
    ...follows.map(t => ({ label: `Follow ${t.label}`, icon: 'arrow-right', onSelect: () => ctx.onFollow(t) })),
    ...(references.length ? [{
      label: 'Show rows that reference this', icon: 'link',
      submenu: references.map(t => ({ label: t.label, onSelect: () => ctx.onFollow(t) })),
    }] : []),
  ]
  return [
    { label: 'Edit cell', icon: 'edit', disabled: !!editOff, title: editOff ?? undefined, onSelect: ctx.onEdit },
    // Left out only where the column is known not to take NULL; unknown, it's offered (and checked on save).
    ...(nullable !== false && !columnReadonly ? [{ label: 'Set to NULL', icon: 'x', disabled: !!nullOff, title: nullOff ?? undefined, onSelect: ctx.onSetNull }] : []),
    SEP,
    ...copies,
    { label: 'Duplicate row…', icon: 'plus', disabled: !ctx.canDuplicate, title: ctx.canDuplicate ? undefined : 'Reading the table’s columns…', onSelect: ctx.onDuplicate },
    ...(links.length ? [SEP, ...links] : []),
    SEP,
    { label: many ? `Delete ${count} rows` : 'Delete row', icon: 'trash', danger: true,
      disabled: !ctx.canDelete, title: ctx.canDelete ? undefined : ctx.deleteReason, onSelect: ctx.onDelete },
  ]
}
