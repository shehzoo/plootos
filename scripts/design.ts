// Design system: generated copy in the repository (decision of 2026-11-25).
// The reference is the Claude "Design System" artifact "Plootos". Its files are copied as they are
// into design/source/; this script turns them into the files the app and agents read:
//   web/src/design/tokens.css      CSS variables, @font-face, text styles
//   web/src/design/components.css  component styles (pl-*)
//   DESIGN.md                      the design system in the open DESIGN.md format (Google Labs, alpha)
// Usage: npm run design. web/test/design.test.ts fails when a generated file is out of date.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Token = { name: string; value: string | Record<string, string>; usage?: string }
type Family = { note?: string; tokens: Token[] }
type Style = { name: string; fontSize: string; lineHeight: number | string; fontWeight: number; letterSpacing?: string; sample?: string; usage?: string }
type Tokens = {
  color: { themes: { id: string; name: string }[]; tokens: Token[] }
  type: {
    fonts: { family: string; file: string; weight: string; style: string; features: string; unicodeRange: string }[]
    families: Record<string, string>
    groups: { name: string; family: string; styles: Style[] }[]
  }
  spacing: Family
  radius: Family
  shadow: Family
  size: Family
  duration: Family
  easing: Family
}

const HEADER = 'Généré depuis design/source/ par `npm run design`. Ne pas modifier : changer le design system dans son artefact, recopier ses fichiers, relancer.'

function themed(t: Token, theme: string): string {
  return typeof t.value === 'string' ? t.value : (t.value[theme] ?? Object.values(t.value)[0] ?? '')
}

function decl(tokens: Token[], theme?: string): string {
  return tokens.map((t) => `  --${t.name}: ${theme ? themed(t, theme) : (t.value as string)};`).join('\n')
}

/** The two themes, light first (tokens.json order). */
function themes(tk: Tokens): [string, string] {
  const [light, dark] = tk.color.themes.map((t) => t.id)
  if (!light || !dark) throw new Error('tokens.json : il faut deux thèmes de couleur')
  return [light, dark]
}

function tokensCss(tk: Tokens): string {
  const [light, dark] = themes(tk)
  const themedTokens = [...tk.color.tokens, ...tk.shadow.tokens]
  const fixed = [...tk.spacing.tokens, ...tk.radius.tokens, ...tk.size.tokens, ...tk.duration.tokens, ...tk.easing.tokens]
  const fonts = tk.type.fonts
    .map(
      (f) => `@font-face {
  font-family: '${f.family}';
  src: url('./${f.file}') format('woff2');
  font-weight: ${f.weight};
  font-style: ${f.style};
  font-display: swap;
  font-feature-settings: ${f.features};
  unicode-range: ${f.unicodeRange};
}`,
    )
    .join('\n\n')
  const families = Object.entries(tk.type.families)
    .map(([k, v]) => `  --font-${k}: ${v};`)
    .join('\n')
  const styles = tk.type.groups
    .flatMap((g) =>
      g.styles.map(
        (s) =>
          `.${s.name} {\n  font-family: var(--font-${g.family});\n  font-size: ${s.fontSize};\n  line-height: ${s.lineHeight};\n  font-weight: ${s.fontWeight};${s.letterSpacing ? `\n  letter-spacing: ${s.letterSpacing};` : ''}\n}`,
      ),
    )
    .join('\n\n')
  return `/* ${HEADER} */

${fonts}

:root {
  color-scheme: light dark;
${decl(themedTokens, light)}
${decl(fixed)}
${families}
}

@media (prefers-color-scheme: dark) {
  :root {
${decl(themedTokens, dark).replace(/^/gm, '  ')}
  }
}

:root[data-theme='${light}'] {
  color-scheme: light;
${decl(themedTokens, light)}
}

:root[data-theme='${dark}'] {
  color-scheme: dark;
${decl(themedTokens, dark)}
}

${styles}
`
}

function componentsCss(source: string): string {
  return `/* ${HEADER} */\n\n${source}`
}

const q = (s: string) => JSON.stringify(s)

/** The README's level-2 sections, by title; the text before the first one is the overview. */
function sections(readme: string): { overview: string; byTitle: Map<string, string> } {
  const parts = readme.split(/^## /m)
  const byTitle = new Map<string, string>()
  for (const p of parts.slice(1)) {
    const nl = p.indexOf('\n')
    byTitle.set(p.slice(0, nl).trim(), p.slice(nl + 1).trim())
  }
  return { overview: (parts[0] ?? '').trim(), byTitle }
}

function designMd(tk: Tokens, readme: string, components: [string, string][], assets: string[]): string {
  const [light, dark] = themes(tk)
  const y: string[] = ['---', 'version: alpha', 'name: Plootos', `description: ${q("Design system de Plootos, l'appli de budget familial : sauge, Figtree, chiffres d'abord, clair et sombre.")}`]
  y.push('colors:')
  for (const theme of [light, dark]) {
    y.push(`  ${theme}:`)
    for (const t of tk.color.tokens) y.push(`    ${t.name}: ${q(themed(t, theme))}`)
  }
  y.push('typography:')
  for (const g of tk.type.groups)
    for (const s of g.styles) {
      y.push(`  ${s.name}:`)
      y.push(`    fontFamily: ${q(tk.type.families[g.family] ?? '')}`)
      y.push(`    fontSize: ${s.fontSize}`)
      y.push(`    fontWeight: ${s.fontWeight}`)
      y.push(`    lineHeight: ${s.lineHeight}`)
      if (s.letterSpacing) y.push(`    letterSpacing: ${s.letterSpacing}`)
      y.push(`    fontFeature: ${q('"tnum" 1')}`)
    }
  y.push('rounded:')
  for (const t of tk.radius.tokens) y.push(`  ${t.name.replace(/^radius-/, '')}: ${t.value}`)
  y.push('spacing:')
  for (const t of tk.spacing.tokens) y.push(`  ${t.name}: ${t.value}`)
  y.push('motion:')
  const easing = tk.easing.tokens[0]?.value as string
  for (const t of tk.duration.tokens) {
    y.push(`  ${t.name.replace(/^duration-/, '')}:`)
    y.push(`    duration: ${t.value}`)
    y.push(`    timingFunction: ${q(easing)}`)
  }
  const c = (k: string) => `"{colors.${light}.${k}}"`
  y.push(
    'components:',
    '  button-primary:',
    `    backgroundColor: ${c('primary')}`,
    `    textColor: ${c('on-primary')}`,
    '    typography: "{typography.label}"',
    '    rounded: "{rounded.m}"',
    '    height: 36px',
    '    padding: 16px',
    '  button-secondary:',
    `    backgroundColor: ${c('surface-card')}`,
    `    textColor: ${c('ink')}`,
    '    typography: "{typography.label}"',
    '    rounded: "{rounded.m}"',
    '    height: 36px',
    '    padding: 16px',
    '  month-band:',
    `    backgroundColor: ${c('band')}`,
    `    textColor: ${c('on-band')}`,
    '    rounded: "{rounded.l}"',
    '    padding: 20px',
    '  progress-bar:',
    `    backgroundColor: ${c('progress-track')}`,
    `    textColor: ${c('progress')}`,
    '    rounded: "{rounded.full}"',
    '    height: 6px',
    '  status-pill-warn:',
    `    backgroundColor: ${c('warn-soft')}`,
    `    textColor: ${c('warn')}`,
    '    rounded: "{rounded.full}"',
    '    height: 22px',
    '  fab:',
    `    backgroundColor: ${c('primary')}`,
    `    textColor: ${c('on-primary')}`,
    '    rounded: "{rounded.full}"',
    '    size: 56px',
    '---',
  )
  const { overview, byTitle } = sections(readme)
  const take = (title: string) => {
    const s = byTitle.get(title)
    if (s === undefined) throw new Error(`Section « ${title} » absente du README du design system`)
    return s
  }
  const sizes = tk.size.tokens.map((t) => `- \`${t.name}\` : ${t.value}. ${t.usage ?? ''}`).join('\n')
  const shadows = tk.shadow.tokens.map((t) => `- \`${t.name}\` : clair \`${themed(t, light)}\`, sombre \`${themed(t, dark)}\`. ${t.usage ?? ''}`).join('\n')
  const colorTable = [
    '| Jeton | Clair | Sombre | Usage |',
    '|---|---|---|---|',
    ...tk.color.tokens.map((t) => `| \`${t.name}\` | ${themed(t, light)} | ${themed(t, dark)} | ${t.usage ?? ''} |`),
  ].join('\n')
  const compText = components
    .map(([name, md]) => `### ${name}\n\n${md.replace(/^# .*\n+/, '').replace(/^## /gm, '#### ')}`)
    .join('\n\n')
  const body = [
    `<!-- ${HEADER} -->`,
    '',
    '## Overview',
    '',
    overview,
    '',
    '## Colors',
    '',
    take('Couleurs'),
    '',
    colorTable,
    '',
    '## Typography',
    '',
    take('Typographie'),
    '',
    '## Layout',
    '',
    take('Mise en page et espacements'),
    '',
    sizes,
    '',
    take('Ordinateur et téléphone'),
    '',
    '## Elevation & Depth',
    '',
    take('Élévation'),
    '',
    shadows,
    '',
    '## Shapes',
    '',
    take('Formes'),
    '',
    '## Motion',
    '',
    take('Mouvement'),
    '',
    '## Voice & Content Strategy',
    '',
    take('Ton et contenu'),
    '',
    '## Components',
    '',
    "Styles dans `web/src/design/components.css` (classes `pl-*`), qui n'utilisent que les variables de `web/src/design/tokens.css`.",
    '',
    compText,
    '',
    '## Iconography',
    '',
    take('Iconographie'),
    '',
    '## Logo',
    '',
    take('Logo et icône'),
    '',
    assets.join('\n\n'),
    '',
    "## Do's and Don'ts",
    '',
    take('À faire et à éviter'),
    '',
  ]
  return `${y.join('\n')}\n\n${body.join('\n')}`
}

export function generate(root: string): Record<string, string> {
  const src = join(root, 'design/source')
  const tk = JSON.parse(readFileSync(join(src, 'tokens.json'), 'utf8')) as Tokens
  const readme = readFileSync(join(src, 'README.md'), 'utf8')
  const components = readdirSync(join(src, 'components'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => [f.replace(/\.md$/, ''), readFileSync(join(src, 'components', f), 'utf8')] as [string, string])
  const assets = ['logo.md', 'icones.md', 'police.md'].map((f) =>
    readFileSync(join(src, 'assets', f), 'utf8').replace(/^# (.*)$/m, '### $1').trim(),
  )
  return {
    'web/src/design/tokens.css': tokensCss(tk),
    'web/src/design/components.css': componentsCss(readFileSync(join(src, 'components.css'), 'utf8')),
    'DESIGN.md': designMd(tk, readme, components, assets),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  for (const [path, text] of Object.entries(generate(root))) {
    writeFileSync(join(root, path), text)
    console.log(`écrit : ${path}`)
  }
}
