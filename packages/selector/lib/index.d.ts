import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
/** Standalone Bundle behavior; the settings/UI owner remains safe when false. */
interface Config {
  /** Add the canonical compression stack to every non-Minimal preset. */
  presetOverlay?: boolean;
  /**
   * Own the estimator catalog HTTP route. Set only on the Loader row that
   * declares `inject: [webServer]`: registering a route authorizes against the
   * calling fiber, and a fiber that has not declared `webServer` cannot reach
   * it — not even through `ctx.inject` or a runtime `ctx.get` probe. Splitting
   * it onto its own row keeps the compression stack loadable on profiles that
   * have no web server at all.
   */
  estimatorCatalogRoute?: boolean;
}
/** Loader validation for the standalone Bundle opt-in. */
declare const Config: z<Config>;
/** Register the persisted default read by the currently mounted root pruner. */
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, apply };