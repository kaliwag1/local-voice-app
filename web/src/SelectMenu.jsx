import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

// A themed stand-in for <select>. Windows draws a native select's open list
// itself (white, square, system font) and no CSS reaches it, which looked out
// of place in the chat. Same contract as a controlled select: value in,
// onChange(value) out. Keyboard: arrows, Home/End, Enter/Space, Escape and
// type-ahead, like the native one.
export default function SelectMenu({
  id,
  value,
  options = [],
  onChange = () => {},
  disabled = false,
  ariaLabel,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [active, setActive] = useState(-1)
  const root = useRef(null)
  const listRef = useRef(null)
  const typed = useRef({ text: '', timer: null })
  const listId = `${useId()}-list`
  const selectedIndex = options.findIndex(option => option.value === value)
  const current = options[selectedIndex]

  useEffect(() => {
    if (!open) return undefined
    const away = event => {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('blur', away)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('blur', away)
    }
  }, [open])

  // Open upwards when there is no room below - the composer sits at the bottom
  // of the window, so this is the usual case there.
  useLayoutEffect(() => {
    if (!open || !root.current || !listRef.current) return
    const box = root.current.getBoundingClientRect()
    const below = window.innerHeight - box.bottom
    const needed = Math.min(listRef.current.scrollHeight, 280) + 12
    setUp(below < needed && box.top > below)
  }, [open])

  useEffect(() => {
    if (!open) return
    const row = listRef.current?.children[active]
    row?.focus({ preventScroll: true })
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  const enabled = index => index >= 0 && index < options.length && !options[index].disabled

  const show = () => {
    if (disabled) return
    const start = enabled(selectedIndex) ? selectedIndex : options.findIndex(option => !option.disabled)
    setActive(start)
    setOpen(true)
  }

  const hide = ({ focus = true } = {}) => {
    setOpen(false)
    if (focus) root.current?.querySelector('.select-menu-trigger')?.focus()
  }

  const choose = index => {
    if (!enabled(index)) return
    hide()
    if (options[index].value !== value) onChange(options[index].value)
  }

  const step = direction => {
    for (let index = active + direction; index >= 0 && index < options.length; index += direction) {
      if (enabled(index)) return setActive(index)
    }
    return undefined
  }

  const typeAhead = key => {
    clearTimeout(typed.current.timer)
    typed.current.text += key.toLocaleLowerCase()
    typed.current.timer = setTimeout(() => { typed.current.text = '' }, 700)
    const from = typed.current.text.length > 1 ? active - 1 : active
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (from + offset + options.length) % options.length
      if (enabled(index) && options[index].label.toLocaleLowerCase().startsWith(typed.current.text)) {
        setActive(index)
        return
      }
    }
  }

  const onTriggerKey = event => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      show()
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      show()
      typeAhead(event.key)
    }
  }

  const onListKey = event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      hide()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      step(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const order = options.map((_, index) => index)
      const found = (event.key === 'Home' ? order : order.reverse()).find(enabled)
      if (found !== undefined) setActive(found)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Tab') {
      hide({ focus: false })
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      typeAhead(event.key)
    }
  }

  return <div ref={root} className={`select-menu${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
    <button
      id={id}
      type="button"
      className="select-menu-trigger"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-label={ariaLabel ? `${ariaLabel}: ${current?.label || ''}` : undefined}
      onClick={() => (open ? hide() : show())}
      onKeyDown={onTriggerKey}
    >
      <span className="select-menu-label">{current?.label || ''}</span>
      <svg className="select-menu-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" /></svg>
    </button>
    {open && <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={ariaLabel}
      className={`select-menu-list${up ? ' up' : ''}`}
      onKeyDown={onListKey}
    >
      {options.map((option, index) => <button
        key={option.value}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={option.value === value}
        disabled={option.disabled}
        className="select-menu-option"
        onClick={() => choose(index)}
        onPointerMove={() => { if (enabled(index) && index !== active) setActive(index) }}
      >{option.label}</button>)}
    </div>}
  </div>
}
