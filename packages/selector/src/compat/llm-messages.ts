/**
 * Local stand-ins for the two `@deepseek-ai/dsh-llm` message factories the
 * pruner and TailTrim hot paths need. The package is an OPTIONAL peer — the
 * official-clone profile in the packed-install e2e (and any host line that
 * stops shipping it into a plugin's module graph) does not resolve it, and a
 * static value import then crashes the whole plugin at module-load time with
 * ERR_MODULE_NOT_FOUND. This mirrors the 0.9.3 pruner soft-import decision:
 * the semantics are deliberately tiny and stable (deep clone → brand a fresh
 * id → deep freeze), so the plugin carries its own copy instead of importing
 * the host's.
 */
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** Recursive `Object.freeze` over own enumerable properties (arrays included). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested)
    }
  }
  return value
}

/**
 * Detach and deep-freeze a message whose identity already exists — the host
 * factory is `deepFreeze(structuredClone(message))`, byte-for-byte.
 */
export function freezeMessage<T>(message: T): T {
  return deepFreeze(structuredClone(message))
}

/**
 * Create one identified user-role message and freeze it before publication —
 * the host factory spreads the input, stamps `role: 'user'` and a fresh UUID
 * id, clones and freezes. The signature mirrors the host's generic form so
 * call sites keep their excess-property discipline; `id`/`role` stay
 * unconstructible via the `never` guards, exactly like the host's d.ts.
 */
type NewUserMessage = Omit<UserMessage, 'id' | 'role'>

export function createUserMessage<T extends NewUserMessage>(
  input: T & { readonly id?: never, readonly role?: never },
): UserMessage {
  return deepFreeze(structuredClone({
    ...input,
    role: 'user' as const,
    id: crypto.randomUUID(),
  })) as unknown as UserMessage
}
