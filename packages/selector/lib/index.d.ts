import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
/** Standalone Bundle behavior; the settings/UI owner remains safe when false. */
interface Config {
  /** Add the canonical compression stack to every non-Minimal preset. */
  presetOverlay?: boolean;
  /**
   * Own the estimator catalog HTTP route. Set on the Loader row that declares
   * `inject: [webServer]`.
   *
   * **Measured, and it contradicts the note this field was introduced with.**
   * The original justification — "registering a route authorizes against the
   * calling fiber, and a fiber that has not declared `webServer` cannot reach
   * it, not even through `ctx.inject` or `ctx.get`" — is wrong on both halves:
   * the host's `register` performs no authorization at all (it reads
   * `this.exact` / `this.prefixes` and throws only on a duplicate
   * `(kind, path)`), and `ctx.get(name, strict)` checks only that the providing
   * fiber is active (`state === 2`), never the caller's `inject` list. The one
   * inject-gated path is the `ctx.webServer` **property** access, which this
   * plugin never uses: `registerEstimatorCatalogRoute` uses `ctx.get` plus its
   * own `ctx.inject(['webServer'], …)`.
   *
   * So the row-level `inject` is **not load-bearing**; it is kept as
   * belt-and-braces so the route row stays inactive until `webServer` exists,
   * and the flag keeps the route off standalone Bundle rows on profiles that
   * have no web server. The internal two-channel registration is what actually
   * covers both arrival orders. Do not cite this comment as a rule to the
   * 0.1.5 replay — cite the host source.
   */
  estimatorCatalogRoute?: boolean;
  /**
   * Register the review pipeline's HTTP routes (pending-queue read + decide
   * write) on this row. Same Bundle opt-in semantics as
   * `estimatorCatalogRoute`; without the routes the floating window has no
   * transport and simply never appears.
   */
  reviewQueueRoute?: boolean;
}
/** Loader validation for the standalone Bundle opt-in. */
declare const Config: z<Config>;
/** Register the persisted default read by the currently mounted root pruner. */
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, apply };