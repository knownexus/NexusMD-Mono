import React from 'react'
import { PromptDialog } from './prompt-dialog.jsx'
import { PlanDialog } from './plan-dialog.jsx'
import { RefPickerDialog } from './ref-picker-dialog.jsx'

// Plan and branch prompts answer with an object and close by answering (never by a protocol
// cancel), so only the plain kinds get onCancel. Callers pass key={prompt.id}.
export function PromptHost({ prompt, onAnswer, onCancel }) {
  if (prompt.kind === 'plan') return <PlanDialog prompt={prompt} onAnswer={onAnswer} />
  if (prompt.kind === 'ref') return <RefPickerDialog prompt={prompt} onAnswer={onAnswer} />
  return <PromptDialog prompt={prompt} onAnswer={onAnswer} onCancel={onCancel} />
}
