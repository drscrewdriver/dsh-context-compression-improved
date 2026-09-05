/** Browser-safe settings decoding shared by the client entry and node tests. */

import {
  canonicalizeCustomPolicy,
  COMPRESSION_PROFILES,
  decodeAutoCompactSettings,
  decodeCodeSkeletonSettings,
  isCustomCompressionPolicy,
  isPlainRecord,
  type CompressionProfile,
  type ContextCompressionSettings,
} from '../profiles.ts'

/**
 * Decode one stored context-compression settings document with exactly the
 * runtime schema's strictness: a plain object with only `profile`, `custom`,
 * `autoCompact`, and `codeSkeleton` keys, a supported profile, a valid Custom
 * document canonicalized to v3 exactly as the runtime resolver would, a
 * strictly-shaped autoCompact section (absent inherits the 80% default), and
 * a strictly-shaped codeSkeleton gate (absent inherits off). Anything else
 * decodes to `undefined` so the UI reports the document as unreadable instead
 * of silently disagreeing with the runtime.
 */
export function decodeSettings(value: unknown): ContextCompressionSettings | undefined {
  if (!isPlainRecord(value)) return undefined
  const keys = Object.keys(value)
  if (keys.some(key => key !== 'profile' && key !== 'custom' && key !== 'autoCompact' && key !== 'codeSkeleton')) {
    return undefined
  }
  const profile = (value as { profile?: unknown }).profile
  const custom = (value as { custom?: unknown }).custom
  const autoCompact = decodeAutoCompactSettings((value as { autoCompact?: unknown }).autoCompact)
  const codeSkeleton = decodeCodeSkeletonSettings((value as { codeSkeleton?: unknown }).codeSkeleton)
  return typeof profile === 'string'
    && (COMPRESSION_PROFILES as readonly string[]).includes(profile)
    && isCustomCompressionPolicy(custom)
    && autoCompact !== undefined
    && codeSkeleton !== undefined
    ? {
        profile: profile as CompressionProfile,
        custom: canonicalizeCustomPolicy(custom),
        autoCompact,
        codeSkeleton,
      }
    : undefined
}
