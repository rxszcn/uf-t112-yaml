import { Composer } from './compose/composer.ts'
import type { Reviver } from './doc/applyReviver.ts'
import type { DocValue, Replacer } from './doc/Document.ts'
import { Document } from './doc/Document.ts'
import {
  prettifyError,
  type YAMLError,
  YAMLParseError
} from './errors.ts'
import { warn } from './log.ts'
import type {
  CreateNodeOptions,
  DocumentOptions,
  ParseOptions,
  SchemaOptions,
  ToJSOptions,
  ToStringOptions
} from './options.ts'
import { LineCounter } from './parse/line-counter.ts'
import { Parser } from './parse/parser.ts'

export interface EmptyStream
  extends Array<Document.Parsed>, ReturnType<Composer['streamInfo']> {
  empty: true
}

function parseOptions(options: ParseOptions) {
  const prettyErrors = options.prettyErrors !== false
  const lineCounter =
    options.lineCounter || (prettyErrors && new LineCounter()) || null
  return { lineCounter, prettyErrors }
}

/**
 * Attach the verbatim source slice covered by each error position, so that
 * errors and warnings always carry their source even when pretty-printing
 * (line/column metadata and message decoration) is disabled.
 */
function attachErrorSource(source: string, errors: YAMLError[]): void {
  for (const error of errors) {
    const [start, end] = error.pos
    error.source = start >= 0 && end >= start ? source.slice(start, end) : ''
  }
}

/**
 * Parse the input as a stream of YAML documents.
 *
 * Documents should be separated from each other by `...` or `---` marker lines.
 *
 * @returns If an empty `docs` array is returned, it will be of type
 *   EmptyStream and contain additional stream information. In
 *   TypeScript, you should use `'empty' in docs` as a type guard for it.
 */
export function parseAllDocuments<Value extends DocValue = DocValue>(
  source: string,
  options: ParseOptions & DocumentOptions & SchemaOptions = {}
): Document.Parsed<Value>[] | EmptyStream {
  const { lineCounter, prettyErrors } = parseOptions(options)
  const parser = new Parser(lineCounter?.addNewLine)
  const composer = new Composer(options)
  const docs = Array.from(composer.compose(parser.parse(source)))

  if (prettyErrors && lineCounter)
    for (const doc of docs) {
      doc.errors.forEach(prettifyError(source, lineCounter))
      doc.warnings.forEach(prettifyError(source, lineCounter))
    }
  else
    for (const doc of docs) {
      attachErrorSource(source, doc.errors)
      attachErrorSource(source, doc.warnings)
    }

  type DocType = Document.Parsed<Value>
  if (docs.length > 0) return docs as DocType[]
  const info = composer.streamInfo()
  // Stream-level errors/warnings are not attached to a document and therefore
  // never pass through prettifyError(), so always set their source here.
  attachErrorSource(source, info.errors)
  attachErrorSource(source, info.warnings)
  return Object.assign<
    DocType[],
    { empty: true },
    ReturnType<Composer['streamInfo']>
  >([], { empty: true }, info)
}

/** Parse an input string into a single YAML.Document */
export function parseDocument<Value extends DocValue = DocValue>(
  source: string,
  options: ParseOptions & DocumentOptions & SchemaOptions = {}
): Document.Parsed<Value> {
  const { lineCounter, prettyErrors } = parseOptions(options)
  const parser = new Parser(lineCounter?.addNewLine)
  const composer = new Composer(options)

  type DocType = Document.Parsed<Value>
  // `doc` is always set by compose.end(true) at the very latest
  let doc: DocType = null as any
  for (const _doc of composer.compose(
    parser.parse(source),
    true,
    source.length
  )) {
    if (!doc) doc = _doc as DocType
    else if (doc.options.logLevel !== 'silent') {
      doc.errors.push(
        new YAMLParseError(
          _doc.range.slice(0, 2) as [number, number],
          'MULTIPLE_DOCS',
          'Source contains multiple documents; please use YAML.parseAllDocuments()'
        )
      )
      break
    }
  }

  if (prettyErrors && lineCounter) {
    doc.errors.forEach(prettifyError(source, lineCounter))
    doc.warnings.forEach(prettifyError(source, lineCounter))
  } else {
    attachErrorSource(source, doc.errors)
    attachErrorSource(source, doc.warnings)
  }
  return doc
}

/**
 * Parse an input string into JavaScript.
 *
 * Only supports input consisting of a single YAML document; for multi-document
 * support you should use `YAML.parseAllDocuments`. May throw on error, and may
 * log warnings using `console.warn`.
 *
 * @param str - A string with YAML formatting.
 * @param reviver - A reviver function, as in `JSON.parse()`
 * @returns The value will match the type of the root value of the parsed YAML
 *   document, so Maps become objects, Sequences arrays, and scalars result in
 *   nulls, booleans, numbers and strings.
 */
export function parse(
  src: string,
  options?: ParseOptions & DocumentOptions & SchemaOptions & ToJSOptions
): any
export function parse(
  src: string,
  reviver: Reviver,
  options?: ParseOptions & DocumentOptions & SchemaOptions & ToJSOptions
): any

export function parse(
  src: string,
  reviver?:
    Reviver | (ParseOptions & DocumentOptions & SchemaOptions & ToJSOptions),
  options?: ParseOptions & DocumentOptions & SchemaOptions & ToJSOptions
): any {
  let _reviver: Reviver | undefined = undefined
  if (typeof reviver === 'function') {
    _reviver = reviver
  } else if (options === undefined && reviver && typeof reviver === 'object') {
    options = reviver
  }

  const doc = parseDocument(src, options)
  if (!doc) return null
  doc.warnings.forEach(warning => warn(doc.options.logLevel, warning))
  if (doc.errors.length > 0) {
    if (doc.options.logLevel !== 'silent') throw doc.errors[0]
    else doc.errors = []
  }
  return doc.toJS(Object.assign({ reviver: _reviver }, options))
}

/**
 * Stringify a value as a YAML document.
 *
 * @param replacer - A replacer array or function, as in `JSON.stringify()`
 * @returns Will always include `\n` as the last character, as is expected of YAML documents.
 */
export function stringify(
  value: any,
  options?: DocumentOptions &
    SchemaOptions &
    ParseOptions &
    CreateNodeOptions &
    ToStringOptions
): string
export function stringify(
  value: any,
  replacer?: Replacer | null,
  options?:
    | string
    | number
    | (DocumentOptions &
        SchemaOptions &
        ParseOptions &
        CreateNodeOptions &
        ToStringOptions)
): string

export function stringify(
  value: any,
  replacer?:
    | Replacer
    | (DocumentOptions &
        SchemaOptions &
        ParseOptions &
        CreateNodeOptions &
        ToStringOptions)
    | null,
  options?:
    | string
    | number
    | (DocumentOptions &
        SchemaOptions &
        ParseOptions &
        CreateNodeOptions &
        ToStringOptions)
) {
  let _replacer: Replacer | null = null
  if (typeof replacer === 'function' || Array.isArray(replacer)) {
    _replacer = replacer
  } else if (options === undefined && replacer) {
    options = replacer
  }

  if (typeof options === 'string') options = options.length
  if (typeof options === 'number') {
    const indent = Math.round(options)
    options = indent < 1 ? undefined : indent > 8 ? { indent: 8 } : { indent }
  }
  if (value === undefined) {
    const { keepUndefined } = options ?? (replacer as CreateNodeOptions) ?? {}
    if (!keepUndefined) return undefined
  }
  if (value instanceof Document && !_replacer) return value.toString(options)
  return new Document(value, _replacer, options).toString(options)
}
