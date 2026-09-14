import { Context } from "@deepseek-ai/cordis";
//#region src/invariant.d.ts
/** Cordis companion plugin name. */
declare const name = "context-compression-selector-runtime-invariant";
/** Services required before the companion can register. */
declare const inject: string[];
/** Register this package's invariant companion. */
declare const apply: (ctx: Context) => Promise<() => void>;
//#endregion
export { apply, inject, name };