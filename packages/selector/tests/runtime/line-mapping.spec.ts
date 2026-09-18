import { describe, expect, it } from 'vitest'
import {
  normalizeTerminalLines,
  normalizeTerminalText,
} from '../../src/runtime/reducers.ts'

/** R9a drift harness: `retrieve` reads the ORIGINAL event, so every line
 *  number a reducer prints must point back into the original event, not into
 *  the normalized text. The assertions below pin EXACT original line numbers —
 *  removing the mapping (or off-by-oneing it) fails these cases, which is the
 *  reverse-proof the R9a acceptance asks for. */

describe('normalizeTerminalLines', () => {
  it('keeps folded lines 1:1 with the original event through ANSI + \\r redraw + adjacent dups', () => {
    // Original event, 1-based:
    //   1  staging files...            (ANSI-decorated)
    //   2  progress 10%
    //   3  progress 10%                (adjacent dup)
    //   4  progress 10%                (adjacent dup)
    //   5  Downloaded 100%             (\r redraw of one physical line)
    //   6  done                        (ANSI-decorated)
    const original = [
      '\u001B[32mstaging files...\u001B[0m',
      'progress 10%',
      'progress 10%',
      'progress 10%',
      'Downloaded 50%\rDownloaded 100%',
      '\u001B[1mdone\u001B[0m',
    ].join('\n')

    const { folded, text } = normalizeTerminalLines(original)

    expect(folded).toEqual([
      { text: 'staging files...', originalLine: 1 },
      { text: 'progress 10%', originalLine: 2 },
      { text: '[previous line repeated 2 more times]', originalLine: 3, originalLineEnd: 4 },
      { text: 'Downloaded 100%', originalLine: 5 },
      { text: 'done', originalLine: 6 },
    ])
    // The folded text is byte-identical with the string API.
    expect(text).toBe(normalizeTerminalText(original))
    expect(text).toBe([
      'staging files...',
      'progress 10%',
      '[previous line repeated 2 more times]',
      'Downloaded 100%',
      'done',
    ].join('\n'))
  })

  it('maps every kept line back to the same original line through ANSI stripping alone', () => {
    const original = ['\u001B[1malpha\u001B[0m', 'beta', '\u001B[31mgamma\u001B[0m'].join('\n')
    const { folded } = normalizeTerminalLines(original)
    expect(folded.map(line => [line.text, line.originalLine])).toEqual([
      ['alpha', 1],
      ['beta', 2],
      ['gamma', 3],
    ])
  })

  it('never changes the line count before folding (logical 1:1 original)', () => {
    // \r redraws and ANSI escapes consume no newlines, so even a line that
    // redraws many times stays one logical line. A trailing newline keeps its
    // empty logical line (byte-compatibility with the string API).
    const original = 'a\rb\rc\rd\nx\n\u001B[2Ky\n'
    const { folded } = normalizeTerminalLines(original)
    expect(folded.map(line => line.text)).toEqual(['d', 'x', 'y', ''])
    expect(folded.map(line => line.originalLine)).toEqual([1, 2, 3, 4])
  })

  it('pins the repeat-marker range to the occurrences it replaces', () => {
    const original = ['head', 'same', 'same', 'same', 'same', 'tail'].join('\n')
    const { folded } = normalizeTerminalLines(original)
    expect(folded).toEqual([
      { text: 'head', originalLine: 1 },
      { text: 'same', originalLine: 2 },
      { text: '[previous line repeated 3 more times]', originalLine: 3, originalLineEnd: 5 },
      { text: 'tail', originalLine: 6 },
    ])
  })
})

/** 口径对拍 (task_2.3): `splitLines` (reducers.ts) and `splitScannedLines`
 *  (retrieve.ts) must count lines identically — both split on '\n' and drop
 *  only the trailing empty element when the text ends with a newline. retrieve
 *  scans the raw event, reducers see normalized text; the R9a mapping above is
 *  what keeps the two line spaces reconcilable. The behavioral proof lives in
 *  the drift cases; this suite pins the reducer-side convention. */
describe('line-splitting conventions', () => {
  it('reducer-side folded lines join back to the text splitLines would produce', () => {
    const original = 'one\ntwo\nthree'
    const { folded, text } = normalizeTerminalLines(original)
    expect(text.split('\n')).toEqual(folded.map(line => line.text))
    expect(folded).toHaveLength(3)
  })
})
