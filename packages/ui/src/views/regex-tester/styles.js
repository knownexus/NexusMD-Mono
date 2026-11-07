// The Regex Tester's styles, theme variables only (the one fixed palette is the capture-group colours).
export const REGEX_CSS = `.nx-rt-page { display: grid; grid-template-columns: 240px minmax(0, 1fr) 360px; height: 100%; min-height: 0; overflow: hidden; background: var(--bg); color: var(--text); font-size: 13px; }
.nx-rt-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: auto; }
.nx-rt-rail { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: auto; background: var(--surface); border-left: 1px solid var(--border); }
.nx-rt-eyebrow { font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); white-space: nowrap; }
.nx-rt-note { padding: 6px 4px; font-size: 12px; color: var(--text-muted); }

/* Saved patterns */
.nx-rt-saved { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; overflow: auto; padding: 12px 10px; background: var(--bg); border-right: 1px solid var(--border); }
.nx-rt-saved-head { display: flex; align-items: center; gap: 8px; }
.nx-rt-count { font-size: 11.5px; color: var(--text-muted); }
.nx-rt-new { margin-left: auto; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text); cursor: pointer; }
.nx-rt-new:hover { background: var(--surface-3); }
.nx-rt-filter { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text-muted); }
.nx-rt-filter:focus-within { border-color: var(--accent); }
.nx-rt-filter input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--text); font: inherit; font-size: 12.5px; }
.nx-rt-saved-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.nx-rt-saved-row { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 7px 8px; border: 1px solid transparent; border-radius: 7px; background: transparent; text-align: left; cursor: pointer; font: inherit; color: var(--text); }
.nx-rt-saved-row:hover { background: var(--surface-2); }
.nx-rt-saved-row[aria-current="true"] { background: var(--accent-soft); border-color: var(--accent-border); }
.nx-rt-saved-top { display: flex; align-items: baseline; gap: 8px; }
.nx-rt-saved-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 500; }
.nx-rt-saved-when { flex: none; font-size: 11px; color: var(--text-muted); }
.nx-rt-pattern { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px var(--mono); color: var(--accent); }
.nx-rt-menu { position: fixed; z-index: 1000; min-width: 150px; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--shadow-pop); display: flex; flex-direction: column; }
.nx-rt-menu button { padding: 6px 10px; border: 0; border-radius: 4px; background: transparent; color: var(--text); text-align: left; font: inherit; font-size: 12.5px; cursor: pointer; }
.nx-rt-menu button:hover { background: var(--surface-2); }
.nx-rt-menu button[data-danger] { color: var(--danger); }

/* Expression bar */
.nx-rt-bar { flex: none; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; background: var(--surface); border-bottom: 1px solid var(--border); }
.nx-rt-bar-row { display: flex; align-items: center; gap: 10px; }
.nx-rt-pattern-field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; height: 40px; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); font: 500 15px var(--mono); }
.nx-rt-pattern-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.nx-rt-pattern-field[data-invalid="true"] { border-color: var(--danger); }
.nx-rt-slash { flex: none; color: var(--text-muted); }
.nx-rt-pattern-wrap { position: relative; flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; }
.nx-rt-overlay { position: absolute; inset: 0; display: flex; align-items: center; overflow: hidden; white-space: pre; pointer-events: none; font: inherit; }
.nx-rt-pattern-input { position: relative; width: 100%; height: 100%; padding: 0; border: 0; outline: 0; background: transparent; color: transparent; caret-color: var(--text); font: inherit; }
.nx-rt-pattern-input::placeholder { color: var(--text-subtle); }
.nx-rt-flags { flex: none; display: inline-flex; gap: 2px; margin-left: 4px; }
.nx-rt-flag { width: 22px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--text-muted); font: 500 13px var(--mono); cursor: pointer; }
.nx-rt-flag[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
.nx-rt-chip { flex: none; display: inline-flex; align-items: center; height: 26px; padding: 0 9px; border-radius: 5px; font: 600 11.5px var(--mono); white-space: nowrap; }
.nx-rt-chip[data-tone="success"] { background: var(--success-soft); color: var(--success); }
.nx-rt-chip[data-tone="warning"] { background: var(--warning-soft); color: var(--warning); }
.nx-rt-chip[data-tone="danger"] { background: var(--danger-soft); color: var(--danger); }
.nx-rt-chip[data-tone="muted"] { background: var(--surface-2); color: var(--text-muted); }
.nx-rt-stepper { flex: none; display: inline-flex; align-items: center; height: 28px; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.nx-rt-stepper button { width: 24px; height: 100%; border: 0; background: transparent; color: var(--text); cursor: pointer; font-size: 14px; }
.nx-rt-stepper button:hover:not(:disabled) { background: var(--surface-2); }
.nx-rt-stepper button:disabled { opacity: .35; cursor: default; }
.nx-rt-stepper span { min-width: 44px; padding: 0 4px; text-align: center; font: 11px var(--mono); color: var(--text-muted); }
.nx-rt-error { display: flex; align-items: center; gap: 6px; font: 12px var(--mono); color: var(--danger); }
.nx-rt-replace { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
.nx-rt-replace .nx-rt-pattern-wrap { font: 14px var(--mono); }
.nx-rt-hint { flex: none; font-size: 11px; color: var(--text-muted); white-space: nowrap; }
/* Test text */
.nx-rt-test { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.nx-rt-cases { flex: none; display: flex; align-items: center; gap: 12px; height: 36px; padding: 0 12px; background: var(--surface); border-bottom: 1px solid var(--border); }
.nx-rt-case-tabs { display: flex; align-items: flex-end; align-self: stretch; gap: 2px; overflow-x: auto; }
.nx-rt-case { height: 100%; padding: 0 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-muted); font: 600 12.5px var(--sans); cursor: pointer; white-space: nowrap; }
.nx-rt-case:hover { color: var(--text); }
.nx-rt-case[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.nx-rt-case-add { align-self: center; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--text-muted); cursor: pointer; }
.nx-rt-case-add:hover { background: var(--surface-2); color: var(--text); }
.nx-rt-legend { margin-left: auto; display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.nx-rt-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.nx-rt-swatch { width: 10px; height: 3px; border-radius: 1px; }
.nx-rt-panes { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); background: var(--bg); }
.nx-rt-panes[data-split] { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.nx-rt-editor { display: grid; grid-template-columns: 48px minmax(0, 1fr); min-width: 0; min-height: 0; }
.nx-rt-gutter { overflow: hidden; padding: 12px 8px 12px 0; text-align: right; font: 13.5px/28px var(--mono); color: var(--text-muted); opacity: .5; user-select: none; }
.nx-rt-gutter span { display: block; }
.nx-rt-editor-body { position: relative; min-width: 0; min-height: 0; }
.nx-rt-editor-body .nx-rt-overlay { position: absolute; inset: 0; padding: 12px 12px 12px 4px; overflow: hidden; white-space: pre; font: 13.5px/28px var(--mono); color: var(--text); pointer-events: none; }
.nx-rt-textarea { position: absolute; inset: 0; width: 100%; height: 100%; padding: 12px 12px 12px 4px; box-sizing: border-box; border: 0; outline: 0; resize: none; background: transparent; color: transparent; caret-color: var(--text); font: 13.5px/28px var(--mono); white-space: pre; overflow: auto; }
mark.nx-rt-m { background: var(--warning-soft); border-bottom: 2px solid var(--warning); border-radius: 2px; color: inherit; padding: 0; }
mark.nx-rt-m.sel { background: color-mix(in srgb, var(--warning) 26%, transparent); box-shadow: 0 0 0 1px var(--warning); }
.nx-rt-result { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-left: 1px solid var(--border); }
.nx-rt-result-head { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 0; }
.nx-rt-ghost { height: 24px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; color: var(--accent); font-size: 11.5px; cursor: pointer; }
.nx-rt-ghost:hover:not(:disabled) { background: var(--surface-2); }
.nx-rt-ghost:disabled { opacity: .4; cursor: default; }
.nx-rt-result-text { flex: 1; min-height: 0; overflow: auto; padding: 4px 12px 12px; white-space: pre; font: 13.5px/28px var(--mono); color: var(--text); }
.nx-rt-replaced { background: var(--success-soft); border-radius: 2px; }
.nx-rt-foot { flex: none; display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 14px; background: var(--surface); border-top: 1px solid var(--border); font: 11px var(--mono); color: var(--text-muted); }
`
