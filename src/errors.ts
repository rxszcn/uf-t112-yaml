import type { Primitive } from './nodes/types.ts'
import type { LineCounter } from './parse/line-counter.ts'

export type ErrorCode =
  | 'ALIAS_PROPS'
  | 'BAD_ALIAS'
  | 'BAD_DIRECTIVE'
  | 'BAD_DQ_ESCAPE'
  | 'BAD_INDENT'
  | 'BAD_PROP_ORDER'
  | 'BAD_SCALAR_START'
  | 'BLOCK_AS_IMPLICIT_KEY'
  | 'BLOCK_IN_FLOW'
  | 'DUPLICATE_KEY'
  | 'IMPOSSIBLE'
  | 'KEY_OVER_1024_CHARS'
  | 'MISSING_CHAR'
  | 'MULTILINE_IMPLICIT_KEY'
  | 'MULTIPLE_ANCHORS'
  | 'MULTIPLE_DOCS'
  | 'MULTIPLE_TAGS'
  | 'NON_STRING_KEY'
  | 'RESOURCE_EXHAUSTION'
  | 'TAB_AS_INDENT'
  | 'TAG_RESOLVE_FAILED'
  | 'UNEXPECTED_TOKEN'
  | 'BAD_COLLECTION_TYPE'

export type LinePos = { line: number; col: number }

/**
 * A single node-path segment: a resolved map key or a sequence index.
 */
export type NodePathSegment = Primitive

/**
 * Path to the node or container that an error or warning relates to,
 * using the same key/index values as `Document#get()` / `Document#getPair()`.
 *
 * Map keys are represented by their resolved scalar value and sequence items
 * by their zero-based index. An empty array points at the document root.
 */
export type NodePath = readonly NodePathSegment[]

export class YAMLError extends Error {
  name: 'YAMLParseError' | 'YAMLWarning'
  code: ErrorCode
  message: string
  pos: [number, number]
  linePos?: [LinePos] | [LinePos, LinePos]

  /**
   * Path to the node or containing collection of the error.
   * The key/index values match the document model's `get()`/`getPair()`
   * accessors; an empty array identifies the document root.
   */
  nodePath: NodePath

  /**
   * The verbatim source text slice covered by `pos`, once the error has been
   * associated with its input source. `undefined` until that happens.
   */
  source?: string

  constructor(
    name: YAMLError['name'],
    pos: [number, number],
    code: ErrorCode,
    message: string,
    nodePath: NodePath = []
  ) {
    super()
    this.name = name
    this.code = code
    this.message = message
    this.pos = pos
    this.nodePath = nodePath
  }
}

export class YAMLParseError extends YAMLError {
  constructor(
    pos: [number, number],
    code: ErrorCode,
    message: string,
    nodePath?: NodePath
  ) {
    super('YAMLParseError', pos, code, message, nodePath)
  }
}

export class YAMLWarning extends YAMLError {
  constructor(
    pos: [number, number],
    code: ErrorCode,
    message: string,
    nodePath?: NodePath
  ) {
    super('YAMLWarning', pos, code, message, nodePath)
  }
}

export const prettifyError =
  (src: string, lc: LineCounter) =>
  (error: YAMLError): void => {
    const [start, end] = error.pos
    if (start >= 0 && end >= start) {
      error.source = src.slice(start, end)
    } else {
      error.source = ''
    }
    if (start === -1) return
    error.linePos = error.pos.map(pos => lc.linePos(pos)) as
      [LinePos] | [LinePos, LinePos]
    const { line, col } = error.linePos[0]
    error.message += ` at line ${line}, column ${col}`

    let ci = col - 1
    let lineStr = src
      .substring(lc.lineStarts[line - 1], lc.lineStarts[line])
      .replace(/[\n\r]+$/, '')

    // Trim to max 80 chars, keeping col position near the middle
    if (ci >= 60 && lineStr.length > 80) {
      const trimStart = Math.min(ci - 39, lineStr.length - 79)
      lineStr = '…' + lineStr.substring(trimStart)
      ci -= trimStart - 1
    }
    if (lineStr.length > 80) lineStr = lineStr.substring(0, 79) + '…'

    // Include previous line in context if pointing at line start
    if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
      // Regexp won't match if start is trimmed
      let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1])
      if (prev.length > 80) prev = prev.substring(0, 79) + '…\n'
      lineStr = prev + lineStr
    }

    if (/[^ ]/.test(lineStr)) {
      let count = 1
      const endLine = error.linePos[1]
      if (endLine?.line === line && endLine.col > col) {
        count = Math.max(1, Math.min(endLine.col - col, 80 - ci))
      }
      const pointer = ' '.repeat(ci) + '^'.repeat(count)
      error.message += `:\n\n${lineStr}\n${pointer}\n`
    }
  }
