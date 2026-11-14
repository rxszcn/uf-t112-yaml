import type { Directives } from '../doc/directives.ts'
import { Alias } from '../nodes/Alias.ts'
import type { Node } from '../nodes/types.ts'
import { Scalar } from '../nodes/Scalar.ts'
import type { ParseOptions } from '../options.ts'
import type { FlowScalar, SourceToken, Token } from '../parse/cst.ts'
import type { Schema } from '../schema/Schema.ts'
import { composeCollection } from './compose-collection.ts'
import { composeScalar } from './compose-scalar.ts'
import type { ComposeErrorHandler } from './composer.ts'
import {
  trackNodePath,
  type NodePathTracker
} from './node-path.ts'
import { resolveEnd } from './resolve-end.ts'
import { emptyScalarPosition } from './util-empty-scalar-position.ts'

export interface ComposeContext {
  atKey: boolean
  atRoot: boolean
  directives: Directives
  options: Readonly<Required<Omit<ParseOptions, 'lineCounter'>>>
  schema: Readonly<Schema>
  /** Current node path, updated while descending into nested nodes. */
  readonly nodePath: NodePathTracker
}

interface Props {
  spaceBefore: boolean
  comment: string
  anchor: SourceToken | null
  tag: SourceToken | null
  newlineAfterProp: SourceToken | null
  end: number
}

const CN: {
  composeNode: typeof composeNode
  composeEmptyNode: typeof composeEmptyNode
} = { composeNode, composeEmptyNode }
export type ComposeNode = typeof CN

export function composeNode(
  ctx: ComposeContext,
  token: Token,
  props: Props,
  onError: ComposeErrorHandler
): Node {
  // Attribute any error raised while composing this node or its descendants
  // to the node path tracked on the context, unless the call site overrides it.
  const trackedError = trackNodePath(onError, ctx.nodePath)
  const atKey = ctx.atKey
  const { spaceBefore, comment, anchor, tag } = props
  let node: Node
  let isSrcToken = true
  switch (token.type) {
    case 'alias':
      node = composeAlias(ctx, token, trackedError)
      if (anchor || tag)
        trackedError(
          token,
          'ALIAS_PROPS',
          'An alias node must not specify any properties'
        )
      break
    case 'scalar':
    case 'single-quoted-scalar':
    case 'double-quoted-scalar':
    case 'block-scalar':
      node = composeScalar(ctx, token, tag, trackedError)
      if (anchor) node.anchor = anchor.source.substring(1)
      break
    case 'block-map':
    case 'block-seq':
    case 'flow-collection':
      try {
        node = composeCollection(CN, ctx, token, props, trackedError)
        if (anchor) node.anchor = anchor.source.substring(1)
      } catch (error) {
        // Almost certainly here due to a stack overflow
        const message = error instanceof Error ? error.message : String(error)
        trackedError(token, 'RESOURCE_EXHAUSTION', message)
      }
      break
    default: {
      const message =
        token.type === 'error'
          ? token.message
          : `Unsupported token (type: ${token.type})`
      trackedError(token, 'UNEXPECTED_TOKEN', message)
      isSrcToken = false
    }
  }
  node ??= composeEmptyNode(ctx, token.offset, undefined, null, props, trackedError)
  if (anchor && node.anchor === '')
    trackedError(anchor, 'BAD_ALIAS', 'Anchor cannot be an empty string')
  if (
    atKey &&
    ctx.options.stringKeys &&
    (!(node instanceof Scalar) ||
      typeof node.value !== 'string' ||
      (node.tag && node.tag !== 'tag:yaml.org,2002:str'))
  ) {
    const msg = 'With stringKeys, all keys must be strings'
    trackedError(tag ?? token, 'NON_STRING_KEY', msg)
  }
  if (spaceBefore) node.spaceBefore = true
  if (comment) {
    if (token.type === 'scalar' && token.source === '') node.comment = comment
    else node.commentBefore = comment
  }
  // @ts-expect-error Type checking misses meaning of isSrcToken
  if (ctx.options.keepSourceTokens && isSrcToken) node.srcToken = token
  return node
}

export function composeEmptyNode(
  ctx: ComposeContext,
  offset: number,
  before: Token[] | undefined,
  pos: number | null,
  { spaceBefore, comment, anchor, tag, end }: Props,
  onError: ComposeErrorHandler
): Scalar {
  const trackedError = trackNodePath(onError, ctx.nodePath)
  const token: FlowScalar = {
    type: 'scalar',
    offset: emptyScalarPosition(offset, before, pos),
    indent: -1,
    source: ''
  }
  const node = composeScalar(ctx, token, tag, trackedError)
  if (anchor) {
    node.anchor = anchor.source.substring(1)
    if (node.anchor === '')
      trackedError(anchor, 'BAD_ALIAS', 'Anchor cannot be an empty string')
  }
  if (spaceBefore) node.spaceBefore = true
  if (comment) {
    node.comment = comment
    node.range![2] = end
  }
  return node
}

function composeAlias(
  { options, nodePath }: ComposeContext,
  { offset, source, end }: FlowScalar,
  onError: ComposeErrorHandler
) {
  const trackedError = trackNodePath(onError, nodePath)
  const alias = new Alias(source.substring(1))
  if (alias.source === '')
    trackedError(offset, 'BAD_ALIAS', 'Alias cannot be an empty string')
  if (alias.source.endsWith(':'))
    trackedError(
      offset + source.length - 1,
      'BAD_ALIAS',
      'Alias ending in : is ambiguous',
      true
    )
  const valueEnd = offset + source.length
  const re = resolveEnd(end, valueEnd, options.strict, trackedError)
  alias.range = [offset, valueEnd, re.offset]
  if (re.comment) alias.comment = re.comment
  return alias
}
