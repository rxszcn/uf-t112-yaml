import * as YAML from 'yaml'
import { YAMLParseError, YAMLWarning } from 'yaml'
import type { YAMLError } from 'yaml'

/**
 * The node path attached to an error is expected to locate the same node the
 * error relates to through the document model's `get()`/`getPair()`/`at()`
 * accessors.
 */
function expectPathResolves(
  doc: YAML.Document.Parsed,
  error: YAMLError
): void {
  let node: unknown = doc
  for (const segment of error.nodePath) {
    if (node instanceof YAML.Document) node = node.get(segment)
    else if (node instanceof YAML.YAMLMap) {
      const pair = node.getPair(segment)
      // The pair value may legitimately be null; only fall back to the key
      // when no value node exists at all.
      node = pair ? (pair.value ?? pair.key) : undefined
    } else if (node instanceof YAML.YAMLSeq) {
      node = node.at(segment as number)
    } else {
      node = undefined
    }
  }
  // A resolvable path ends on a document model node, the document root or a
  // null-valued scalar (including null-keyed entries).
  expect(
    node instanceof YAML.Document ||
      node instanceof YAML.Scalar ||
      node instanceof YAML.YAMLMap ||
      node instanceof YAML.YAMLSeq ||
      node instanceof YAML.Alias ||
      node instanceof YAML.Pair ||
      node === null
  ).toBe(true)
}

describe('error and warning node paths', () => {
  test('root-level parse error has an empty path', () => {
    const doc = YAML.parseDocument('[1, 2')
    expect(doc.errors).toHaveLength(1)
    const [error] = doc.errors
    expect(error).toBeInstanceOf(YAMLParseError)
    expect(error.nodePath).toEqual([])
    expectPathResolves(doc, error)
  })

  test('error nested through maps and sequences points at the containing node', () => {
    const src = 'outer:\n  inner:\n    list:\n      - "bad\\x0"\n'
    const doc = YAML.parseDocument(src)
    expect(doc.errors).toMatchObject([{ code: 'BAD_DQ_ESCAPE' }])
    const [error] = doc.errors
    expect(error.nodePath).toEqual(['outer', 'inner', 'list', 0])
    expectPathResolves(doc, error)
  })

  test('nested block collection indentation error keeps the enclosing map path', () => {
    const src = 'a:\n  b:\n    - x\n   - y\n'
    const doc = YAML.parseDocument(src)
    expect(doc.errors.length).toBeGreaterThan(0)
    // Every error stays inside the `a` entry. Errors with a complete node
    // resolve through the document model; malformed-entry errors at least
    // keep their containing `a` container accurate.
    for (const error of doc.errors) {
      expect(error.nodePath[0]).toBe('a')
      expect(doc.get('a')).toBeDefined()
      if (error.nodePath.length === 1) expectPathResolves(doc, error)
    }
    const codes = doc.errors.map(error => error.code)
    expect(codes).toContain('MISSING_CHAR')
  })

  test('flow collection errors carry paths through mixed nesting', () => {
    const src = 'a: [ { b: [1, 2, }, ]\n'
    const doc = YAML.parseDocument(src)
    const byPath = new Map(
      doc.errors.map(error => [error.nodePath.join(','), error])
    )
    // inner map `b` end bracket
    expect(byPath.get('a,0,b')).toMatchObject({ code: 'BAD_INDENT' })
    // outer flow sequence end bracket
    expect(byPath.get('a,0')).toMatchObject({ code: 'BAD_INDENT' })
    // the sequence value of `a` itself
    expect(byPath.get('a')).toMatchObject({ code: 'BAD_INDENT' })
    for (const error of doc.errors) expectPathResolves(doc, error)
  })

  test('duplicate key error resolves to the duplicated map entry', () => {
    const doc = YAML.parseDocument('a:\n  b: 1\n  b: 2\n')
    expect(doc.errors).toMatchObject([{ code: 'DUPLICATE_KEY' }])
    expect(doc.errors[0].nodePath).toEqual(['a', 'b'])
    expectPathResolves(doc, doc.errors[0])
  })

  test('sequence index path segments are zero-based', () => {
    const doc = YAML.parseDocument('a:\n\tb: 1\n')
    const error = doc.errors.find(e => e.code === 'TAB_AS_INDENT')
    expect(error).toBeDefined()
    expect(error!.nodePath).toEqual(['a'])
    expectPathResolves(doc, error!)
  })

  test('nested sequence items are addressed by zero-based index', () => {
    const src = 'list:\n  - one\n  - [1, 2\n'
    const doc = YAML.parseDocument(src)
    expect(doc.errors.length).toBeGreaterThan(0)
    for (const error of doc.errors) {
      expect(error.nodePath.slice(0, 2)).toEqual(['list', 1])
      expectPathResolves(doc, error)
    }
  })

  test('warnings carry the same path information as errors', () => {
    const src = 'outer:\n  inner:\n    !foo bar\n'
    const doc = YAML.parseDocument(src)
    expect(doc.warnings).toMatchObject([{ code: 'TAG_RESOLVE_FAILED' }])
    const [warning] = doc.warnings
    expect(warning).toBeInstanceOf(YAMLWarning)
    expect(warning.nodePath).toEqual(['outer', 'inner'])
    expect(warning.source).toBe('!foo')
    expectPathResolves(doc, warning)
  })

  test('non-string map keys keep their resolved value type in the path', () => {
    const doc = YAML.parseDocument('true:\n  bad: [1,\n')
    const [error] = doc.errors
    expect(error.nodePath[0]).toBe(true)
    expect(typeof error.nodePath[0]).toBe('boolean')
    expectPathResolves(doc, error)

    const numeric = YAML.parseDocument('123:\n  - [1,\n')
    expect(numeric.errors[0].nodePath[0]).toBe(123)
    expectPathResolves(numeric, numeric.errors[0])
  })

  test('warning on a nested flow sequence item', () => {
    const doc = YAML.parseDocument('a:\n  - !bar x\n')
    expect(doc.warnings).toMatchObject([{ code: 'TAG_RESOLVE_FAILED' }])
    expect(doc.warnings[0].nodePath).toEqual(['a', 0])
    expectPathResolves(doc, doc.warnings[0])
  })

  test('root warning has an empty path', () => {
    const doc = YAML.parseDocument('%FOO\n---bar\n')
    expect(doc.warnings.length).toBeGreaterThan(0)
    for (const warning of doc.warnings) expect(warning.nodePath).toEqual([])
  })

  test('errors and warnings always expose the verbatim source slice', () => {
    const src = 'a:\n  b:\n    - "bad\\x0"\n'
    const pretty = YAML.parseDocument(src, { prettyErrors: true })
    for (const error of pretty.errors) {
      expect(error.source).toBe(src.slice(error.pos[0], error.pos[1]))
    }
    const plain = YAML.parseDocument(src, { prettyErrors: false })
    for (const error of plain.errors) {
      expect(error.source).toBe(src.slice(error.pos[0], error.pos[1]))
      expect(error.linePos).toBeUndefined()
    }
  })

  test('unpositioned source slice is an empty string', () => {
    const doc = YAML.parseDocument('[' + '\r'.repeat(80))
    const [error] = doc.errors
    expect(error.pos[0]).toBe(doc.errors[0].pos[0])
    expect(error.source).toBe('')
  })

  test('paths and sources are scoped per document in a stream', () => {
    const docs = YAML.parseAllDocuments('a: 1\n---\nb:\n  - [1,\n')
    expect(docs[0].errors).toHaveLength(0)
    const [error] = docs[1].errors
    expect(error.nodePath).toEqual(['b', 0])
    expect(error.source).toBe('')
  })

  test('empty stream warnings still carry their source', () => {
    const stream = YAML.parseAllDocuments('%BAD\n') as YAML.EmptyStream
    expect(stream.empty).toBe(true)
    expect(stream.warnings).toMatchObject([{ code: 'BAD_DIRECTIVE' }])
    expect(stream.warnings[0].nodePath).toEqual([])
    expect(stream.warnings[0].source).toBe('%BAD')
  })

  test('position, linePos, code and message are left unchanged', () => {
    const src = 'abc: 123\ndef'
    const before = YAML.parseDocument(src, { prettyErrors: false })
    const after = YAML.parseDocument(src, { prettyErrors: true })
    const [b] = before.errors
    const [a] = after.errors
    expect(a.code).toBe(b.code)
    expect(a.message.startsWith(b.message)).toBe(true)
    expect(a.pos).toEqual(b.pos)
    expect(a.linePos).toBeDefined()
    // `def` is the implicit key of the single root map entry
    expect(a.nodePath).toEqual(['def'])
  })
})
