import { n as ContextCompressionSettings } from "./profiles.js";
import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
/** Standalone Bundle behavior; the settings/UI owner remains safe when false. */
interface Config {
  /** Add the canonical compression stack to every non-Minimal preset. */
  presetOverlay?: boolean;
  /**
   * Register the estimator-catalog HTTP route on this row.
   *
   * The standalone Bundle patch sets this on its own row (which declares
   * `inject: [webServer]`), so profiles without a host web server never mount a
   * row that could only announce a pending route. The row-level `inject` is
   * belt-and-braces: `dsh-host-webserver.register` performs no authorization
   * check and `ctx.get(name)` only asks whether the providing fiber is active,
   * so the two-channel registration inside this function is what actually
   * covers both arrival orders.
   */
  estimatorCatalogRoute?: boolean;
  /**
   * Register the advisory advisor's read-only HTTP report route (decay
   * figure, task summary, score distribution, last benefit-model advice).
   * Same Bundle opt-in semantics as `estimatorCatalogRoute`; the advisor
   * itself stays off until the user turns it on through the
   * `presetOptions.advisor*` settings keys.
   */
  advisorReportRoute?: boolean;
  /**
   * 0.1.7: the compression settings document as ONE `.volatile()` whole-object
   * field (the old dedicated namespace has no declarative equivalent). The
   * browser selector writes it through `configForms`; the runtime reads the
   * dereferenced value. Loose section schemas keep unknown keys — the strict
   * validation stays in `decodeSettings` (client) and the runtime resolver.
   */
  settings?: ContextCompressionSettings;
}
/** Loader validation for the standalone Bundle opt-in. */
declare const Config: z<Config>;
/** Register the persisted default read by the currently mounted root pruner. */
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, apply };