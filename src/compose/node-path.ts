import type { ComposeErrorHandler } from './composer.ts'
import { isNode } from '../nodes/identity.ts'
import type { Primitive } from '../nodes/types.ts'
import { Scalar } from '../nodes/Scalar.ts'

/**
 * Mutable node path carried through composition.
 *
 * The stack holds the key/index values that locate the currently composed
 * node within its document, using the same values as the document model's
 * `Document#get()` / `Document#getPair()` accessors: map entries are keyed by
 * their resolved scalar value and sequence items by their zero-based index.
 * An empty stack therefore points at the document root.
 */
export interface NodePathTracker {
  readonly path: Primitive[]
}

export function createNodePathTracker(): NodePathTracker {
  return { path: [] }
}

/**
 * Wrap an error handler so that calls without an explicit node path are
 * attributed to the path currently held by the tracker. The lookup is
 * evaluated lazily, so path pushes by nested containers are reflected.
 */
export function trackNodePath(
  onError: ComposeErrorHandler,
  tracker: NodePathTracker
): ComposeErrorHandler {
  return (source, code, message, warning, path) =>
    onError(source, code, message, warning, path ?? tracker.path)
}

/**
 * Resolve a map key node into the value used for node-path segments,
 * matching the default `Schema#mapKey` lookup semantics.
 */
export function mapKeyPathValue(key: unknown): Primitive {
  if (key instanceof Scalar) return key.value as Primitive
  if (isNode(key)) return null
  if (
    key === null ||
    typeof key === 'string' ||
    typeof key === 'number' ||
    typeof key === 'bigint' ||
    typeof key === 'boolean'
  ) {
    return key
  }
  return null
}
