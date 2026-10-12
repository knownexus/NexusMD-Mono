import React from 'react'
import { PlModal } from '@nexusmd/ui'

const fieldStyle = { width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }

// Callers should pass key={prompt.id} so each prompt starts with fresh local state.
export function PromptDialog({ prompt, onAnswer, onCancel }) {
  const options = prompt.options || []
  const [choice, setChoice] = React.useState(prompt.default ?? options[0]?.value ?? '')
  const [text, setText] = React.useState(prompt.kind === 'text' ? (prompt.default ?? '') : '')
  const [ticked, setTicked] = React.useState([])
  const [firstFocus] = React.useState(() => (options.some(o => o.value === choice) ? choice : options[0]?.value))

  const confirmByButtons = prompt.kind === 'confirm' && !prompt.confirmWord && options.length > 0
  const okDisabled = prompt.kind === 'confirm' && prompt.confirmWord ? text !== prompt.confirmWord : false
  const canSubmit = !okDisabled && !confirmByButtons

  const submit = () => {
    if (prompt.kind === 'choice') return onAnswer(prompt.allowText && text.trim() ? text.trim() : choice)
    if (prompt.kind === 'multi') return onAnswer(options.map(o => o.value).filter(v => ticked.includes(v)))
    if (prompt.kind === 'confirm') return onAnswer(prompt.confirmWord ? text : 'y')
    return onAnswer(text)
  }

  // Radios and checkboxes never trigger implicit form submission, so Enter is handled here
  // for every kind (preventDefault also stops a text field's implicit submit firing twice).
  const onKeyDown = e => {
    if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return
    e.preventDefault()
    if (canSubmit) submit()
  }

  const footer = confirmByButtons ? (
    <>
      {options.map(o => <button key={o.value} className="btn" onClick={() => onAnswer(o.value)}>{o.label}</button>)}
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
    </>
  ) : (
    <>
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
      {/* Anything but the word is devenv's decline, which takes its safe branch. */}
      {prompt.kind === 'confirm' && prompt.confirmWord && <button className="btn" onClick={() => onAnswer('')}>No</button>}
      <button className="btn primary" onClick={submit} disabled={okDisabled}>OK</button>
    </>
  )

  // A stray backdrop click must not abort the command; Esc and Cancel still do.
  return (
    <PlModal open onClose={onCancel} closeOnBackdrop={false} icon="build" title={prompt.title || prompt.prompt} sub={prompt.detail} footer={footer}>
      <form onKeyDown={onKeyDown} onSubmit={e => { e.preventDefault(); if (canSubmit) submit() }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {prompt.kind === 'choice' && options.map(o => (
          <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <input type="radio" name={prompt.id} checked={choice === o.value} onChange={() => setChoice(o.value)} autoFocus={o.value === firstFocus} />
            <span>{o.label}{o.hint && <span style={{ color: 'var(--text-muted)' }}> — {o.hint}</span>}</span>
          </label>
        ))}
        {prompt.kind === 'choice' && prompt.allowText && (
          <input aria-label="Or type a value" placeholder="Or type a value" value={text} onChange={e => setText(e.target.value)} style={fieldStyle} />
        )}
        {prompt.kind === 'multi' && options.map(o => (
          <label key={o.value} style={{ display: 'flex', gap: 8 }}>
            <input type="checkbox" checked={ticked.includes(o.value)} autoFocus={o.value === firstFocus}
              onChange={e => setTicked(t => e.target.checked ? [...t, o.value] : t.filter(v => v !== o.value))} />
            <span>{o.label}</span>
          </label>
        ))}
        {prompt.kind === 'confirm' && prompt.confirmWord && (
          <input aria-label={`Type ${prompt.confirmWord} to confirm`} placeholder={prompt.confirmWord} value={text} onChange={e => setText(e.target.value)} style={fieldStyle} autoFocus />
        )}
        {prompt.kind === 'confirm' && !prompt.confirmWord && !options.length && <div>{prompt.prompt}</div>}
        {prompt.kind === 'text' && (
          <input aria-label={prompt.title || prompt.prompt} value={text} onChange={e => setText(e.target.value)} style={fieldStyle} autoFocus />
        )}
        {prompt.kind === 'secret' && (
          <input aria-label={prompt.title || prompt.prompt} type="password" autoComplete="off" value={text} onChange={e => setText(e.target.value)} style={fieldStyle} autoFocus />
        )}
      </form>
    </PlModal>
  )
}
