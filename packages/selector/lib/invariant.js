//#region src/invariant.ts
const PACKAGE_NAME = "dsh-context-compression-improved";
/** Cordis companion plugin name. */
const name = "client-ui-context-compression-selector-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the settings service validates and owns the durable
* profile registration, while the slot registry already rejects or removes
* invalid browser contributions with their owning fiber.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
