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
      { text: 'staging files...', content: 'staging files...', originalLine: 1 },
      { text: 'progress 10%', content: 'progress 10%', originalLine: 2 },
      {
        text: '[previous line repeated 2 more times]',
        content: '[previous line repeated 2 more times]',
        originalLine: 3,
        originalLineEnd: 4,
      },
      { text: 'Downloaded 100%', content: 'Downloaded 100%', originalLine: 5 },
      { text: 'done', content: 'done', originalLine: 6 },
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
      { text: 'head', content: 'head', originalLine: 1 },
      { text: 'same', content: 'same', originalLine: 2 },
      {
        text: '[previous line repeated 3 more times]',
        content: '[previous line repeated 3 more times]',
        originalLine: 3,
        originalLineEnd: 5,
      },
      { text: 'tail', content: 'tail', originalLine: 6 },
    ])
  })

  // GF-1 dual view (spec.md 「行号修复补丁 GF-1」): a block-detected read
  // gutter is stripped on the CONTENT view only — the output view keeps the
  // host's `N: ` prefixes byte-for-byte because they are the model's only
  // inline locator into the original file, while form detection and the fold
  // keys must not see them.
  it('strips a detected read gutter on the content view and keeps it on the output view', () => {
    const original = [
      '1: export function alpha() {',
      '2:   return 1',
      '3: }',
      '4: ',
      '5: export function beta() {',
      '6: }',
    ].join('\n')
    const { folded, text, contentText } = normalizeTerminalLines(original)
    // Output view: the gutter is preserved verbatim.
    expect(text).toBe(original)
    // Content view: the gutter is gone.
    expect(contentText).toBe([
      'export function alpha() {',
      '  return 1',
      '}',
      '',
      'export function beta() {',
      '}',
    ].join('\n'))
    // Every folded line still maps 1:1 into the original event.
    expect(folded.map(line => line.originalLine)).toEqual([1, 2, 3, 4, 5, 6])
    expect(folded.map(line => line.content)).toEqual([
      'export function alpha() {',
      '  return 1',
      '}',
      '',
      'export function beta() {',
      '}',
    ])
  })

  it('does not strip a stray time-of-day colon as a read gutter (block-level guard)', () => {
    // Only 1 of 5 non-empty lines is gutter-shaped, and the "numbers" are not
    // strictly increasing — the block guard must keep both views intact.
    const original = ['meeting at 12:30 pm', 'standup at 9:15 am', 'retro at 4:45 pm', 'done'].join('\n')
    const { text, contentText } = normalizeTerminalLines(original)
    expect(text).toBe(original)
    expect(contentText).toBe(original)
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
