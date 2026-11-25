// The design system's generated files match their source (design/source/, copied from the artifact).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generate } from '../../scripts/design'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const files = generate(root)

describe('design system', () => {
  for (const [path, text] of Object.entries(files)) {
    it(`${path} est à jour (sinon : npm run design)`, () => {
      expect(readFileSync(join(root, path), 'utf8')).toBe(text)
    })
  }

  it('chaque couleur a sa valeur claire et sombre', () => {
    const tokens = JSON.parse(readFileSync(join(root, 'design/source/tokens.json'), 'utf8')) as {
      color: { tokens: { name: string; value: Record<string, string> }[] }
    }
    for (const t of tokens.color.tokens) {
      expect(t.value.light, t.name).toMatch(/^#[0-9a-f]{6}$/)
      expect(t.value.dark, t.name).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it("n'écrit aucune couleur en dur dans les styles des composants", () => {
    const css = files['web/src/design/components.css']!.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
  })
})
