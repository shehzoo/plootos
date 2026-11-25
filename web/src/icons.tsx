// The four icons of the design system (design/source/icons/), drawn in currentColor: they take
// the colour of their text. A lone icon gets its accessible name from its button.

const PATHS = {
  'chevron-gauche': 'M15 5l-7 7 7 7',
  'chevron-droite': 'M9 5l7 7-7 7',
  'chevron-bas': 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
