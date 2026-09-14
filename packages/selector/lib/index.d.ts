import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
/** Standalone Bundle behavior; the settings/UI owner remains safe when false. */
interface Config {
  /** Add the canonical compression stack to every non-Minimal preset. */
  presetOverlay?: boolean;
}
/** Loader validation for the standalone Bundle opt-in. */
declare const Config: z<Config>;
/** Register the persisted default read by the currently mounted root pruner. */
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, apply };