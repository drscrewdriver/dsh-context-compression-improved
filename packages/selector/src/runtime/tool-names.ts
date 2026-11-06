/**
 * Runtime tool names owned by this plugin, plus the code-mode calling-convention
 * note. Every place that REGISTERS a tool and every place that JUDGES reachability
 * or exemption must read the SAME constant. billion-context learned this the hard
 * way (#3600 / #3884): a hard-coded omnibus / tool literal silently stopped
 * matching after the host renamed its transport, which suppressed the whole
 * compression surface without any error. Keeping one source prevents that class
 * of silent split here.
 */
export const RUNTIME_TOOL_NAMES = Object.freeze({
  RETRIEVE: 'context_compression_retrieve',
} as const)

/** Every runtime tool this plugin registers and later judges against. */
export type RuntimeToolName = typeof RUNTIME_TOOL_NAMES[keyof typeof RUNTIME_TOOL_NAMES]

/**
 * Code-mode "omnibus" tools a host may fold every tool use into. DOCUMENTATION
 * ONLY: reachability is decided from the tool registry (`tools.get(name)`), which
 * is the truth — these names exist solely so the retrieval guidance can mention
 * the common omnibus tools without re-hard-coding them at the prompt site.
 */
export const CODE_MODE_OMNIBUS_TOOL_NAMES = Object.freeze(['run_code', 'code_run'] as const)

/**
 * Calling-convention note appended to the retrieval tool description. In a
 * standard (direct tool-call) preset the model calls the tool directly; when the
 * harness folds tool use into an omnibus program (run_code / code_run) the same
 * tool is reached through the program's SDK. Naming both keeps one static
 * description correct on every preset, since CCI registers a single tool and
 * cannot branch its description per preset.
 */
export const PTC_BINDING_NOTE =
  `Call it directly as a tool when the environment allows direct tool calls; `
  + `if this environment routes all tool use through a program (${CODE_MODE_OMNIBUS_TOOL_NAMES.join(' / ')}), `
  + `call it from inside that program via the tool SDK instead of emitting a standalone call.`
