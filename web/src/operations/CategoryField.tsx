// The category field (spec 3.3): « quelques lettres suffisent, « cha » trouve Courses > Chats »,
// the same everywhere (manual entry, record, Catégoriser, « Mettre dans… », split). A combobox:
// typing filters the list, the arrows move in it, Enter takes the highlighted category, then the
// screen may move on (`onEnter`). A suggestion (R11) is shown in italics until changed.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Id } from '../../../shared/src/engine'
import { exactCategory, matchCategories, type CategoryChoice } from './entry'

let fieldCount = 0

export function CategoryField(props: {
  choices: CategoryChoice[]
  value: Id | null
  /** Label of the value when it is no longer a choice (« Courses (sans détail) »). */
  valueLabel?: string
  onChange: (id: Id | null) => void
  /** Enter once a category is taken: e.g. move to the next operation. */
  onEnter?: () => void
  suggested?: boolean
  label: string
  placeholder?: string
  autoFocus?: boolean
  /** Shown empty and cleared after each choice (« Mettre dans… »). */
  action?: boolean
  name?: string
}) {
  const { choices, value } = props
  const id = useMemo(() => `catfield-${++fieldCount}`, [])
  const labelOf = (v: Id | null) => (v === null ? '' : (choices.find((c) => c.id === v)?.label ?? props.valueLabel ?? ''))
  const [text, setText] = useState(() => (props.action ? '' : labelOf(value)))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [typed, setTyped] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // The value changed from outside (« Mettre dans… », a reload): show it.
  useEffect(() => {
    if (!props.action && !typed) setText(labelOf(value))
  }, [value, choices])

  const matches = matchCategories(choices, typed ? text : '').slice(0, 50)
  const invalid = !props.action && !open && typed && text.trim() !== '' && value === null

  const take = (c: CategoryChoice) => {
    setOpen(false)
    setTyped(false)
    setText(props.action ? '' : c.label)
    props.onChange(c.id)
  }

  const onInput = (raw: string) => {
    setText(raw)
    setTyped(true)
    setOpen(true)
    setActive(0)
    if (props.action) return
    const exact = exactCategory(choices, raw)
    if (exact) props.onChange(exact.id)
    else if (value !== null) props.onChange(null)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, Math.max(0, matches.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = open && typed ? matches[active] : undefined
      if (pick) take(pick)
      if (pick || !typed || value !== null) props.onEnter?.()
    }
  }

  const onBlur = () => {
    setOpen(false)
    if (!typed) return
    // A few letters that lead to one category only: it is taken.
    if (value === null && text.trim() !== '' && matches.length === 1 && matches[0]) take(matches[0])
    else if (value !== null) {
      setTyped(false)
      setText(props.action ? '' : labelOf(value))
    }
  }

  const sugg = !!props.suggested && value !== null && !typed
  return (
    <span class={`catfield${sugg ? ' catfield--sugg' : ''}`} data-catfield={props.name}>
      <span class={`pl-input catfield__box${invalid ? ' pl-input--error' : ''}`}>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={props.label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${id}-${matches[active].id}` : undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          autoFocus={props.autoFocus}
          placeholder={props.placeholder ?? 'Taper pour chercher'}
          title={sugg ? 'Suggérée d’après le libellé de la banque' : undefined}
          value={text}
          onInput={(e) => onInput((e.target as HTMLInputElement).value)}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </span>
      {open && (
        <ul class="catfield__list body" id={`${id}-list`} role="listbox" aria-label={props.label}>
          {matches.length === 0 && <li class="catfield__none caption pl-muted">Aucune catégorie</li>}
          {matches.map((c, i) => (
            <li
              key={c.id}
              id={`${id}-${c.id}`}
              role="option"
              aria-selected={i === active}
              class="catfield__opt"
              // Taken before the field loses focus.
              onMouseDown={(e) => {
                e.preventDefault()
                take(c)
              }}
            >
              {c.label}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
