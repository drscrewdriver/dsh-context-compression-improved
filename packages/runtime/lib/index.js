import { a as validatePublishedTailTrim, i as tailTrimStub, n as tailTrimMessage, o as sessionEvents, r as tailTrimRef, t as parseTailTrimRef } from "./tail-trim.js";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm";
import { deriveEventMessage } from "@deepseek-ai/dsh-session";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Tokenizer } from "@huggingface/tokenizers";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/deepseek-v4-tokenizer.ts
/** Offline DeepSeek tokenizers backed by pinned official Hugging Face assets. */
const TOKENIZER_ID = "deepseek-ai/DeepSeek-V4-Pro";
const TOKENIZER_REVISION = "0e1a0e5e52aea73055f50fef6f2423db370265b6";
const TOKENIZER_SHA256 = "8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf";
const CONFIG_SHA256 = "6ac8c8dc065ed118161d02dd532749ae3f52c243deac27872134fae2f50d8547";
const VISION_TOKENIZER_ID = "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp";
const VISION_TOKENIZER_REVISION = "6821d6ad3681a4b137b066b76094fa82ebd0a380";
const VISION_TOKENIZER_SHA256 = "c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b";
const VISION_CONFIG_SHA256 = "6ac8c8dc065ed118161d02dd532749ae3f52c243deac27872134fae2f50d8547";
/** Auditable origin and compatibility mapping for the bundled V4 Pro tokenizer. */
const DEEPSEEK_V4_TOKENIZER_ARTIFACT = Object.freeze({
	repository: TOKENIZER_ID,
	revision: TOKENIZER_REVISION,
	license: "MIT",
	tokenizerSha256: TOKENIZER_SHA256,
	tokenizerConfigSha256: CONFIG_SHA256,
	modelIds: Object.freeze(["deepseek-v4-flash", "deepseek-v4-pro"])
});
/**
* Auditable origin and compatibility mapping for the bundled V4 Flash Vision
* tokenizer. The vision repository ships a distinct `tokenizer.json` (it adds
* the `<｜deepseek_image｜>` special token), so the vision model must never be
* mapped onto the V4 Pro tokenizer as an alias.
*/
const DEEPSEEK_VISION_TOKENIZER_ARTIFACT = Object.freeze({
	repository: VISION_TOKENIZER_ID,
	revision: VISION_TOKENIZER_REVISION,
	license: "MIT",
	tokenizerSha256: VISION_TOKENIZER_SHA256,
	tokenizerConfigSha256: VISION_CONFIG_SHA256,
	modelIds: Object.freeze(["deepseek-v4-flash-vision-exp"])
});
/**
* Every bundled artifact is registered with independent asset roots, integrity
* manifests, and cache entries: one corrupted artifact must never disable the
* tokenizer serving the other model family.
*/
const ARTIFACTS = Object.freeze([Object.freeze({
	origin: DEEPSEEK_V4_TOKENIZER_ARTIFACT,
	assetRoot: new URL("../assets/deepseek-v4/", import.meta.url),
	integrity: Object.freeze({
		tokenizer: Object.freeze({
			bytes: 6367146,
			sha256: TOKENIZER_SHA256
		}),
		config: Object.freeze({
			bytes: 801,
			sha256: CONFIG_SHA256
		})
	})
}), Object.freeze({
	origin: DEEPSEEK_VISION_TOKENIZER_ARTIFACT,
	assetRoot: new URL("../assets/deepseek-v4-vision-exp/", import.meta.url),
	integrity: Object.freeze({
		tokenizer: Object.freeze({
			bytes: 6367257,
			sha256: VISION_TOKENIZER_SHA256
		}),
		config: Object.freeze({
			bytes: 801,
			sha256: VISION_CONFIG_SHA256
		})
	})
})]);
const registryCache = /* @__PURE__ */ new Map();
function artifactForModel(modelId) {
	return ARTIFACTS.find((artifact) => artifact.origin.modelIds.includes(modelId));
}
/**
* Resolve the shared offline tokenizer for one compatible API model.
* Unknown models and a cached asset/runtime failure return `undefined`; callers
* must report unavailable instead of manufacturing a character estimate.
* @param modelId - exact DeepSeek API wire model id.
* @returns the shared verified tokenizer, or undefined when unsupported/unavailable.
*/
function deepSeekV4TokenizerForModel(modelId) {
	const artifact = artifactForModel(modelId);
	if (artifact === void 0) return void 0;
	const cached = registryCache.get(artifact.origin);
	if (cached !== void 0) return cached.tokenizer;
	let entry;
	try {
		entry = { tokenizer: createDeepSeekV4TokenizerFromAssets(artifact.assetRoot, artifact.integrity, artifact.origin) };
	} catch (error) {
		entry = { failure: error instanceof Error ? error.message : String(error) };
	}
	registryCache.set(artifact.origin, entry);
	return entry.tokenizer;
}
/**
* Build a tokenizer from one local asset directory after byte/hash validation.
* This provider-private seam exists so tests can prove every failure branch
* without mutating the committed artifact.
* @param assetRoot - local URL containing tokenizer.json and tokenizer_config.json.
* @param integrity - expected byte length and SHA-256 for both files.
* @param origin - auditable identity recorded on every returned count.
* @returns a synchronous exact text counter.
* @internal
*/
function createDeepSeekV4TokenizerFromAssets(assetRoot, integrity, origin = DEEPSEEK_V4_TOKENIZER_ARTIFACT) {
	const tokenizerJson = readVerifiedJson(assetRoot, "tokenizer.json", integrity.tokenizer);
	const tokenizerConfig = readVerifiedJson(assetRoot, "tokenizer_config.json", integrity.config);
	const runtime = new Tokenizer(tokenizerJson, tokenizerConfig);
	return Object.freeze({ countText(text) {
		const tokens = runtime.encode(text, { add_special_tokens: false }).ids.length;
		return Object.freeze({
			kind: "exact-tokenizer",
			tokens,
			tokenizerId: origin.repository,
			tokenizerRevision: origin.revision
		});
	} });
}
function readVerifiedJson(assetRoot, name, descriptor) {
	const bytes = readFileSync(new URL(name, assetRoot));
	if (bytes.byteLength !== descriptor.bytes) throw new Error(`DeepSeek tokenizer asset ${name} has ${String(bytes.byteLength)} bytes; expected ${String(descriptor.bytes)}`);
	if (createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) throw new Error(`DeepSeek tokenizer asset ${name} failed SHA-256 verification`);
	const parsed = JSON.parse(bytes.toString("utf8"));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`DeepSeek tokenizer asset ${name} must contain a JSON object`);
	return parsed;
}
//#endregion
//#region src/deepseek-v4-vision-tokens.ts
/**
* Exact DeepSeek V4 Flash Vision image-token arithmetic.
*
* Every rule in this module is a line-by-line port of the official
* `inference/image_processor.py` published by
* `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp` at the pinned immutable revision
* recorded below. The golden fixtures in `tests/fixtures/vision-golden.json`
* are generated by executing that official implementation, so any change here
* must keep the Node counts byte-identical to the reference output.
*
* These arithmetic results back intrinsic-grid estimates, never exact counts
* of the final request. The official expansion
* depends on the absolute serialized prompt position (system prompt,
* chat-template framing, adapter image handles) and on the adapter's final
* request-image projection — including per-route pixel-budget or image-detail
* overrides and byte-cap reprojection — none of which is published through a
* public API, and a projected image can count FEWER tokens than its intrinsic
* grid suggests. The measurement layer therefore labels image-bearing nodes
* as estimates and keeps them outside exact rewrite proofs; the 640,000-pixel
* budget below documents the adapter default rather than establishing
* exactness.
*/
/** Official projection parameters pinned from the model repository config. */
const DEEPSEEK_VISION_PROJECTION = Object.freeze({
	sourceRepository: "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp",
	sourceRevision: "6821d6ad3681a4b137b066b76094fa82ebd0a380",
	/** `vision_patch_size` from the official config. */
	visionPatchSize: 14,
	/** `vision_downsample_ratio` from the official config. */
	visionDownsampleRatio: 3,
	/** `vision_max_n_token`: post-preprocessing cap per image, not a fixed value. */
	visionMaxNTokens: 384,
	/** `vision_min_pixels`: tiny images are upscaled before patching. */
	visionMinPixels: 147456,
	/** `vision_max_wh_ratio`: wider-than-ratio images are width-clamped. */
	visionMaxWhRatio: 8,
	/**
	* Default per-image pixel budget used by the DeepSeek adapter's normal
	* attachment projection (`DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET` in
	* `@deepseek-ai/dsh-llm-deepseek`). Route overrides remain unobservable to
	* this estimator.
	*/
	requestImagePixelBudget: 64e4
});
/** Stable identity for the deliberately approximate image-token counter. */
const DEEPSEEK_VISION_IMAGE_ESTIMATOR = Object.freeze({
	id: `${DEEPSEEK_VISION_PROJECTION.sourceRepository}/image-token-estimate`,
	revision: `${DEEPSEEK_VISION_PROJECTION.sourceRevision}:v1`
});
/** Official `COMPRESS_PAD_TO` alignment constant from image_processor.py. */
const COMPRESS_PAD_TO = 4;
/**
* Estimate one image without claiming an exact serialized position or final
* adapter projection. Valid intrinsic dimensions use the midpoint of the four
* possible alignment residues. Invalid or unsafe metadata uses the documented
* fixed fallback. In both cases the official per-image budget is retained as
* a conservative upper bound.
*/
function estimateDeepSeekVisionImageTokens(width, height) {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isSafeInteger(width * height)) return Object.freeze({
		tokens: 256,
		upperBoundTokens: DEEPSEEK_VISION_PROJECTION.visionMaxNTokens,
		source: "default"
	});
	try {
		const grid = deepSeekVisionImageGrid(width, height);
		const counts = [
			0,
			1,
			2,
			3
		].map((position) => deepSeekVisionImageBlockTokens(grid.nLlmH, grid.nLlmW, position));
		const paddingMinimumTokens = Math.min(...counts);
		const paddingMaximumTokens = Math.max(...counts);
		return Object.freeze({
			tokens: Math.round((paddingMinimumTokens + paddingMaximumTokens) / 2),
			upperBoundTokens: DEEPSEEK_VISION_PROJECTION.visionMaxNTokens,
			source: "intrinsic-grid",
			paddingMinimumTokens,
			paddingMaximumTokens
		});
	} catch {
		return Object.freeze({
			tokens: 256,
			upperBoundTokens: DEEPSEEK_VISION_PROJECTION.visionMaxNTokens,
			source: "default"
		});
	}
}
/**
* Resolve the aligner grid for one image's intrinsic dimensions.
*
* Port of the arithmetic path of the official `load_image`: aspect-ratio
* clamp, minimum-pixel upscale, patch-grid ceiling, and the `safe_resize`
* budget loop.
*/
function deepSeekVisionImageGrid(width, height) {
	const { visionPatchSize: patch, visionMaxWhRatio, visionMinPixels } = DEEPSEEK_VISION_PROJECTION;
	let effectiveWidth = width;
	let effectiveHeight = height;
	if (visionMaxWhRatio !== void 0 && effectiveWidth > effectiveHeight * visionMaxWhRatio) effectiveWidth = effectiveHeight * visionMaxWhRatio;
	if (effectiveWidth * effectiveHeight > 0 && effectiveWidth * effectiveHeight < visionMinPixels) {
		const ratio = (visionMinPixels / (effectiveWidth * effectiveHeight)) ** .5;
		effectiveWidth = Math.trunc(effectiveWidth * ratio);
		effectiveHeight = Math.trunc(effectiveHeight * ratio);
	}
	const bestWidth = Math.ceil(effectiveWidth / patch) * patch;
	const bestHeight = Math.ceil(effectiveHeight / patch) * patch;
	const resolved = safeResize(effectiveHeight, effectiveWidth, bestHeight, bestWidth);
	return Object.freeze({ ...resolved });
}
/**
* Token count of one expanded image block, port of `build_image_block` length.
* @internal exported for direct golden-fixture comparison.
*/
function deepSeekVisionImageBlockTokens(nLlmH, nLlmW, startTokenPos) {
	const compressPad = 3 - startTokenPos % COMPRESS_PAD_TO;
	const rows = nLlmH + nLlmH % 2;
	const rowLen = nLlmW + 1;
	const padLast = Math.floor(rows / 2) * rowLen % 2 * 2;
	return compressPad + 1 + rows * rowLen + padLast + 1;
}
/** Port of the official `grid_tokens` N-layout occupancy check. */
function gridTokens(bestHeight, bestWidth) {
	const { visionPatchSize: patch, visionDownsampleRatio: downsample } = DEEPSEEK_VISION_PROJECTION;
	const nLlmH = Math.ceil(Math.floor(bestHeight / patch) / downsample);
	const nLlmW = Math.ceil(Math.floor(bestWidth / patch) / downsample);
	let numTokens = nLlmH * (nLlmW + 1) + 2;
	if (nLlmH % 2 === 1) numTokens += nLlmW + 1;
	numTokens += Math.floor((nLlmH + 1) / 2) * (nLlmW + 1) % 2 * 2;
	return {
		nLlmH,
		nLlmW,
		numTokens
	};
}
/** Port of the official `solve_resize_ratio` budget solver. */
function solveResizeRatio(height, width, maxNTokens) {
	const { visionPatchSize: patch, visionDownsampleRatio: downsample } = DEEPSEEK_VISION_PROJECTION;
	const ratio = height / width;
	const maxWFloat = Math.sqrt((maxNTokens - 2) / ratio + .25) - .5;
	const maxHFloat = maxWFloat * ratio;
	let bestWidth;
	let bestHeight;
	if (maxWFloat < 1) {
		const maxW = 1;
		let maxH = Math.floor((maxNTokens - 2) / 2);
		if (maxH % 2 === 1) maxH -= 1;
		bestWidth = maxW * patch * downsample;
		bestHeight = maxH * patch * downsample;
	} else if (maxHFloat < 2) {
		const maxH = 2;
		const maxW = Math.floor((maxNTokens - 2) / maxH) - 1;
		if (maxW <= 1) throw new Error("DeepSeek vision resize solver produced an invalid width");
		bestWidth = maxW * patch * downsample;
		bestHeight = maxH * patch * downsample;
	} else {
		const maxW = Math.floor(maxWFloat);
		let maxH = Math.floor(maxHFloat);
		if (maxH % 2 === 1) maxH -= 1;
		const beta = Math.min(maxW * patch * downsample / width, maxH * patch * downsample / height);
		bestWidth = Math.floor(width * beta / patch) * patch;
		bestHeight = Math.floor(height * beta / patch) * patch;
	}
	const grid = gridTokens(bestHeight, bestWidth);
	return {
		nLlmH: grid.nLlmH,
		nLlmW: grid.nLlmW,
		bestHeight,
		bestWidth
	};
}
/** Port of the official `safe_resize` loop with the compress-pad budget. */
function safeResize(height, width, initialBestHeight, initialBestWidth) {
	const { visionMaxNTokens } = DEEPSEEK_VISION_PROJECTION;
	let budget = visionMaxNTokens - 3;
	let grid = gridTokens(initialBestHeight, initialBestWidth);
	let bestHeight = initialBestHeight;
	let bestWidth = initialBestWidth;
	while (grid.numTokens > budget) {
		const solved = solveResizeRatio(height, width, budget);
		grid = gridTokens(solved.bestHeight, solved.bestWidth);
		bestHeight = solved.bestHeight;
		bestWidth = solved.bestWidth;
		budget -= 1;
	}
	return {
		nLlmH: grid.nLlmH,
		nLlmW: grid.nLlmW,
		bestHeight,
		bestWidth
	};
}
//#endregion
//#region src/token-count.ts
/** Build an explicit unavailable result without inventing an estimate. */
function unavailableTokenCount(reason) {
	if (reason.length === 0) throw new TypeError("unavailable token count requires a reason");
	return Object.freeze({
		kind: "unavailable",
		reason
	});
}
/** Sum independent canonical fields only when every count has one identity. */
function countExactCanonicalTextFields(fields, counter, subject) {
	if (subject.length === 0) throw new TypeError("canonical text field count requires a subject");
	const values = fields.length === 0 ? [""] : fields;
	let identity;
	let tokens = 0;
	for (const value of values) {
		const count = counter(value);
		if (count.kind !== "exact-tokenizer") return unavailableTokenCount(`${subject}: ${count.kind === "unavailable" ? count.reason : "canonical content requires an exact tokenizer count"}`);
		if (identity !== void 0 && (identity.tokenizerId !== count.tokenizerId || identity.tokenizerRevision !== count.tokenizerRevision)) return unavailableTokenCount(`${subject}: tokenizer identity changed within one measurement`);
		identity ??= count;
		tokens += count.tokens;
		if (!Number.isSafeInteger(tokens) || tokens < 0) return unavailableTokenCount(`${subject}: token sum is outside the safe integer range`);
	}
	if (identity === void 0) return unavailableTokenCount(`${subject}: no tokenizer identity`);
	return Object.freeze({
		...identity,
		tokens
	});
}
//#endregion
//#region src/measurement.ts
const VISION_MODEL_ID = DEEPSEEK_VISION_TOKENIZER_ARTIFACT.modelIds[0];
/**
* Capture one route-bound view without calling patched Harness methods.
* Official `measure()` remains authoritative for request pressure; the bundled
* tokenizer supplies exact canonical content counts used by safe rewrites.
*/
function measureForCompaction(ctx, session) {
	const header = session.requestHeader();
	const measurement = ctx.tokenMeter.measure(session, header);
	const target = header?.config;
	const counter = bindCounter(target?.provider, target?.model);
	const events = sessionEvents(session);
	const measuredNodes = measurement.nodes.map((node) => {
		const event = events[node.seq];
		if (event === void 0) return {
			seq: node.seq,
			count: unavailableTokenCount(`surface node ${String(node.seq)} is missing`)
		};
		const message = deriveEventMessage(event);
		if (message === null) return {
			seq: node.seq,
			count: unavailableTokenCount(`surface node ${String(node.seq)} is not model-visible`)
		};
		const count = countCanonicalContent(message.content, counter, `surface node ${String(node.seq)}`);
		const intrinsicImageBlockEstimate = count.kind === "tokenizer-estimate" ? intrinsicImageDiagnostic(message.content, target) : void 0;
		return {
			seq: node.seq,
			count,
			...intrinsicImageBlockEstimate === void 0 ? {} : { intrinsicImageBlockEstimate }
		};
	});
	const currentSurface = countSurfaceCounts(measuredNodes.map((node) => node.count), "current surface");
	const intrinsicImageBlockEstimateTokens = measuredNodes.reduce((sum, node) => sum + (node.intrinsicImageBlockEstimate?.paddingMinimumTokens ?? 0), 0);
	return Object.freeze({
		...measurement,
		...target === void 0 ? {} : {
			providerRoute: target.provider,
			modelId: target.model
		},
		measuredNodes: Object.freeze(measuredNodes),
		currentSurface,
		intrinsicImageBlockEstimateTokens,
		countCanonicalText: counter.countText
	});
}
/**
* Count one canonical content walk in canonical field order.
*
* Text, reasoning, tool-call names/arguments, and nested text tool results are
* counted exactly with one tokenizer identity. Image blocks produce a bounded
* estimate because the absolute prompt position and the adapter's final
* projection are not publicly observable. A mixed text/image node is therefore
* an estimate and never qualifies for an exact rewrite proof.
*/
function countCanonicalContent(blocks, counter, subject) {
	let identity;
	let estimateIdentity;
	let tokens = 0;
	let upperBoundTokens = 0;
	let firstRefusal;
	const absorb = (count) => {
		if (count.kind === "unavailable") {
			firstRefusal ??= count;
			return false;
		}
		if (count.kind === "exact-tokenizer") {
			if (identity !== void 0 && (identity.tokenizerId !== count.tokenizerId || identity.tokenizerRevision !== count.tokenizerRevision)) {
				firstRefusal ??= unavailableTokenCount(`${subject}: tokenizer identity changed within one measurement`);
				return false;
			}
			identity ??= count;
			tokens += count.tokens;
			upperBoundTokens += count.tokens;
		} else {
			if (estimateIdentity !== void 0 && (estimateIdentity.estimatorId !== count.estimatorId || estimateIdentity.estimatorRevision !== count.estimatorRevision)) {
				firstRefusal ??= unavailableTokenCount(`${subject}: image estimator identity changed within one measurement`);
				return false;
			}
			estimateIdentity ??= {
				estimatorId: count.estimatorId,
				estimatorRevision: count.estimatorRevision
			};
			tokens += count.tokens;
			upperBoundTokens += count.upperBoundTokens;
		}
		return Number.isSafeInteger(tokens) && tokens >= 0 && Number.isSafeInteger(upperBoundTokens) && upperBoundTokens >= tokens;
	};
	const walk = (content) => {
		for (const block of content) switch (block.type) {
			case "text":
			case "reasoning":
				if (!absorb(counter.countText(block.text))) return false;
				break;
			case "tool-call":
				if (!absorb(counter.countText(block.name))) return false;
				if (!absorb(counter.countText(block.arguments))) return false;
				break;
			case "tool-result":
				if (!walk(block.content)) return false;
				break;
			case "image":
				if (!absorb(counter.countImage(block.attachment))) return false;
				break;
			default:
				firstRefusal ??= unavailableTokenCount(`${subject}: contains an unsupported content block`);
				return false;
		}
		return true;
	};
	if (!walk(blocks)) {
		if (firstRefusal?.kind === "unavailable") return unavailableTokenCount(`${subject}: ${firstRefusal.reason}`);
		return unavailableTokenCount(`${subject}: contains content the canonical counter cannot count exactly`);
	}
	if (identity === void 0 && estimateIdentity === void 0) {
		const empty = counter.countText("");
		if (empty.kind !== "exact-tokenizer") return empty;
		return empty;
	}
	if (!Number.isSafeInteger(tokens) || tokens < 0) return unavailableTokenCount(`${subject}: invalid token sum`);
	if (estimateIdentity !== void 0) return Object.freeze({
		kind: "tokenizer-estimate",
		...estimateIdentity,
		tokens,
		upperBoundTokens
	});
	if (identity === void 0) return unavailableTokenCount(`${subject}: no tokenizer identity`);
	return Object.freeze({
		...identity,
		tokens
	});
}
function bindCounter(provider, model) {
	if (provider === void 0 || model === void 0) {
		const unavailable = () => unavailableTokenCount("canonical text: no durable provider/model request header");
		return {
			countText: unavailable,
			countImage: () => unavailableTokenCount("canonical image: no durable provider/model request header")
		};
	}
	if (provider !== "deepseek" && provider !== "deepseek-official") {
		const reason = `canonical text: provider "${provider}" is not the supported DeepSeek route`;
		return {
			countText: () => unavailableTokenCount(reason),
			countImage: () => unavailableTokenCount(`canonical image: provider "${provider}" is not the supported DeepSeek route`)
		};
	}
	const tokenizer = deepSeekV4TokenizerForModel(model);
	if (tokenizer === void 0) {
		const reason = `canonical text: no verified bundled tokenizer for model "${model}"`;
		return {
			countText: () => unavailableTokenCount(reason),
			countImage: (attachment) => countCanonicalImage(model, attachment)
		};
	}
	return {
		countText: (text) => tokenizer.countText(text),
		countImage: (attachment) => countCanonicalImage(model, attachment)
	};
}
/**
* Images never claim an exact count. The official expansion depends on the
* absolute prompt position (system prompt, chat-template framing, adapter
* image handles) and on the adapter's final request-image projection, neither
* of which is exposed through a public API; a route may even override the
* pixel budget or re-project under the byte cap. Valid dimensions therefore
* use the midpoint of the four alignment residues as a bounded estimate;
* malformed dimensions use a fixed default. Estimate-bearing nodes remain
* ineligible for exact rewrite proofs.
*/
function countCanonicalImage(model, attachment) {
	if (model !== VISION_MODEL_ID) return unavailableTokenCount(`canonical image: model "${model}" has no vision image counter`);
	const estimate = estimateDeepSeekVisionImageTokens(attachment.width, attachment.height);
	return Object.freeze({
		kind: "tokenizer-estimate",
		tokens: estimate.tokens,
		upperBoundTokens: estimate.upperBoundTokens,
		estimatorId: DEEPSEEK_VISION_IMAGE_ESTIMATOR.id,
		estimatorRevision: DEEPSEEK_VISION_IMAGE_ESTIMATOR.revision
	});
}
/**
* Intrinsic-grid diagnostic for one content walk: the official block
* arithmetic on intrinsic dimensions at both alignment extremes. Only images
* on the pinned DeepSeek vision route with usable metadata contribute.
*/
function intrinsicImageDiagnostic(blocks, target) {
	if (target === void 0 || target.provider !== "deepseek" && target.provider !== "deepseek-official" || target.model !== VISION_MODEL_ID) return void 0;
	let paddingMinimumTokens = 0;
	let paddingMaximumTokens = 0;
	let seen = false;
	const walk = (content) => {
		for (const block of content) if (block.type === "image") {
			const { width, height } = block.attachment;
			const estimate = estimateDeepSeekVisionImageTokens(width, height);
			if (estimate.source !== "intrinsic-grid" || estimate.paddingMinimumTokens === void 0 || estimate.paddingMaximumTokens === void 0) continue;
			paddingMinimumTokens += estimate.paddingMinimumTokens;
			paddingMaximumTokens += estimate.paddingMaximumTokens;
			seen = true;
		} else if (block.type === "tool-result") walk(block.content);
	};
	walk(blocks);
	return seen ? Object.freeze({
		paddingMinimumTokens,
		paddingMaximumTokens
	}) : void 0;
}
function countSurfaceCounts(counts, subject) {
	if (counts.length === 0) return unavailableTokenCount(`${subject}: no surface nodes`);
	let identity;
	let estimateIdentity;
	let tokens = 0;
	let upperBoundTokens = 0;
	for (const count of counts) {
		if (count.kind === "unavailable") return unavailableTokenCount(`${subject}: ${count.reason}`);
		if (count.kind === "exact-tokenizer") {
			if (identity !== void 0 && (identity.tokenizerId !== count.tokenizerId || identity.tokenizerRevision !== count.tokenizerRevision)) return unavailableTokenCount(`${subject}: tokenizer identity changed within one measurement`);
			identity ??= count;
			tokens += count.tokens;
			upperBoundTokens += count.tokens;
		} else {
			if (estimateIdentity !== void 0 && (estimateIdentity.estimatorId !== count.estimatorId || estimateIdentity.estimatorRevision !== count.estimatorRevision)) return unavailableTokenCount(`${subject}: image estimator identity changed within one measurement`);
			estimateIdentity ??= {
				estimatorId: count.estimatorId,
				estimatorRevision: count.estimatorRevision
			};
			tokens += count.tokens;
			upperBoundTokens += count.upperBoundTokens;
		}
	}
	if (!Number.isSafeInteger(tokens) || tokens < 0 || !Number.isSafeInteger(upperBoundTokens) || upperBoundTokens < tokens) return unavailableTokenCount(`${subject}: invalid token sum`);
	if (estimateIdentity !== void 0) return Object.freeze({
		kind: "tokenizer-estimate",
		...estimateIdentity,
		tokens,
		upperBoundTokens
	});
	if (identity === void 0) return unavailableTokenCount(`${subject}: no tokenizer identity`);
	return Object.freeze({
		...identity,
		tokens
	});
}
z.object({
	maxChars: z.number().step(1).min(1).default(5e4),
	maxScanChars: z.number().step(1).min(1).default(25e4),
	maxQueryChars: z.number().step(1).min(1).default(256)
});
const REF_PATTERN = /^session:\/\/([^/]+)\/event\/(\d+)$/;
const MAX_LINES = 1e3;
const DEFAULT_MAX_CHARS = 5e4;
const DEFAULT_MAX_SCAN_CHARS = 25e4;
const DEFAULT_MAX_QUERY_CHARS = 256;
const TRUNCATION_MARKER = "\n[context_compression_retrieve output truncated; reported lines describe the selected source range]\n";
const PROMPT = "When a compacted tool result contains a session://<session-id>/event/<seq> reference, or TailTrim contains a session://<session-id>/tailtrim/<seq> reference, use context_compression_retrieve with that exact ref and a narrow line range or query if the omitted evidence is necessary. The returned event content comes from the append-only session log, which is the source of truth.";
const OUTPUT = {
	schema: { type: "string" },
	render: (_args, value) => [{
		type: "text",
		text: value
	}]
};
/**
* Register the current-session recovery tool and its stable guidance.
*
* @param ctx Plugin context providing the tool registry and system prompt.
* @param config Optional response, scan, and query bounds.
*/
function installContextCompressionRetrieve(ctx, config = {}) {
	const maxChars = resolvePositiveInteger("maxChars", config.maxChars, DEFAULT_MAX_CHARS);
	const maxScanChars = resolvePositiveInteger("maxScanChars", config.maxScanChars, DEFAULT_MAX_SCAN_CHARS);
	const maxQueryChars = resolvePositiveInteger("maxQueryChars", config.maxQueryChars, DEFAULT_MAX_QUERY_CHARS);
	ctx.systemPrompt.section({
		name: "tool:context-compression-retrieve",
		order: 114,
		text: PROMPT
	});
	ctx.tools.register(defineTool({
		name: "context_compression_retrieve",
		description: "Recover exact content from one compacted tool result or TailTrim group using its current-session session:// reference.",
		parameters: {
			ref: {
				type: "string",
				required: true,
				description: "Exact session://<current-session-id>/event/<seq> or /tailtrim/<seq> reference from a placeholder."
			},
			query: {
				type: "string",
				description: "Optional case-insensitive text to search for inside the original result."
			},
			start_line: {
				type: "integer",
				description: "Optional 1-based first line for a direct slice. Defaults to 1."
			},
			max_lines: {
				type: "integer",
				description: "Maximum lines to return. Defaults to 200; maximum 1000."
			}
		},
		output: OUTPUT,
		isConcurrencySafe: () => true,
		execute(args, exec) {
			if (exec.agent === void 0) throw new Error("context_compression_retrieve requires an agent session");
			const match = REF_PATTERN.exec(args.ref);
			const tailTrimRef = parseTailTrimRef(args.ref);
			if (match === null && tailTrimRef === null) throw new Error("context_compression_retrieve: ref must be session://<session-id>/(event|tailtrim)/<seq>");
			if ((match?.[1] ?? tailTrimRef?.sessionId) !== String(exec.agent.id)) throw new Error("context_compression_retrieve: a compression reference may only read the caller's current session");
			if (tailTrimRef !== null) return Promise.resolve(recoverTailTrim(exec.agent.session, args.ref, tailTrimRef.manifestSeq, args.query, args.start_line, args.max_lines, {
				maxChars,
				maxScanChars,
				maxQueryChars
			}));
			const seq = Number(match?.[2]);
			const event = sessionEvents(exec.agent.session)[seq];
			if (event?.type !== "tool/result") throw new Error(`context_compression_retrieve: event ${String(seq)} is not a tool/result in the current session`);
			const maxLines = resolveMaxLines(args.max_lines);
			const scan = scanBlocks(event.data.message.content[0].content, maxScanChars);
			const scannedLines = splitScannedLines(scan);
			const lines = scannedLines.lines;
			const query = args.query;
			if (query !== void 0 && exceedsCodePointLimit(query, maxQueryChars)) throw new Error(`context_compression_retrieve: query must be at most ${String(maxQueryChars)} Unicode code points`);
			const selected = query === void 0 || query === "" ? directSlice(lines, args.start_line ?? 1, maxLines, scan.complete, scannedLines.partialTail) : querySlice(lines, query, maxLines, scan.complete, scannedLines.partialTail);
			const total = scan.complete ? String(lines.length) : `at least ${String(lines.length)}`;
			const output = `${[
				`source: ${args.ref}`,
				`tool_call_id: ${event.data.message.source.callId}`,
				`status: ${event.data.message.content[0].isError === true ? "error" : "completed"}`,
				`lines: ${String(selected.start)}-${String(selected.end)} of ${total}`,
				scan.complete ? "" : "note: source scan limit reached; later lines were not inspected",
				selected.partialLine === void 0 ? "" : `note: line ${String(selected.partialLine)} is a partial prefix ending at the source scan limit`,
				selected.omitted ? query === void 0 || query === "" ? "note: additional source lines were omitted" : "note: additional matching or neighboring lines were omitted" : "",
				"--- original tool result ---"
			].filter(Boolean).join("\n")}\n${selected.text}`;
			return Promise.resolve(boundCodePoints(output, maxChars));
		}
	}));
}
function recoverTailTrim(session, ref, manifestSeq, query, startLine, requestedMaxLines, bounds) {
	const published = validatePublishedTailTrim(session, manifestSeq);
	if (published === null || published.ref !== ref) throw new Error("context_compression_retrieve: ref is not a valid published TailTrim group");
	if (query !== void 0 && exceedsCodePointLimit(query, bounds.maxQueryChars)) throw new Error(`context_compression_retrieve: query must be at most ${String(bounds.maxQueryChars)} Unicode code points`);
	const fixedHeader = [
		`source: ${ref}`,
		"kind: tailtrim-group",
		`records: ${String(published.roots.length)}`,
		"--- original tool group (jsonl) ---"
	].join("\n");
	const scanBudget = Math.max(0, bounds.maxScanChars - codePointLength$1(`${fixedHeader}\n`));
	const scan = consumeChunks(renderGroupRecordChunks(published.roots), scanBudget);
	const scannedLines = splitScannedLines(scan);
	const maxLines = resolveMaxLines(requestedMaxLines);
	const selected = query === void 0 || query === "" ? directSlice(scannedLines.lines, startLine ?? 1, maxLines, scan.complete, scannedLines.partialTail) : querySlice(scannedLines.lines, query, maxLines, scan.complete, scannedLines.partialTail);
	return boundCodePoints(`${[
		fixedHeader.split("\n").slice(0, 3).join("\n"),
		scan.complete ? "" : "note: source scan limit reached; later records were not inspected",
		selected.omitted ? "note: additional group records were omitted" : "",
		"--- original tool group (jsonl) ---"
	].filter(Boolean).join("\n")}\n${selected.text}`, bounds.maxChars);
}
function resolvePositiveInteger(name, value, fallback) {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new TypeError(`tool-context-retrieve: ${name} must be a positive safe integer`);
	return resolved;
}
function resolveMaxLines(value) {
	const resolved = value ?? 200;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_LINES) throw new Error(`context_compression_retrieve: max_lines must be an integer from 1 to ${String(MAX_LINES)}`);
	return resolved;
}
function scanBlocks(blocks, maxChars) {
	return consumeChunks(renderBlockChunks(blocks), maxChars);
}
function* renderBlockChunks(blocks) {
	let first = true;
	for (const block of blocks) {
		if (!first) yield "\n";
		first = false;
		if (block.type === "text") yield block.text;
		else yield* jsonTokens(block);
	}
}
function* renderGroupRecordChunks(roots) {
	let first = true;
	for (const root of roots) {
		if (!first) yield "\n";
		first = false;
		const message = root.data.message;
		yield* jsonTokens({
			seq: root.seq,
			type: root.type,
			message: {
				id: message.id,
				role: message.role,
				content: message.content,
				source: message.source
			}
		});
	}
}
function* jsonTokens(value) {
	if (value === null) {
		yield "null";
		return;
	}
	switch (typeof value) {
		case "string":
			yield "\"";
			for (const point of value) yield jsonScalar(point).slice(1, -1);
			yield "\"";
			return;
		case "number":
		case "boolean":
			yield jsonScalar(value);
			return;
		case "object": {
			if (Array.isArray(value)) {
				yield "[";
				for (let index = 0; index < value.length; index++) {
					if (index > 0) yield ",";
					yield* jsonTokens(value[index]);
				}
				yield "]";
				return;
			}
			yield "{";
			let first = true;
			for (const key in value) {
				if (!Object.hasOwn(value, key)) continue;
				if (!first) yield ",";
				first = false;
				yield* jsonTokens(key);
				yield ":";
				yield* jsonTokens(value[key]);
			}
			yield "}";
			return;
		}
		default: throw new TypeError("context_compression_retrieve: source content is not JSON-serializable");
	}
}
function jsonScalar(value) {
	return JSON.stringify(value);
}
function consumeChunks(chunks, maxChars) {
	const output = [];
	let remaining = maxChars;
	for (const chunk of chunks) {
		const prefix = codePointPrefix(chunk, remaining);
		output.push(prefix.text);
		remaining -= prefix.count;
		if (!prefix.complete) return {
			text: output.join(""),
			complete: false
		};
	}
	return {
		text: output.join(""),
		complete: true
	};
}
function splitScannedLines(scan) {
	const lines = scan.text.split("\n");
	const partialTail = !scan.complete && !scan.text.endsWith("\n");
	if (scan.text.endsWith("\n")) lines.pop();
	return {
		lines,
		partialTail
	};
}
function directSlice(lines, startLine, maxLines, scanComplete, partialTail) {
	if (!Number.isSafeInteger(startLine) || startLine < 1) throw new Error("context_compression_retrieve: start_line must be a positive safe integer");
	if (startLine > lines.length) throw new Error(`context_compression_retrieve: start_line ${String(startLine)} is ${scanComplete ? "outside the source line range" : "beyond the source scan limit"}`);
	const startIndex = startLine - 1;
	const selected = lines.slice(startIndex, startIndex + maxLines);
	return {
		text: selected.join("\n"),
		start: startIndex + 1,
		end: startIndex + selected.length,
		omitted: startIndex > 0 || startIndex + selected.length < lines.length || !scanComplete,
		...partialTail && startIndex + selected.length === lines.length ? { partialLine: lines.length } : {}
	};
}
function querySlice(lines, query, maxLines, scanComplete, partialTail) {
	const needle = query.toLowerCase();
	const chosen = /* @__PURE__ */ new Set();
	let matched = false;
	let omitted = !scanComplete;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line === void 0 || !line.toLowerCase().includes(needle)) continue;
		matched = true;
		for (let row = Math.max(0, index - 2); row <= Math.min(lines.length - 1, index + 2); row++) {
			if (chosen.has(row)) continue;
			if (chosen.size >= maxLines) {
				omitted = true;
				continue;
			}
			chosen.add(row);
		}
	}
	if (!matched) return {
		text: scanComplete ? "[no matches]" : "[no matches within source scan limit]",
		start: 0,
		end: 0,
		omitted
	};
	const ordered = [...chosen].sort((a, b) => a - b);
	const rendered = [];
	let previous = -2;
	let start = 0;
	let end = 0;
	for (const index of ordered) {
		const line = lines[index];
		if (line === void 0) continue;
		if (index > previous + 1) rendered.push("...");
		rendered.push(`${String(index + 1)}: ${line}`);
		if (start === 0) start = index + 1;
		end = index + 1;
		previous = index;
	}
	return {
		text: rendered.join("\n"),
		start,
		end,
		omitted,
		...partialTail && ordered.includes(lines.length - 1) ? { partialLine: lines.length } : {}
	};
}
function boundCodePoints(text, maxChars) {
	if (codePointPrefix(text, maxChars).complete) return text;
	const marker = codePointPrefix(TRUNCATION_MARKER, maxChars);
	if (!marker.complete) return marker.text;
	return codePointPrefix(text, maxChars - marker.count).text + marker.text;
}
function codePointPrefix(text, maxChars) {
	const output = [];
	let count = 0;
	for (const point of text) {
		if (count >= maxChars) return {
			text: output.join(""),
			count,
			complete: false
		};
		output.push(point);
		count++;
	}
	return {
		text: output.join(""),
		count,
		complete: true
	};
}
function exceedsCodePointLimit(text, limit) {
	let count = 0;
	for (const _point of text) {
		count++;
		if (count > limit) return true;
	}
	return false;
}
function codePointLength$1(text) {
	let count = 0;
	for (const _point of text) count++;
	return count;
}
//#endregion
//#region src/tokenpilot/locator.ts
/** Files touched by read/grep-style tool calls inside the range. */
const TOUCHED_FILE_TOOL = /(?:^|[-_])?(?:read|write|edit|glob|grep|view|str_replace_editor)(?:$|[-_])/i;
/** Spill notice paths emitted by the Harness output-retention policy. */
const SPILL_PATH = /stored at:\s*([^\s)\]]+)/g;
/** Tool call arguments keys that commonly carry a file path. */
const PATH_KEYS$1 = ["path", "file_path"];
/**
* Find the latest compaction/summary event matching the compaction id of a
* compaction/end event. Returns undefined when the transaction cannot be
* identified — the caller must skip rather than guess.
*/
function findCompactionTrace(events, compactionId) {
	let trace;
	for (const event of events) if (event.type === "compaction/summary" && event.data.compactionId === compactionId) trace = {
		compactionId,
		summarySeq: event.seq,
		summaryShadowedRange: event.data.shadowedRange
	};
	return trace;
}
/** Extract spill file paths from one text chunk. */
function extractSpillPaths(text) {
	const paths = [];
	for (const match of text.matchAll(SPILL_PATH)) {
		const path = match[1]?.replace(/[.,;]+$/, "");
		if (path !== void 0 && path.length > 0) paths.push(path);
	}
	return paths;
}
/** Extract touched file paths from one tool/call event's arguments. */
function extractTouchedPath(name, argumentsText) {
	if (!TOUCHED_FILE_TOOL.test(name)) return void 0;
	let parsed;
	try {
		parsed = JSON.parse(argumentsText);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null) return void 0;
	const record = parsed;
	for (const key of PATH_KEYS$1) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
}
/**
* Build the Exact Sources block for one shadowed range, or null when the
* range locates nothing concrete (no spill files and no touched files).
*/
function buildLocatorBlock(events, shadowedRange) {
	const spillFiles = /* @__PURE__ */ new Set();
	const touchedFiles = /* @__PURE__ */ new Set();
	for (let seq = shadowedRange.start; seq <= shadowedRange.end && seq < events.length; seq += 1) {
		const event = events[seq];
		if (event === void 0) continue;
		if (event.type === "tool/call") {
			const path = extractTouchedPath(event.data.name, event.data.arguments);
			if (path !== void 0) touchedFiles.add(path);
			continue;
		}
		if (event.type === "tool/result" || event.type === "user/message") {
			const data = event.data;
			const content = Array.isArray(data.content) ? data.content : data.message?.content;
			if (!Array.isArray(content)) continue;
			for (const block of content) if (block.type === "text") for (const path of extractSpillPaths(block.text)) spillFiles.add(path);
		}
	}
	if (spillFiles.size === 0 && touchedFiles.size === 0) return null;
	return {
		text: [
			"## Exact Sources (locators)",
			`- seq range: ${String(shadowedRange.start)}-${String(shadowedRange.end)}`,
			...[...spillFiles].map((path) => `- spill file: ${path}`),
			...[...touchedFiles].map((path) => `- file touched: ${path}`),
			"(Use `read <spill file>` or `context_compression_retrieve` with a `session://` source to restore exact text.)"
		].join("\n"),
		spillFiles: spillFiles.size,
		touchedFiles: touchedFiles.size
	};
}
//#endregion
//#region src/tokenpilot/read-state.ts
/** Write-style tool names whose success supersedes earlier reads. */
const WRITE_TOOLS = /(?:^|[-_])?(?:write|edit|apply_patch|file_write|file_edit|str_replace|replace|multiedit)(?:$|[-_])/i;
const PATH_KEYS = ["path", "file_path"];
/** Parse one path out of a tool-call arguments JSON blob. */
function toolCallPath(argumentsText) {
	let parsed;
	try {
		parsed = JSON.parse(argumentsText);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null) return void 0;
	const record = parsed;
	for (const key of PATH_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
}
/**
* Decide whether an oversized read result was superseded by a later mutation
* of the same file. `readPath` is the read call's target path; events after
* `readSeq` are scanned for a write-style call on it.
*/
function isSupersededRead(events, readSeq, readPath) {
	if (readPath === void 0) return false;
	for (let seq = readSeq + 1; seq < events.length; seq += 1) {
		const event = events[seq];
		if (event?.type !== "tool/call") continue;
		if (!WRITE_TOOLS.test(event.data.name)) continue;
		if (toolCallPath(event.data.arguments) === readPath) return true;
	}
	return false;
}
/** Error/warning/info line classifiers used by the omission summary. */
const ERROR_LINE = /\b(error|failed|failure|fatal|exception|traceback|cannot|unable|denied)\b/i;
const WARN_LINE = /\b(warn|warning|deprecated)\b/i;
/**
* Cluster one omitted line-count into an error/warn/info census appended to a
* placeholder marker, giving the model meta-knowledge about what was dropped.
*/
function clusterOmittedLines(text, omittedLines) {
	if (omittedLines <= 0) return void 0;
	let errors = 0;
	let warns = 0;
	let infos = 0;
	for (const line of text.split("\n")) if (ERROR_LINE.test(line)) errors += 1;
	else if (WARN_LINE.test(line)) warns += 1;
	else infos += 1;
	const parts = [];
	if (errors > 0) parts.push(`${String(errors)} error`);
	if (warns > 0) parts.push(`${String(warns)} warn`);
	if (infos > 0) parts.push(`${String(infos)} info`);
	if (parts.length === 0) return void 0;
	return `${String(omittedLines)} lines omitted (${parts.join(", ")})`;
}
//#endregion
//#region src/tokenpilot/estimator.ts
/** Exponential backoff with a 5-minute cap: 1s, 2s, 4s, … */
function backoffCooldownMs(failures) {
	return Math.min(3e5, 1e3 * 2 ** Math.max(0, failures - 1));
}
function isCoolingDown(state, now) {
	return state !== void 0 && state.cooldownUntil > now;
}
function buildEstimatorSystemPrompt() {
	return [
		"You are a session residual-utility estimator.",
		"For each numbered historical file read, decide whether the live agent is likely to",
		"reference that exact file state again later in the session. Reads whose file was",
		"already rewritten, or whose task has visibly moved on, are expired.",
		"Answer with ONLY a JSON array: [{\"seq\":<number>,\"expired\":<boolean>}]."
	].join(" ");
}
function buildEstimatorUserPrompt(samples) {
	return samples.map((sample) => `{"seq":${String(sample.seq)},"path":${JSON.stringify(sample.path)},"turn":${String(sample.turn)}}`).join("\n");
}
/** Parse the estimator answer; anything malformed yields no verdicts. */
function parseEstimatorAnswer(text) {
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start < 0 || end <= start) return [];
	try {
		const parsed = JSON.parse(text.slice(start, end + 1));
		if (!Array.isArray(parsed)) return [];
		const verdicts = [];
		for (const entry of parsed) {
			if (typeof entry !== "object" || entry === null) continue;
			const record = entry;
			if (typeof record.seq !== "number" || typeof record.expired !== "boolean") continue;
			verdicts.push({
				seq: record.seq,
				expired: record.expired
			});
		}
		return verdicts;
	} catch {
		return [];
	}
}
/** One channel-bound estimator. `ask` resolves undefined on any failure. */
var Estimator = class {
	ctx;
	options;
	constructor(ctx, options) {
		this.ctx = ctx;
		this.options = options;
	}
	get enabled() {
		return this.options.estimatorMode === "host" || this.options.estimatorMode === "direct";
	}
	async ask(system, user, signal) {
		const timeoutMs = this.options.estimatorTimeoutMs ?? 3e3;
		const timeout = AbortSignal.timeout(timeoutMs);
		const signal2 = typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : timeout;
		try {
			if (this.options.estimatorMode === "host") return await this.askHost(system, user, signal2);
			if (this.options.estimatorMode === "direct") return await this.askDirect(system, user, signal2);
			return;
		} catch {
			return;
		}
	}
	async askHost(system, user, signal) {
		let llm;
		try {
			llm = this.ctx.get("llm");
		} catch {
			return;
		}
		if (llm?.stream === void 0) return void 0;
		const provider = this.options.estimatorProvider ?? "";
		const model = this.options.estimatorModel ?? "";
		if (provider.length === 0 || model.length === 0) return void 0;
		let text = "";
		const stream = llm.stream({
			provider,
			model,
			messages: [{
				role: "user",
				content: [{
					type: "text",
					text: user
				}]
			}],
			system,
			temperature: 0,
			reasoningEffort: "off",
			maxTokens: 256,
			signal
		});
		for await (const chunk of stream) if ((chunk.type === "text-delta" || chunk.type === "reasoning-delta") && typeof chunk.text === "string") text += chunk.text;
		else if (chunk.type === "finish" && chunk.text === void 0) break;
		return text.trim().length > 0 ? text : void 0;
	}
	async askDirect(system, user, signal) {
		const baseUrl = this.options.estimatorBaseUrl;
		if (baseUrl === void 0 || baseUrl.length === 0) return void 0;
		const headers = { "content-type": "application/json" };
		if (this.options.estimatorApiKey !== void 0 && this.options.estimatorApiKey.length > 0) headers.authorization = `Bearer ${this.options.estimatorApiKey}`;
		const model = this.options.estimatorModel ?? "";
		if (model.length === 0) return void 0;
		const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				messages: [{
					role: "system",
					content: system
				}, {
					role: "user",
					content: user
				}],
				temperature: 0,
				max_tokens: 256
			}),
			signal
		});
		if (!response.ok) return void 0;
		const text = (await response.json()).choices?.[0]?.message?.content;
		return typeof text === "string" && text.trim().length > 0 ? text : void 0;
	}
};
//#endregion
//#region src/tokenpilot/dedup.ts
/**
* TokenPilot-inspired A1: byte-identical repeated tool-result dedup.
*
* Pure helpers behind the ToolResultPruner fresh pass. The per-session table
* maps a canonical-content SHA-256 to the first surface seq that produced it;
* later identical results may be replaced with a pointer placeholder that the
* recovery tool can resolve back to the original full text via the append-only
* session log. Only hash+seq metadata is stored — never content.
*/
/** Per-session dedup index with insertion-order eviction. */
var DedupeTable = class {
	maxEntries;
	entries = /* @__PURE__ */ new Map();
	constructor(maxEntries = 2048) {
		this.maxEntries = maxEntries;
	}
	/** Look up the first occurrence for one canonical hash, if any. */
	get(hash) {
		return this.entries.get(hash);
	}
	/** Record a first occurrence; existing hashes only refresh insertion order. */
	record(hash, entry) {
		if (this.entries.has(hash)) return;
		while (this.entries.size >= this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === void 0) break;
			this.entries.delete(oldest);
		}
		this.entries.set(hash, entry);
	}
};
/** Canonicalize tool-result text for hashing. */
function canonicalizeForDedupe(text, mode) {
	if (mode === "exact") return text;
	return text.replace(/[ \t]+\r?\n/g, "\n").replace(/(^\s+)|(\s+$)/g, "");
}
/** SHA-256 hex of the canonicalized text. */
function dedupeHash(text, mode) {
	return createHash("sha256").update(canonicalizeForDedupe(text, mode), "utf8").digest("hex");
}
/** Concatenated text of an all-text content block list; null when rich. */
function flattenPlainText(content) {
	let text = "";
	for (const block of content) {
		if (block.type !== "text") return void 0;
		text += block.text;
	}
	return text;
}
/** Pointer placeholder pointing at the first occurrence's original event. */
function dedupePlaceholder(entry, originalChars) {
	return [
		`[... identical to the earlier ${entry.toolName} result; first seen at ${entry.sourceRef};`,
		`original_chars=${String(originalChars)};`,
		"use context_compression_retrieve with this source if the omitted evidence is necessary.]"
	].join(" ");
}
//#endregion
//#region src/types.ts
/** User-facing mixed strategy profile. */
const COMPRESSION_PROFILES = [
	"off",
	"native",
	"balanced",
	"cache-strict",
	"savings",
	"adaptive",
	"tokenpilot-inspired",
	"custom"
];
//#endregion
//#region src/value.ts
/** Version-neutral immutable-value and closed-union helpers for the plugin runtime. */
/**
* Freeze an object graph in place without relying on a Harness utility export.
* Live AbortSignals remain mutable so request cancellation continues to work.
* @param value - Value to freeze recursively.
* @returns The same deeply frozen value.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object" || node instanceof AbortSignal || seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
/**
* Throw for an impossible member of a closed discriminated union.
* @param value - Value that escaped its closed union type.
* @param context - Optional switch-site label.
* @returns Never returns.
*/
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context === void 0 ? "" : ` in ${context}`}: ${rendered}`);
}
//#endregion
//#region src/custom-policy.ts
/** Strict versioned Custom policy parsing and effective-token resolution. */
const budgetSchema = z.object({
	enabled: z.boolean().required(),
	trigger: z.number().required(),
	target: z.number().required()
}).required();
const legacyHistorySchema = z.object({
	enabled: z.boolean().required(),
	trigger: z.number().required(),
	keepRecentTurns: z.number().step(1).min(0).required(),
	keepRecent: z.number().required(),
	minReclaim: z.number().required()
}).required();
const historySchema = z.object({
	enabled: z.boolean().required(),
	trigger: z.number().required(),
	keepRecentToolCalls: z.number().step(1).min(0).required(),
	keepRecentTokens: z.number().required(),
	minReclaim: z.number().required()
}).required();
const tailTrimSchema = z.object({
	enabled: z.boolean().required(),
	trigger: z.number().required()
}).required();
const customCompressionPolicyV1InputSchema = z.object({
	version: z.const(1).required(),
	unit: z.union(["tokens", "context-percent"]).required(),
	fresh: budgetSchema,
	aggregate: budgetSchema,
	history: legacyHistorySchema,
	prefixPolicy: z.union(["preserve", "pressure-break"]).required()
}).required();
const customCompressionPolicyV2InputSchema = z.object({
	version: z.const(2).required(),
	unit: z.union(["tokens", "context-percent"]).required(),
	fresh: budgetSchema,
	aggregate: budgetSchema,
	history: legacyHistorySchema,
	prefixPolicy: z.union(["preserve", "pressure-break"]).required(),
	tailTrim: tailTrimSchema
}).required();
const customCompressionPolicyV3InputSchema = z.object({
	version: z.const(3).required(),
	unit: z.union(["tokens", "context-percent"]).required(),
	fresh: budgetSchema,
	aggregate: budgetSchema,
	history: historySchema,
	prefixPolicy: z.union(["preserve", "pressure-break"]).required(),
	tailTrim: tailTrimSchema
}).required();
/** Canonical Custom document accepted by Host settings and the runtime resolver. */
const CustomCompressionPolicySchema = z.transform(z.any().required(), (value) => {
	assertExactPolicyShape(value);
	const canonical = canonicalizeCustomPolicy(value.version === 1 ? customCompressionPolicyV1InputSchema(value) : value.version === 2 ? customCompressionPolicyV2InputSchema(value) : customCompressionPolicyV3InputSchema(value));
	assertCanonicalRelations(canonical);
	return deepFreeze(structuredClone(canonical));
});
/** Balanced-equivalent Custom policy stored as one token-canonical document. */
const DEFAULT_CUSTOM_COMPRESSION_POLICY = deepFreeze({
	version: 3,
	unit: "tokens",
	fresh: {
		enabled: true,
		trigger: 8192,
		target: 3072
	},
	aggregate: {
		enabled: true,
		trigger: 32768,
		target: 12288
	},
	history: {
		enabled: true,
		trigger: 5e5,
		keepRecentToolCalls: 10,
		keepRecentTokens: 64e3,
		minReclaim: 96e3
	},
	prefixPolicy: "pressure-break",
	tailTrim: {
		enabled: false,
		trigger: 7e5
	}
});
/**
* Resolve one validated Custom document to the same token policy used by public presets.
* @param value - untrusted or typed Custom settings value.
* @param options - routed model capacity for context-percent documents.
* @returns a detached deeply immutable effective token policy.
*/
function resolveCustomPolicy(value, options = {}) {
	const policy = canonicalizeCustomPolicy(CustomCompressionPolicySchema(value));
	const effective = (name, amount) => {
		if (policy.unit === "tokens") return amount;
		const contextWindow = options.contextWindowTokens;
		if (!Number.isSafeInteger(contextWindow) || contextWindow === void 0 || contextWindow <= 0) throw new Error("Custom context-percent policy requires a resolved positive model context window");
		const tokens = Math.floor(contextWindow * amount / 100);
		if (!Number.isSafeInteger(tokens) || amount > 0 && tokens <= 0) throw new Error(`Custom ${name} has no valid effective token value for this model`);
		return tokens;
	};
	const resolved = {
		profile: "custom",
		nativeToolResultEnabled: false,
		freshEnabled: policy.fresh.enabled,
		aggregateEnabled: policy.aggregate.enabled,
		historyMode: !policy.history.enabled ? "disabled" : policy.prefixPolicy === "preserve" ? "capacity-pressure" : "routine",
		nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
		nativeTargetTokens: Number.MAX_SAFE_INTEGER,
		freshTriggerTokens: effective("Fresh trigger", policy.fresh.trigger),
		freshTargetTokens: effective("Fresh target", policy.fresh.target),
		aggregateTriggerTokens: effective("Aggregate trigger", policy.aggregate.trigger),
		aggregateTargetTokens: effective("Aggregate target", policy.aggregate.target),
		historyTriggerTokens: effective("History trigger", policy.history.trigger),
		historyKeepRecentToolCalls: policy.history.keepRecentToolCalls,
		historyKeepRecentTokens: effective("History recent token tail", policy.history.keepRecentTokens),
		historyMinReclaimTokens: effective("History min-reclaim", policy.history.minReclaim),
		tailTrim: {
			enabled: policy.tailTrim.enabled,
			triggerTokens: effective("TailTrim trigger", policy.tailTrim.trigger)
		}
	};
	assertEffectiveRelations(resolved);
	return deepFreeze(resolved);
}
function canonicalizeCustomPolicy(policy) {
	if (policy.version === 3) return policy;
	return {
		version: 3,
		unit: policy.unit,
		fresh: policy.fresh,
		aggregate: policy.aggregate,
		history: {
			enabled: policy.history.enabled,
			trigger: policy.history.trigger,
			keepRecentToolCalls: 10,
			keepRecentTokens: policy.history.keepRecent,
			minReclaim: policy.history.minReclaim
		},
		prefixPolicy: policy.prefixPolicy,
		tailTrim: policy.version === 1 ? {
			enabled: false,
			trigger: 7e5
		} : policy.tailTrim
	};
}
function measuredValues(policy) {
	return [
		policy.fresh.trigger,
		policy.fresh.target,
		policy.aggregate.trigger,
		policy.aggregate.target,
		policy.history.trigger,
		policy.history.keepRecentTokens,
		policy.history.minReclaim,
		policy.tailTrim.trigger
	];
}
function validMeasuredValues(policy) {
	const values = measuredValues(policy);
	if (![
		policy.fresh.trigger,
		policy.fresh.target,
		policy.aggregate.trigger,
		policy.aggregate.target,
		policy.history.trigger,
		policy.history.minReclaim,
		policy.tailTrim.trigger
	].every((value) => value > 0) || policy.history.keepRecentTokens < 0 || !Number.isSafeInteger(policy.history.keepRecentToolCalls) || policy.history.keepRecentToolCalls < 0) return false;
	return policy.unit === "tokens" ? values.every(Number.isSafeInteger) : values.every((value) => Number.isFinite(value) && value <= 100);
}
function assertCanonicalRelations(policy) {
	if (!validMeasuredValues(policy)) throw new TypeError("Custom measured values must use the selected canonical unit");
	if (policy.fresh.target >= policy.fresh.trigger) throw new TypeError("Custom Fresh target must be below trigger");
	if (policy.aggregate.target >= policy.aggregate.trigger) throw new TypeError("Custom Aggregate target must be below trigger");
	if (policy.history.minReclaim > policy.history.trigger) throw new TypeError("Custom History min-reclaim must not exceed its trigger");
}
function assertExactPolicyShape(value) {
	if (!isPlainRecord$1(value)) throw new TypeError("Custom must be a plain object");
	if (value.version !== 1 && value.version !== 2 && value.version !== 3) throw new TypeError("Custom version must be 1, 2, or 3");
	assertExactKeys(value, value.version === 1 ? [
		"version",
		"unit",
		"fresh",
		"aggregate",
		"history",
		"prefixPolicy"
	] : [
		"version",
		"unit",
		"fresh",
		"aggregate",
		"history",
		"prefixPolicy",
		"tailTrim"
	], "Custom");
	assertExactKeys(value.fresh, [
		"enabled",
		"trigger",
		"target"
	], "Custom Fresh");
	assertExactKeys(value.aggregate, [
		"enabled",
		"trigger",
		"target"
	], "Custom Aggregate");
	assertExactKeys(value.history, value.version === 3 ? [
		"enabled",
		"trigger",
		"keepRecentToolCalls",
		"keepRecentTokens",
		"minReclaim"
	] : [
		"enabled",
		"trigger",
		"keepRecentTurns",
		"keepRecent",
		"minReclaim"
	], "Custom History");
	if (value.version !== 1) assertExactKeys(value.tailTrim, ["enabled", "trigger"], "Custom TailTrim");
}
function assertExactKeys(value, allowed, label) {
	if (!isPlainRecord$1(value)) throw new TypeError(`${label} must be a plain object`);
	const allowedKeys = new Set(allowed);
	const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
	if (unknown !== void 0) throw new TypeError(`${label}: unknown key "${unknown}"`);
}
function isPlainRecord$1(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
function assertEffectiveRelations(policy) {
	if (policy.freshTargetTokens >= policy.freshTriggerTokens) throw new Error("Custom effective Fresh target must be below trigger");
	if (policy.aggregateTargetTokens >= policy.aggregateTriggerTokens) throw new Error("Custom effective Aggregate target must be below trigger");
	if (policy.historyMinReclaimTokens > policy.historyTriggerTokens) throw new Error("Custom effective History min-reclaim must not exceed its trigger");
}
//#endregion
//#region src/config.ts
/** Configuration resolution for the mixed deterministic context-compression selector. */
/** Settings namespace shared by the Host service and browser selector. */
const CONTEXT_COMPRESSION_SETTINGS_NAMESPACE = "context-compression";
/** Fixed native fallback marker. */
const PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";
/**
* The one Auto Compact threshold contract shared by the settings UI, the
* persisted settings schema, and the runtime resolver. Every integer in the
* range is valid and entered directly in the UI.
*/
const AUTO_COMPACT_THRESHOLD_LIMITS = deepFreeze({
	min: 50,
	max: 90,
	step: 1,
	default: 80
});
/** Narrow one untrusted value to a valid Auto Compact threshold percent. */
function isValidAutoCompactThresholdPercent(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= AUTO_COMPACT_THRESHOLD_LIMITS.min && value <= AUTO_COMPACT_THRESHOLD_LIMITS.max;
}
const AUTO_COMPACT_DEFAULT = deepFreeze({ thresholdPercent: AUTO_COMPACT_THRESHOLD_LIMITS.default });
/** Accept JSON-object records while rejecting class instances and exotic prototypes. */
function isPlainRecord(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
/** Reject exotic prototypes anywhere in the JSON-like settings tree. */
function assertPlainDataTree(value, seen = /* @__PURE__ */ new WeakSet()) {
	if (value === null || typeof value !== "object") return;
	if (seen.has(value)) return;
	seen.add(value);
	if (Array.isArray(value)) {
		for (const entry of value) assertPlainDataTree(entry, seen);
		return;
	}
	if (!isPlainRecord(value)) throw new TypeError("Context-compression settings must contain only plain objects");
	for (const entry of Object.values(value)) assertPlainDataTree(entry, seen);
}
/**
* Strictly parse the persisted autoCompact section. Schemastery object
* defaults silently absorb null, empty, and extra-key sections, so this stays
* hand-validated beside the top-level unknown-key check.
*/
function parseAutoCompactSettings(value) {
	if (value === void 0) return AUTO_COMPACT_DEFAULT;
	if (!isPlainRecord(value)) throw new TypeError("Context-compression autoCompact must be a plain object");
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "thresholdPercent") throw new TypeError(`Context-compression autoCompact: expected exactly "thresholdPercent", got "${keys.join("\", \"")}"`);
	const thresholdPercent = value.thresholdPercent;
	if (!isValidAutoCompactThresholdPercent(thresholdPercent)) throw new TypeError(`Context-compression autoCompact.thresholdPercent (${String(thresholdPercent)}) must be an integer between ${String(AUTO_COMPACT_THRESHOLD_LIMITS.min)} and ${String(AUTO_COMPACT_THRESHOLD_LIMITS.max)}`);
	return { thresholdPercent };
}
/**
* Strictly parse the persisted codeSkeleton section. The gate is orthogonal
* to every profile: absent inherits the lossless `false` default, while a
* present-but-invalid section is an explicitly invalid document.
*/
function parseCodeSkeletonSettings(value) {
	if (value === void 0) return { enabled: false };
	if (!isPlainRecord(value)) throw new TypeError("Context-compression codeSkeleton must be a plain object");
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "enabled") throw new TypeError(`Context-compression codeSkeleton: expected exactly "enabled", got "${keys.join("\", \"")}"`);
	const enabled = value.enabled;
	if (typeof enabled !== "boolean") throw new TypeError("Context-compression codeSkeleton.enabled must be a boolean");
	return { enabled };
}
/**
* Parse the optional tokenpilot-inspired preset sub-capability section. Absent
* inherits the preset defaults; present-but-invalid is rejected, mirroring the
* codeSkeleton section semantics.
*/
function parsePresetOptionsSettings(value) {
	if (value === void 0) return void 0;
	if (!isPlainRecord(value)) throw new TypeError("Context-compression presetOptions must be a plain object");
	const allowed = /* @__PURE__ */ new Set([
		"dedupeToolResults",
		"summaryLocator",
		"prefixStabilizer",
		"readState",
		"estimatorMode",
		"estimatorProvider",
		"estimatorModel",
		"estimatorBaseUrl",
		"estimatorApiKey",
		"estimatorTimeoutMs"
	]);
	const unknown = Object.keys(value).find((key) => !allowed.has(key));
	if (unknown !== void 0) throw new TypeError(`Context-compression presetOptions: unknown key "${unknown}"`);
	for (const key of [
		"dedupeToolResults",
		"summaryLocator",
		"prefixStabilizer",
		"readState"
	]) {
		const entry = value[key];
		if (entry !== void 0 && typeof entry !== "boolean") throw new TypeError(`Context-compression presetOptions.${key} must be a boolean`);
	}
	const estimatorMode = value.estimatorMode;
	if (estimatorMode !== void 0 && estimatorMode !== "" && estimatorMode !== "host" && estimatorMode !== "direct") throw new TypeError("Context-compression presetOptions.estimatorMode must be \"\", \"host\", or \"direct\"");
	const estimatorTimeoutMs = value.estimatorTimeoutMs;
	if (estimatorTimeoutMs !== void 0 && (typeof estimatorTimeoutMs !== "number" || !Number.isSafeInteger(estimatorTimeoutMs) || estimatorTimeoutMs < 100 || estimatorTimeoutMs > 6e4)) throw new TypeError("Context-compression presetOptions.estimatorTimeoutMs must be an integer between 100 and 60000");
	for (const key of [
		"estimatorProvider",
		"estimatorModel",
		"estimatorBaseUrl",
		"estimatorApiKey"
	]) {
		const entry = value[key];
		if (entry !== void 0 && typeof entry !== "string") throw new TypeError(`Context-compression presetOptions.${key} must be a string`);
	}
	const result = {};
	if (value.dedupeToolResults !== void 0) result.dedupeToolResults = value.dedupeToolResults;
	if (value.summaryLocator !== void 0) result.summaryLocator = value.summaryLocator;
	if (value.prefixStabilizer !== void 0) result.prefixStabilizer = value.prefixStabilizer;
	if (value.readState !== void 0) result.readState = value.readState;
	if (estimatorMode !== void 0) result.estimatorMode = estimatorMode;
	if (value.estimatorProvider !== void 0) result.estimatorProvider = value.estimatorProvider;
	if (value.estimatorModel !== void 0) result.estimatorModel = value.estimatorModel;
	if (value.estimatorBaseUrl !== void 0) result.estimatorBaseUrl = value.estimatorBaseUrl;
	if (value.estimatorApiKey !== void 0) result.estimatorApiKey = value.estimatorApiKey;
	if (estimatorTimeoutMs !== void 0) result.estimatorTimeoutMs = estimatorTimeoutMs;
	return result;
}
/** Settings schema used by the user-facing profile selector. */
const contextCompressionSettingsInputSchema = z.object({
	profile: z.union([...COMPRESSION_PROFILES]).default("balanced"),
	custom: CustomCompressionPolicySchema.default(DEFAULT_CUSTOM_COMPRESSION_POLICY)
});
/**
* Reject a section that is PRESENT but not a usable value. Schemastery
* `.default(...)` silently substitutes null and undefined, which would turn a
* hand-corrupted store into the (lossy) default policy; only genuinely absent
* keys may inherit defaults, and that distinction must be made before any
* default can fire.
*/
function assertPresentSection(candidate, key, valid) {
	if (!Object.hasOwn(candidate, key)) return;
	if (!valid(candidate[key])) throw new TypeError(`Context-compression settings: "${key}" is present but invalid (${String(candidate[key])})`);
}
const isSupportedProfile = (value) => typeof value === "string" && COMPRESSION_PROFILES.includes(value);
const isUsableCustomDocument = (value) => isPlainRecord(value);
const DEFAULT_CONTEXT_COMPRESSION_SETTINGS = {
	profile: "balanced",
	custom: structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY),
	autoCompact: { thresholdPercent: AUTO_COMPACT_THRESHOLD_LIMITS.default },
	codeSkeleton: { enabled: false }
};
/**
* Parse one settings document with the persisted-section semantics: `undefined`
* inherits the defaults (an absent section), while `null` is an explicitly
* invalid document and must never silently become the default policy.
*/
function parseContextCompressionSettings(value) {
	if (!isPlainRecord(value)) throw new TypeError("Context-compression settings must be a plain object");
	const keys = Object.keys(value);
	if (keys.length === 0 || !keys.includes("profile") || !keys.includes("custom")) throw new TypeError("Context-compression settings document is missing its complete shape");
	return ContextCompressionSettingsSchema(value);
}
/** Settings schema used by the user-facing profile selector. */
const ContextCompressionSettingsSchema = z.transform(z.any().required(), (value) => {
	if (!isPlainRecord(value)) throw new TypeError("Context-compression settings must be a plain object");
	assertPlainDataTree(value);
	const candidate = structuredClone(value);
	const unknown = Object.keys(candidate).find((key) => key !== "profile" && key !== "custom" && key !== "autoCompact" && key !== "codeSkeleton" && key !== "presetOptions");
	if (unknown !== void 0) throw new TypeError(`Context-compression settings: unknown key "${unknown}"`);
	assertPresentSection(candidate, "profile", isSupportedProfile);
	assertPresentSection(candidate, "custom", isUsableCustomDocument);
	const autoCompact = parseAutoCompactSettings(candidate.autoCompact);
	const codeSkeleton = parseCodeSkeletonSettings(candidate.codeSkeleton);
	const presetOptions = parsePresetOptionsSettings(candidate.presetOptions);
	return {
		...contextCompressionSettingsInputSchema(candidate),
		autoCompact,
		codeSkeleton,
		...presetOptions === void 0 ? {} : { presetOptions }
	};
}).default(DEFAULT_CONTEXT_COMPRESSION_SETTINGS);
/** Low-friction defaults; token budgets live in resolved profile policy. */
const DEFAULTS = deepFreeze({
	profile: "balanced",
	headChars: 4096,
	tailChars: 1024
});
const CONFIG_KEYS = /* @__PURE__ */ new Set([
	"profile",
	"headChars",
	"tailChars",
	"nativeTriggerTokens",
	"nativeTargetTokens",
	"freshTriggerTokens",
	"freshTargetTokens",
	"aggregateTriggerTokens",
	"aggregateTargetTokens",
	"historyTriggerTokens",
	"historyKeepRecentToolCalls",
	"historyKeepRecentTokens",
	"historyMinReclaimTokens",
	"autoCompactThresholdPercent",
	"presetOptions"
]);
const LEGACY_GATE_REPLACEMENTS = Object.freeze({
	thresholdChars: "nativeTriggerTokens",
	freshThresholdChars: "freshTriggerTokens",
	freshTargetChars: "freshTargetTokens",
	freshBatchTriggerChars: "aggregateTriggerTokens",
	freshBatchTargetChars: "aggregateTargetTokens",
	historyTriggerChars: "historyTriggerTokens",
	historyKeepRecentChars: "historyKeepRecentTokens",
	historyMinReclaimChars: "historyMinReclaimTokens",
	historyKeepRecentTurns: "historyKeepRecentToolCalls"
});
/**
* Count Unicode code points without splitting surrogate pairs.
* @param text - text whose code points are counted.
* @returns the number of Unicode code points.
*/
function codePointLength(text) {
	let length = 0;
	for (const _point of text) length++;
	return length;
}
/**
* Test whether a settings value names a supported compression profile.
* @param value - untrusted settings value.
* @returns whether the value is a supported compression profile.
*/
function isCompressionProfile(value) {
	return typeof value === "string" && COMPRESSION_PROFILES.includes(value);
}
/**
* Resolve and validate plugin configuration.
* @param config - optional composition overrides.
* @returns a detached, deeply immutable configuration snapshot.
*/
function resolveConfig(config = {}) {
	for (const key of Object.keys(config)) {
		const replacement = LEGACY_GATE_REPLACEMENTS[key];
		if (replacement !== void 0) throw new Error(`ToolResultPruneConfig: legacy gate "${key}" is no longer accepted; choose "${replacement}" manually in tokens (no character conversion is applied)`);
		if (!CONFIG_KEYS.has(key)) throw new Error(`ToolResultPruneConfig: unknown key "${key}"`);
	}
	const resolved = {
		profile: config.profile ?? DEFAULTS.profile,
		headChars: config.headChars ?? DEFAULTS.headChars,
		tailChars: config.tailChars ?? DEFAULTS.tailChars,
		...config.nativeTriggerTokens === void 0 ? {} : { nativeTriggerTokens: config.nativeTriggerTokens },
		...config.nativeTargetTokens === void 0 ? {} : { nativeTargetTokens: config.nativeTargetTokens },
		...config.freshTriggerTokens === void 0 ? {} : { freshTriggerTokens: config.freshTriggerTokens },
		...config.freshTargetTokens === void 0 ? {} : { freshTargetTokens: config.freshTargetTokens },
		...config.aggregateTriggerTokens === void 0 ? {} : { aggregateTriggerTokens: config.aggregateTriggerTokens },
		...config.aggregateTargetTokens === void 0 ? {} : { aggregateTargetTokens: config.aggregateTargetTokens },
		...config.historyTriggerTokens === void 0 ? {} : { historyTriggerTokens: config.historyTriggerTokens },
		...config.historyKeepRecentToolCalls === void 0 ? {} : { historyKeepRecentToolCalls: config.historyKeepRecentToolCalls },
		...config.historyKeepRecentTokens === void 0 ? {} : { historyKeepRecentTokens: config.historyKeepRecentTokens },
		...config.historyMinReclaimTokens === void 0 ? {} : { historyMinReclaimTokens: config.historyMinReclaimTokens },
		...config.autoCompactThresholdPercent === void 0 ? {} : { autoCompactThresholdPercent: config.autoCompactThresholdPercent },
		...config.presetOptions === void 0 ? {} : { presetOptions: config.presetOptions }
	};
	if (!isCompressionProfile(resolved.profile)) throw new Error(`ToolResultPruneConfig: unsupported profile "${String(resolved.profile)}"`);
	assertNonNegativeInteger("headChars", resolved.headChars);
	assertNonNegativeInteger("tailChars", resolved.tailChars);
	for (const key of [
		"nativeTriggerTokens",
		"nativeTargetTokens",
		"freshTriggerTokens",
		"freshTargetTokens",
		"aggregateTriggerTokens",
		"aggregateTargetTokens",
		"historyTriggerTokens",
		"historyMinReclaimTokens"
	]) {
		const value = resolved[key];
		if (value !== void 0) assertPositiveInteger(key, value);
	}
	if (resolved.historyKeepRecentToolCalls !== void 0) assertNonNegativeInteger("historyKeepRecentToolCalls", resolved.historyKeepRecentToolCalls);
	if (resolved.historyKeepRecentTokens !== void 0) assertNonNegativeInteger("historyKeepRecentTokens", resolved.historyKeepRecentTokens);
	if (resolved.autoCompactThresholdPercent !== void 0 && !isValidAutoCompactThresholdPercent(resolved.autoCompactThresholdPercent)) throw new Error(`ToolResultPruneConfig: autoCompactThresholdPercent (${String(resolved.autoCompactThresholdPercent)}) must be an integer between ${String(AUTO_COMPACT_THRESHOLD_LIMITS.min)} and ${String(AUTO_COMPACT_THRESHOLD_LIMITS.max)}`);
	assertTargetBelowTrigger("native", resolved.nativeTargetTokens, resolved.nativeTriggerTokens);
	assertTargetBelowTrigger("fresh", resolved.freshTargetTokens, resolved.freshTriggerTokens);
	assertTargetBelowTrigger("aggregate", resolved.aggregateTargetTokens, resolved.aggregateTriggerTokens);
	return deepFreeze(structuredClone(resolved));
}
/** Per-profile History linkage ratios applied to the Auto Compact watermark. */
const AUTO_COMPACT_HISTORY_RATIOS = Object.freeze({
	balanced: Object.freeze({
		trigger: .625,
		minReclaim: .12,
		keepRecentTokens: .08
	}),
	savings: Object.freeze({
		trigger: .5,
		minReclaim: .16,
		keepRecentTokens: .08
	}),
	"cache-strict": Object.freeze({
		trigger: .75,
		minReclaim: .16,
		keepRecentTokens: .08
	}),
	adaptive: Object.freeze({
		trigger: .625,
		minReclaim: .12,
		keepRecentTokens: .08
	}),
	"tokenpilot-inspired": Object.freeze({
		trigger: .625,
		minReclaim: .12,
		keepRecentTokens: .08
	})
});
/** Micro-compact last-chance ratio: `D = floor(A × 0.875)`. */
const MICRO_DEADLINE_RATIO = .875;
/**
* TokenPilot-inspired sub-capability defaults. Every capability is on except
* the estimator, which requires an explicit endpoint channel (host or direct)
* before any consumer may leave its rule-only fallback.
*/
const PRESET_OPTION_DEFAULTS = deepFreeze({
	noNetSavingsGuard: true,
	skipReductionRecovery: true,
	dedupeToolResults: true,
	summaryLocator: true,
	prefixStabilizer: true,
	readState: true,
	estimator: { mode: "" }
});
/**
* Merge persisted presetOptions overrides over the tokenpilot-inspired
* defaults. Persisted booleans are three-state (undefined = inherit); the
* estimator channel overrides the default empty mode wholesale.
*/
function mergePresetOptions(overrides) {
	if (overrides === void 0) return PRESET_OPTION_DEFAULTS;
	return deepFreeze({
		noNetSavingsGuard: true,
		skipReductionRecovery: true,
		dedupeToolResults: overrides.dedupeToolResults ?? PRESET_OPTION_DEFAULTS.dedupeToolResults,
		summaryLocator: overrides.summaryLocator ?? PRESET_OPTION_DEFAULTS.summaryLocator,
		prefixStabilizer: overrides.prefixStabilizer ?? PRESET_OPTION_DEFAULTS.prefixStabilizer,
		readState: overrides.readState ?? PRESET_OPTION_DEFAULTS.readState,
		estimator: { mode: overrides.estimatorMode ?? PRESET_OPTION_DEFAULTS.estimator.mode }
	});
}
/**
* Resolve the Auto-Compact-linked History watermarks for one standard profile.
*
* `A = floor(C × a)` is the Auto Compact token watermark for the routed
* context window `C` and the user threshold `a = p / 100`; the History
* trigger, minimum reclaim, and recent-token tail scale with `A`, and the
* micro-compact last-chance deadline is `D = floor(A × 0.875)`. At the shipped
* defaults (`C = 1,000,000`, `p = 80`) the ratios reproduce the previous fixed
* preset numbers exactly. Custom stays manual and Off/Native run no History,
* so none of them link.
*/
function resolveAutoCompactLinkage(profile, options) {
	const ratios = profile === "custom" ? void 0 : AUTO_COMPACT_HISTORY_RATIOS[profile];
	const contextWindow = options.contextWindowTokens;
	const threshold = options.autoCompactThresholdPercent;
	if (ratios === void 0) return void 0;
	if (!isValidAutoCompactThresholdPercent(threshold)) return void 0;
	if (!Number.isSafeInteger(contextWindow) || contextWindow === void 0 || contextWindow <= 0) return void 0;
	const autoCompactTokens = Math.floor(contextWindow * (threshold / 100));
	if (!Number.isSafeInteger(autoCompactTokens) || autoCompactTokens <= 0) return void 0;
	const linked = {
		autoCompactTokens,
		microDeadlineTokens: Math.floor(autoCompactTokens * MICRO_DEADLINE_RATIO),
		historyTriggerTokens: Math.floor(ratios.trigger * autoCompactTokens),
		historyMinReclaimTokens: Math.floor(ratios.minReclaim * autoCompactTokens),
		historyKeepRecentTokens: Math.floor(ratios.keepRecentTokens * autoCompactTokens)
	};
	for (const value of Object.values(linked)) if (!Number.isSafeInteger(value) || value <= 0) return void 0;
	return linked;
}
/**
* Resolve one public profile into a complete mixed-strategy policy.
* @param config - validated composition configuration.
* @param profile - profile frozen for the target Session.
* @param custom - versioned Custom document used only by the `custom` profile.
* @param options - routed capacity and the frozen Auto Compact threshold used
* to resolve context-percent Custom values and standard-profile linkage.
* @returns the effective deterministic compression policy.
*/
function resolvePolicy(config, profile, custom = DEFAULT_CUSTOM_COMPRESSION_POLICY, options = {}) {
	if (profile === "custom") return resolveCustomPolicy(custom, options);
	const preset = {
		off: {
			nativeToolResultEnabled: false,
			freshEnabled: false,
			aggregateEnabled: false,
			historyMode: "disabled",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: Number.MAX_SAFE_INTEGER,
			freshTargetTokens: Number.MAX_SAFE_INTEGER,
			aggregateTriggerTokens: Number.MAX_SAFE_INTEGER,
			aggregateTargetTokens: Number.MAX_SAFE_INTEGER,
			historyTriggerTokens: Number.MAX_SAFE_INTEGER,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: Number.MAX_SAFE_INTEGER
		},
		native: {
			nativeToolResultEnabled: true,
			freshEnabled: false,
			aggregateEnabled: false,
			historyMode: "disabled",
			nativeTriggerTokens: 4096,
			nativeTargetTokens: 2048,
			freshTriggerTokens: Number.MAX_SAFE_INTEGER,
			freshTargetTokens: Number.MAX_SAFE_INTEGER,
			aggregateTriggerTokens: Number.MAX_SAFE_INTEGER,
			aggregateTargetTokens: Number.MAX_SAFE_INTEGER,
			historyTriggerTokens: Number.MAX_SAFE_INTEGER,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: Number.MAX_SAFE_INTEGER
		},
		balanced: {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "routine",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 8192,
			freshTargetTokens: 3072,
			aggregateTriggerTokens: 32768,
			aggregateTargetTokens: 12288,
			historyTriggerTokens: 5e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 96e3
		},
		"cache-strict": {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "capacity-pressure",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 8192,
			freshTargetTokens: 3072,
			aggregateTriggerTokens: 32768,
			aggregateTargetTokens: 12288,
			historyTriggerTokens: 6e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 128e3
		},
		savings: {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "routine",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 4096,
			freshTargetTokens: 1536,
			aggregateTriggerTokens: 16384,
			aggregateTargetTokens: 4096,
			historyTriggerTokens: 4e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 128e3
		},
		adaptive: {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "adaptive",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 8192,
			freshTargetTokens: 3072,
			aggregateTriggerTokens: 32768,
			aggregateTargetTokens: 12288,
			historyTriggerTokens: 5e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 96e3
		},
		"tokenpilot-inspired": {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "routine",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 8192,
			freshTargetTokens: 3072,
			aggregateTriggerTokens: 32768,
			aggregateTargetTokens: 12288,
			historyTriggerTokens: 5e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 96e3
		}
	}[profile];
	const linkage = resolveAutoCompactLinkage(profile, options);
	const policy = {
		profile,
		...preset,
		nativeTriggerTokens: config.nativeTriggerTokens ?? preset.nativeTriggerTokens,
		nativeTargetTokens: config.nativeTargetTokens ?? preset.nativeTargetTokens,
		freshTriggerTokens: config.freshTriggerTokens ?? preset.freshTriggerTokens,
		freshTargetTokens: config.freshTargetTokens ?? preset.freshTargetTokens,
		aggregateTriggerTokens: config.aggregateTriggerTokens ?? preset.aggregateTriggerTokens,
		aggregateTargetTokens: config.aggregateTargetTokens ?? preset.aggregateTargetTokens,
		historyTriggerTokens: config.historyTriggerTokens ?? linkage?.historyTriggerTokens ?? preset.historyTriggerTokens,
		historyKeepRecentToolCalls: config.historyKeepRecentToolCalls ?? preset.historyKeepRecentToolCalls,
		historyKeepRecentTokens: config.historyKeepRecentTokens ?? linkage?.historyKeepRecentTokens ?? preset.historyKeepRecentTokens,
		historyMinReclaimTokens: config.historyMinReclaimTokens ?? linkage?.historyMinReclaimTokens ?? preset.historyMinReclaimTokens,
		...linkage === void 0 ? {} : {
			autoCompactTokens: linkage.autoCompactTokens,
			microDeadlineTokens: linkage.microDeadlineTokens
		},
		...profile === "tokenpilot-inspired" ? { presetOptions: mergePresetOptions(config.presetOptions) } : {}
	};
	if (policy.nativeTargetTokens >= policy.nativeTriggerTokens && profile === "native") throw new Error("context compression policy: native target must be below trigger");
	if (policy.freshTargetTokens >= policy.freshTriggerTokens && policy.freshEnabled) throw new Error("context compression policy: fresh target must be below trigger");
	if (policy.aggregateTargetTokens >= policy.aggregateTriggerTokens && policy.freshEnabled) throw new Error("context compression policy: aggregate target must be below trigger");
	return deepFreeze(policy);
}
function assertTargetBelowTrigger(label, target, trigger) {
	if (target === void 0 !== (trigger === void 0)) throw new Error(`ToolResultPruneConfig: ${label} target and trigger tokens must be provided together`);
	if (target !== void 0 && trigger !== void 0 && target >= trigger) throw new Error(`ToolResultPruneConfig: ${label} target tokens must be below trigger tokens`);
}
function assertPositiveInteger(name, value) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`ToolResultPruneConfig: ${name} (${String(value)}) must be a positive safe integer`);
}
function assertNonNegativeInteger(name, value) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`ToolResultPruneConfig: ${name} (${String(value)}) must be a non-negative safe integer`);
}
//#endregion
//#region src/reducers.ts
/** Deterministic, evidence-backed reducers for fresh tool results. */
const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu;
const IMPORTANT_PATTERN = new RegExp([
	String.raw`\b(?:error|failed|failure|fatal|panic|exception|warning|warn|conflict|denied|forbidden|`,
	String.raw`timeout|timed out|not found|cannot|unable|invalid|exit(?:ed)?\s+(?:code|status)|traceback|`,
	String.raw`assert(?:ion)?|segmentation fault|oom|out of memory)\b`
].join(""), "i");
const STATUS_PATTERN = new RegExp([String.raw`\b(?:success|succeeded|passed|installed|added|removed|updated|built|compiled|`, String.raw`tests?\s+(?:passed|failed)|exit(?:ed)?\s+(?:code|status))\b`].join(""), "i");
const PATH_LINE_PATTERN = /^(.*?):(\d+)(?::\d+)?(?::|\s+-\s+)(.*)$/;
const GIT_STATUS_PATTERN = new RegExp([String.raw`^(?:On branch|Your branch|HEAD detached|Changes |Untracked |Unmerged |\s*(?:modified|deleted|`, String.raw`new file|renamed|both modified):)`].join(""), "i");
const CODE_IMPORT_PATTERN = new RegExp([String.raw`^\s*(?:import\b|from\s+[\w.]+\s+import\b|use\s+\w|package\s+|#include\b|`, String.raw`using\s+[\w.]+;|require\s*\(|extern\s+crate\b)`].join(""));
const CODE_STRUCTURE_PATTERN = new RegExp([
	String.raw`^\s*(?:@[\w.]+|export\s+|default\s+|declare\s+|abstract\s+|public\s+|private\s+|protected\s+|`,
	String.raw`internal\s+|static\s+|final\s+|sealed\s+|override\s+|pub(?:\([^)]*\))?\s+|async\s+|unsafe\s+)*`,
	String.raw`(?:function\b|class\b|interface\b|enum\b|struct\b|impl\b|trait\b|type\s+\w|fn\s|func\b|`,
	String.raw`def\s|module\b|namespace\b|sub\s)`
].join(""));
const PYTHON_STRUCTURE_PATTERN = /^\s*(?:async\s+)?def\s|^\s*class\s/;
const CODE_DECORATOR_PATTERN = /^\s*@[\w.]+/;
const CODE_COMMENT_PATTERN = /^\s*(?:\/\/|#|\/\*|\*)/;
/**
* Select a reducer from verified tool, command, and content evidence.
* @param input - original result text, recovery source, and output budget.
* @returns a verified candidate, or `null` when every reducer fails open.
*/
function reduceFreshToolResult(input) {
	const normalized = normalizeTerminalText(input.text);
	const prepared = {
		...input,
		text: normalized
	};
	const command = extractCommand(input.argumentsText);
	const name = input.toolName.toLowerCase();
	const candidates = [];
	if (looksLikeJson(normalized)) candidates.push(() => reduceJson(prepared));
	if (isSearchTool(name, command)) candidates.push(() => reduceSearch(prepared));
	if (isGitCommand(name, command)) candidates.push(() => reduceGit(prepared, command));
	if (isPackageCommand(command)) candidates.push(() => reducePatternLog(prepared, "hypa-package", packagePattern()));
	if (isBuildOrTestCommand(command)) candidates.push(() => reducePatternLog(prepared, "hypa-build-test", buildPattern()));
	if (input.codeSkeleton === true && looksLikeSourceCode(normalized)) candidates.push(() => reduceCodeSkeleton(prepared));
	if (isReadTool(name)) candidates.push(() => reduceHead(prepared, "pi-head"));
	if (isShellTool(name) || command !== "") candidates.push(() => reduceShell(prepared));
	candidates.push(() => reduceSalient(prepared, "generic-salience"));
	for (const make of candidates) {
		const candidate = make();
		if (candidate !== null && verifyReduction(input, candidate)) return candidate;
	}
	return null;
}
/**
* Build a recoverable placeholder for an old tool result.
* @param input - tool identity, source reference, size, status, and retained evidence.
* @returns a lossy placeholder that cites the immutable source event.
*/
function historicalPlaceholder(input) {
	const anchor = input.compact ? "" : importantAnchor(input.text, 360);
	const lines = [
		"[Old tool result content cleared from active context]",
		`tool: ${input.toolName || "unknown"}`,
		`status: ${input.isError ? "error" : "completed"}`,
		`original_chars: ${String(input.charsBefore)}`,
		`source: ${input.sourceRef}`,
		"retrieve: context_compression_retrieve({\"ref\":\"" + input.sourceRef + "\"})"
	];
	if (anchor !== "") lines.push(`retained_anchor: ${anchor}`);
	return {
		text: lines.join("\n"),
		reducer: input.compact ? "pair-preserving-tail-aging" : "historical-tool-result-aging",
		lossy: true
	};
}
/**
* Validate shrinkage, budget, recovery, and error retention.
* @param input - original reducer input and its safety requirements.
* @param output - candidate reduced text and reducer metadata.
* @returns whether the candidate is safe to land.
*/
function verifyReduction(input, output) {
	const before = codePointLength(input.text);
	const after = codePointLength(output.text);
	if (after <= 0 || after >= before || after > input.budgetChars) return false;
	if (output.lossy && !output.text.includes(input.sourceRef)) return false;
	if ((input.isError || IMPORTANT_PATTERN.test(input.text)) && !IMPORTANT_PATTERN.test(output.text) && !output.text.includes("status: error")) return false;
	return true;
}
/**
* Strip ANSI, collapse carriage-return progress redraws, and fold exact repeats.
* @param text - raw terminal output.
* @returns normalized terminal text.
*/
function normalizeTerminalText(text) {
	const logical = text.replace(ANSI_PATTERN, "").split("\n").map((line) => {
		return line.split("\r").filter((part) => part !== "").at(-1) ?? "";
	});
	const folded = [];
	let previous;
	let count = 0;
	const flush = () => {
		if (previous === void 0) return;
		folded.push(previous);
		if (count > 1) folded.push(`[previous line repeated ${String(count - 1)} more times]`);
	};
	for (const line of logical) {
		if (line === previous) {
			count++;
			continue;
		}
		flush();
		previous = line;
		count = 1;
	}
	flush();
	return folded.join("\n");
}
function reduceHead(input, reducer) {
	const marker = omissionMarker(input, reducer);
	const available = input.budgetChars - codePointLength(marker) - 1;
	if (available <= 0) return null;
	const head = takeWholeLinesFromHead(input.text, available);
	if (head === input.text || head === "") return null;
	return {
		text: `${head}\n${marker}`,
		reducer,
		lossy: true
	};
}
function reduceTail(input, reducer) {
	const marker = omissionMarker(input, reducer);
	const available = input.budgetChars - codePointLength(marker) - 1;
	if (available <= 0) return null;
	const tail = takeWholeLinesFromTail(input.text, available);
	if (tail === input.text || tail === "") return null;
	return {
		text: `${marker}\n${tail}`,
		reducer,
		lossy: true
	};
}
function reduceJson(input) {
	let value;
	try {
		value = JSON.parse(input.text);
	} catch {
		return null;
	}
	const minified = JSON.stringify(value);
	if (codePointLength(minified) < codePointLength(input.text) && codePointLength(minified) <= input.budgetChars) return {
		text: minified,
		reducer: "json-minify",
		lossy: false
	};
	const envelope = {
		$dsh_compression: {
			kind: "json-preview",
			source: input.sourceRef,
			original_chars: codePointLength(input.text)
		},
		value: shrinkJson(value, 0)
	};
	const text = JSON.stringify(envelope, null, 2);
	if (codePointLength(text) <= input.budgetChars) return {
		text,
		reducer: "json-structure-preview",
		lossy: true
	};
	return null;
}
function shrinkJson(value, depth) {
	if (depth >= 5) {
		if (Array.isArray(value)) return `[array length=${String(value.length)} omitted]`;
		if (typeof value === "object" && value !== null) return "[object omitted]";
		return value;
	}
	if (Array.isArray(value)) {
		if (value.length <= 8) return value.map((entry) => shrinkJson(entry, depth + 1));
		return [
			...value.slice(0, 3).map((entry) => shrinkJson(entry, depth + 1)),
			{ $dsh_omitted_items: value.length - 5 },
			...value.slice(-2).map((entry) => shrinkJson(entry, depth + 1))
		];
	}
	if (typeof value !== "object" || value === null) {
		if (typeof value === "string" && codePointLength(value) > 800) return `${Array.from(value).slice(0, 500).join("")}…[${String(codePointLength(value) - 700)} chars omitted]…${Array.from(value).slice(-200).join("")}`;
		return value;
	}
	const entries = Object.entries(value);
	const important = entries.filter(([key]) => /error|warn|status|code|message|path|file|line|summary/i.test(key));
	const selected = entries.length <= 18 ? entries : [
		...entries.slice(0, 10),
		...important.filter((entry) => !entries.slice(0, 10).includes(entry)).slice(0, 6),
		...entries.slice(-2)
	];
	const result = {};
	for (const [key, entry] of selected) result[key] = shrinkJson(entry, depth + 1);
	if (selected.length < entries.length) result.$dsh_omitted_keys = entries.length - selected.length;
	return result;
}
function reduceSearch(input) {
	const lines = splitLines(input.text);
	const groups = /* @__PURE__ */ new Map();
	const ungrouped = [];
	for (const line of lines) {
		const match = PATH_LINE_PATTERN.exec(line);
		const row = {
			line,
			important: IMPORTANT_PATTERN.test(line)
		};
		if (match === null) {
			ungrouped.push(row);
			continue;
		}
		const path = match[1] ?? "<unknown>";
		const bucket = groups.get(path) ?? [];
		bucket.push(row);
		groups.set(path, bucket);
	}
	if (groups.size === 0) return reduceSalient(input, "search-salience");
	const selected = [];
	let omitted = 0;
	for (const [path, rows] of groups) {
		const keep = /* @__PURE__ */ new Set([0, rows.length - 1]);
		rows.forEach((row, index) => {
			if (row.important) keep.add(index);
		});
		for (let index = 0; index < rows.length && keep.size < 5; index++) keep.add(index);
		const indexes = [...keep].filter((index) => index >= 0).sort((a, b) => a - b);
		selected.push(`## ${path} (${String(rows.length)} matches)`);
		for (const index of indexes) {
			const row = rows[index];
			if (row !== void 0) selected.push(row.line);
		}
		omitted += rows.length - indexes.length;
	}
	for (const row of ungrouped.filter((row) => row.important).slice(0, 12)) selected.push(row.line);
	const text = fitLines([`[search results compressed; ${String(omitted)} matches omitted; source: ${input.sourceRef}]`, ...selected], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer: "search-by-file",
		lossy: true
	};
}
function reduceGit(input, command) {
	const lines = splitLines(input.text);
	const lower = command.toLowerCase();
	let keep;
	let reducer;
	if (/\bgit\s+(?:diff|show)\b/.test(lower)) {
		reducer = "hypa-git-diff";
		keep = lines.filter((line) => /^(?:diff --git|index |--- |\+\+\+ |@@ |[+-](?![+-]))/.test(line) || IMPORTANT_PATTERN.test(line));
	} else if (/\bgit\s+(?:status|switch|checkout|merge|rebase|cherry-pick)\b/.test(lower)) {
		reducer = "hypa-git-status";
		keep = lines.filter((line) => GIT_STATUS_PATTERN.test(line) || IMPORTANT_PATTERN.test(line));
	} else {
		reducer = "hypa-git-log";
		keep = lines.filter((line) => /^(?:commit\s+[0-9a-f]+|Author:|Date:|[0-9a-f]{7,}\s)/i.test(line) || IMPORTANT_PATTERN.test(line));
	}
	if (keep.length === 0) return reduceSalient(input, reducer);
	const text = fitLines([
		`[git output compressed; source: ${input.sourceRef}]`,
		...keep,
		...lines.slice(-8)
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer,
		lossy: true
	};
}
function reducePatternLog(input, reducer, pattern) {
	const lines = splitLines(input.text);
	const important = lines.filter((line) => pattern.test(line) || IMPORTANT_PATTERN.test(line) || STATUS_PATTERN.test(line));
	const text = fitLines([
		`[command output compressed by ${reducer}; source: ${input.sourceRef}]`,
		...important,
		...lines.slice(-20)
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer,
		lossy: true
	};
}
function reduceShell(input) {
	const lines = splitLines(input.text);
	const important = lines.filter((line) => IMPORTANT_PATTERN.test(line));
	if (important.length === 0) return reduceTail(input, "pi-tail");
	const text = fitLines([
		`[shell/log output compressed; source: ${input.sourceRef}]`,
		...important,
		"--- final output ---",
		...lines.slice(-40)
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer: "shell-salience-tail",
		lossy: true
	};
}
function reduceSalient(input, reducer) {
	const lines = splitLines(input.text);
	if (lines.length < 3) return reduceHead(input, reducer);
	const marker = omissionMarker(input, reducer);
	const headBudget = Math.max(1, Math.floor((input.budgetChars - codePointLength(marker)) * .34));
	const tailBudget = headBudget;
	const head = takeWholeLinesFromHead(input.text, headBudget);
	const tail = takeWholeLinesFromTail(input.text, tailBudget);
	const text = fitLines([
		head,
		...lines.filter((line) => IMPORTANT_PATTERN.test(line) || STATUS_PATTERN.test(line)).slice(0, 24),
		marker,
		tail
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer,
		lossy: true
	};
}
/**
* Keep a source-file skeleton: imports, decorators, declaration signatures,
* comments at brace depth zero, and every error-signalling line, eliding the
* remaining bodies with counted markers. Covers brace languages (TS/JS, Rust,
* Go, Java, C family) and indent blocks (Python); unknown syntax fails open to
* the next candidate. Output is compressed evidence, not required to parse.
* @param input - original result text, recovery source, and output budget.
* @returns a verified candidate, or `null` when the text is not code-like.
*/
function reduceCodeSkeleton(input) {
	const lines = splitLines(input.text);
	const kept = [];
	let elided = 0;
	const flushElided = () => {
		if (elided > 0) kept.push(`[... ${String(elided)} lines elided ...]`);
		elided = 0;
	};
	let depth = 0;
	let index = 0;
	const elideBraceBody = () => {
		const startDepth = depth;
		index += 1;
		while (index < lines.length && depth > startDepth) {
			const body = lines[index];
			if (body === void 0) break;
			if (IMPORTANT_PATTERN.test(body)) {
				flushElided();
				kept.push(body);
			} else elided += 1;
			depth += braceDelta(body);
			index += 1;
		}
		flushElided();
	};
	const keepPythonSignature = (signatureLine) => {
		index += 1;
		if (/:\s*$/.test(signatureLine)) {
			elideIndentedBody(leadingIndent(signatureLine));
			return;
		}
		for (let guard = 0; guard < 6 && index < lines.length; guard += 1) {
			const next = lines[index];
			if (next === void 0) break;
			if (next.trim() !== "" && leadingIndent(next) <= leadingIndent(signatureLine)) break;
			flushElided();
			kept.push(next);
			index += 1;
			if (/:\s*$/.test(next)) {
				elideIndentedBody(leadingIndent(next));
				return;
			}
			if (next.trim() !== "" && !/[:,(]\s*$/.test(next)) break;
		}
	};
	const elideIndentedBody = (indent) => {
		while (index < lines.length) {
			const body = lines[index];
			if (body === void 0) break;
			if (body.trim() !== "" && leadingIndent(body) <= indent) break;
			if (IMPORTANT_PATTERN.test(body)) {
				flushElided();
				kept.push(body);
				index += 1;
				continue;
			}
			if (isCodeStructureLine(body) || CODE_DECORATOR_PATTERN.test(body)) {
				flushElided();
				kept.push(body);
				keepPythonSignature(body);
				continue;
			}
			elided += 1;
			index += 1;
		}
		flushElided();
	};
	while (index < lines.length) {
		const line = lines[index];
		if (line === void 0) break;
		const delta = braceDelta(line);
		if (IMPORTANT_PATTERN.test(line)) {
			flushElided();
			kept.push(line);
			depth += delta;
			index += 1;
			continue;
		}
		if (isCodeStructureLine(line) || CODE_IMPORT_PATTERN.test(line) || CODE_DECORATOR_PATTERN.test(line)) {
			flushElided();
			kept.push(line);
			depth += delta;
			if (delta > 0) {
				elideBraceBody();
				continue;
			}
			if (PYTHON_STRUCTURE_PATTERN.test(line)) {
				keepPythonSignature(line);
				continue;
			}
			let opened = false;
			for (let guard = 0; guard < 6 && index + 1 < lines.length; guard += 1) {
				const next = lines[index + 1];
				if (next === void 0) break;
				const nextDelta = braceDelta(next);
				if (nextDelta === 0 && next.trim() !== "" && !/[:,(]\s*$/.test(next)) break;
				flushElided();
				kept.push(next);
				depth += nextDelta;
				index += 1;
				if (nextDelta > 0) {
					opened = true;
					break;
				}
			}
			if (opened) elideBraceBody();
			else index += 1;
			continue;
		}
		if (depth === 0 && CODE_COMMENT_PATTERN.test(line)) {
			flushElided();
			kept.push(line);
		} else elided += 1;
		depth += delta;
		index += 1;
	}
	flushElided();
	return finishSkeleton(kept, lines, input);
}
function finishSkeleton(kept, lines, input) {
	const text = fitLines([
		`[code output compressed by hypa-code-skeleton; source: ${input.sourceRef}]`,
		...kept,
		...lines.slice(-4)
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer: "hypa-code-skeleton",
		lossy: true
	};
}
/** Net brace delta of one line, ignoring braces inside string literals. */
function braceDelta(line) {
	let delta = 0;
	let quote = null;
	for (let position = 0; position < line.length; position += 1) {
		const char = line[position];
		if (quote !== null) {
			if (char === "\\") position += 1;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === "\"" || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "{") delta += 1;
		else if (char === "}") delta -= 1;
	}
	return delta;
}
function leadingIndent(line) {
	return codePointLength(line) - codePointLength(line.trimStart());
}
function isCodeStructureLine(line) {
	return CODE_STRUCTURE_PATTERN.test(line) || PYTHON_STRUCTURE_PATTERN.test(line);
}
/**
* Require content evidence of source code: enough declaration, import, or
* decorator lines among a bounded prefix. Failing this keeps prose, logs, and
* data on their existing reducers.
* @param text - normalized result text.
* @returns whether the text qualifies as source code.
*/
function looksLikeSourceCode(text) {
	const lines = splitLines(text);
	if (lines.length < 12) return false;
	let evidence = 0;
	for (const line of lines.slice(0, 400)) if (isCodeStructureLine(line) || CODE_IMPORT_PATTERN.test(line) || CODE_DECORATOR_PATTERN.test(line)) {
		evidence += 1;
		if (evidence >= 3) return true;
	}
	return false;
}
function omissionMarker(input, reducer) {
	return `[... ${reducer} omitted content; original_chars=${String(codePointLength(input.text))}; source=${input.sourceRef}; retrieve with context_compression_retrieve ...]`;
}
function importantAnchor(text, maxChars) {
	const lines = splitLines(normalizeTerminalText(text));
	const chosen = lines.find((line) => IMPORTANT_PATTERN.test(line)) ?? lines.at(-1) ?? "";
	return Array.from(chosen.trim()).slice(0, maxChars).join("");
}
function fitLines(lines, budgetChars, requiredRef) {
	const unique = [];
	const seen = /* @__PURE__ */ new Set();
	for (const line of lines) {
		if (line === "" || seen.has(line)) continue;
		seen.add(line);
		unique.push(line);
	}
	const output = [];
	let used = 0;
	for (const line of unique) {
		const cost = codePointLength(line) + (output.length === 0 ? 0 : 1);
		if (used + cost > budgetChars) continue;
		output.push(line);
		used += cost;
	}
	const text = output.join("\n");
	return text.includes(requiredRef) ? text : null;
}
function takeWholeLinesFromHead(text, budgetChars) {
	const output = [];
	let used = 0;
	for (const line of splitLines(text)) {
		const cost = codePointLength(line) + (output.length === 0 ? 0 : 1);
		if (used + cost > budgetChars) break;
		output.push(line);
		used += cost;
	}
	if (output.length === 0) return Array.from(text).slice(0, budgetChars).join("");
	return output.join("\n");
}
function takeWholeLinesFromTail(text, budgetChars) {
	const lines = splitLines(text);
	const output = [];
	let used = 0;
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index];
		if (line === void 0) continue;
		const cost = codePointLength(line) + (output.length === 0 ? 0 : 1);
		if (used + cost > budgetChars) break;
		output.unshift(line);
		used += cost;
	}
	if (output.length === 0) return Array.from(text).slice(-budgetChars).join("");
	return output.join("\n");
}
function splitLines(text) {
	const lines = text.split("\n");
	if (text.endsWith("\n")) lines.pop();
	return lines;
}
function extractCommand(argumentsText) {
	try {
		const parsed = JSON.parse(argumentsText);
		if (typeof parsed !== "object" || parsed === null) return "";
		const record = parsed;
		for (const key of [
			"command",
			"cmd",
			"script",
			"input"
		]) {
			const value = record[key];
			if (typeof value === "string") return value;
		}
	} catch {
		return "";
	}
	return "";
}
function looksLikeJson(text) {
	const trimmed = text.trim();
	return trimmed.startsWith("{") && trimmed.endsWith("}") || trimmed.startsWith("[") && trimmed.endsWith("]");
}
function isReadTool(name) {
	return /(?:^|[-_/])(?:read|cat|view|open_file)(?:$|[-_/])/.test(name);
}
function isSearchTool(name, command) {
	return /(?:grep|search|glob|find|ripgrep|rg)/.test(name) || /(?:^|\s)(?:rg|grep|find|fd)\s/.test(command);
}
function isShellTool(name) {
	return /(?:bash|shell|terminal|powershell|pwsh|exec|command)/.test(name);
}
function isGitCommand(name, command) {
	return name.includes("git") || /(?:^|\s)git\s/.test(command);
}
function isPackageCommand(command) {
	return /(?:^|\s)(?:npm|pnpm|yarn|bun|pip|pip3|uv|poetry)\s/.test(command);
}
function isBuildOrTestCommand(command) {
	return new RegExp([String.raw`(?:^|\s)(?:tsc|dotnet\s+(?:build|test)|pytest|cargo\s+(?:build|test|check)|go\s+test|mvn\s+test|`, String.raw`gradle|npm\s+(?:test|run\s+build)|pnpm\s+(?:test|build|lint)|yarn\s+(?:test|build|lint))\b`].join("")).test(command);
}
function packagePattern() {
	return new RegExp([String.raw`(?:ERR!|WARN|warning|error|failed|conflict|peer dep|added\s+\d+|removed\s+\d+|installed|success|`, String.raw`up to date|packages?\s+(?:added|removed|changed)|resolution|No matching distribution|Could not find a version)`].join(""), "i");
}
function buildPattern() {
	return new RegExp([
		String.raw`(?:error\s+TS\d+|warning\s+TS\d+|FAILED|FAIL\b|AssertionError|expected|actual|`,
		String.raw`tests?\s+(?:run|passed|failed|skipped)|Build\s+(?:succeeded|FAILED)|\d+\s+Error\(s\)|`,
		String.raw`\d+\s+Warning\(s\)|Finished\s+test|compilation failed)`
	].join(""), "i");
}
//#endregion
//#region src/deepseek-official-pricing.ts
/** Checked-in DeepSeek official prices and fixed-point provider-usage accounting. */
const DEEPSEEK_OFFICIAL_PRICE_CATALOG_VERSION = "deepseek-official-2026-08-25";
/** Wall-clock time at which the checked-in official price pages were verified. */
const DEEPSEEK_OFFICIAL_PRICE_CHECKED_AT = "2026-08-25T00:10:20+08:00";
const PRICES = Object.freeze({
	"deepseek-v4-flash": modelPrices("DeepSeek-V4-Flash-0731", [
		"0.007",
		"0.22",
		"0.66"
	], [
		"0.014",
		"0.44",
		"1.32"
	], [
		"0.05",
		"1.5",
		"4.5"
	], [
		"0.10",
		"3.0",
		"9.0"
	]),
	"deepseek-v4-pro": modelPrices("DeepSeek-V4-Pro-0813", [
		"0.022",
		"0.66",
		"1.98"
	], [
		"0.044",
		"1.32",
		"3.96"
	], [
		"0.15",
		"4.5",
		"13.5"
	], [
		"0.30",
		"9.0",
		"27.0"
	]),
	"deepseek-v4-flash-vision-exp": modelPrices("DeepSeek-V4-Flash-Vision-Exp", [
		"0.007",
		"0.22",
		"0.66"
	], [
		"0.014",
		"0.44",
		"1.32"
	], [
		"0.05",
		"1.5",
		"4.5"
	], [
		"0.10",
		"3.0",
		"9.0"
	])
});
const PEAK_RULE = "Asia/Shanghai Mon-Fri 09:00-12:00,14:00-18:00";
const USD_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing/";
const CNY_SOURCE = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
/**
* Resolve one immutable official price record; aliases and compatible gateways fail closed.
* @param input - exact provider, endpoint, route, model, currency, and timestamp applicability.
* @returns An immutable price record or an explicit unpriced reason.
*/
function resolveOfficialDeepSeekPrice(input) {
	if (input.provider !== "deepseek-official") return unpriced("unknown provider route");
	if (input.baseUrlClass !== "official-public") return unpriced("unknown base-url applicability");
	if (input.apiRoute !== "chat-completions" && input.apiRoute !== "responses") return unpriced("unknown API route");
	if (!isOfficialModel(input.modelId)) return unpriced("unknown model id");
	if (input.currency !== "USD" && input.currency !== "CNY") return unpriced("unknown currency");
	const band = priceBandAt(input.at);
	if (band === void 0) return unpriced("invalid price timestamp");
	const model = PRICES[input.modelId];
	const [inputCacheHit, inputCacheMiss, output] = model[input.currency][band];
	return {
		kind: "priced",
		record: Object.freeze({
			catalogVersion: DEEPSEEK_OFFICIAL_PRICE_CATALOG_VERSION,
			checkedAt: DEEPSEEK_OFFICIAL_PRICE_CHECKED_AT,
			provider: "deepseek-official",
			baseUrlClass: "official-public",
			apiRoute: input.apiRoute,
			modelId: input.modelId,
			modelVersion: model.version,
			currency: input.currency,
			unitTokens: 1e6,
			band,
			inputCacheHit,
			inputCacheMiss,
			output,
			sourceUrl: input.currency === "USD" ? USD_SOURCE : CNY_SOURCE,
			sourceLocale: input.currency === "USD" ? "en" : "zh-CN",
			peakRule: PEAK_RULE
		})
	};
}
/**
* Classify a timestamp under the published Beijing peak schedule.
* @param at - absolute request time to interpret in Asia/Shanghai.
* @returns Peak/off-peak, or undefined for an invalid timestamp.
*/
function priceBandAt(at) {
	if (!Number.isFinite(at.getTime())) return void 0;
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23"
	}).formatToParts(at);
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	const weekday = values.weekday;
	const hour = Number(values.hour);
	const minute = Number(values.minute);
	const second = Number(values.second);
	if (weekday === void 0 || !Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return void 0;
	const workday = weekday !== "Sat" && weekday !== "Sun";
	const seconds = hour * 3600 + minute * 60 + second;
	return workday && (seconds >= 32400 && seconds < 43200 || seconds >= 50400 && seconds < 64800) ? "peak" : "off-peak";
}
/**
* Price one completed request, returning a range when it spans a published band boundary.
* @param input - exact applicability, request interval, and complete disjoint usage buckets.
* @returns Fixed-point exact/range cost or an explicit unpriced reason.
*/
function priceOfficialDeepSeekUsage(input) {
	for (const [name, value] of Object.entries(input.usage)) if (!Number.isSafeInteger(value) || value < 0) return unpriced(`invalid ${name}`);
	if (input.completedAt.getTime() < input.startedAt.getTime()) return unpriced("completion timestamp precedes request start");
	const start = resolveOfficialDeepSeekPrice({
		...input,
		at: input.startedAt
	});
	if (start.kind === "unpriced") return start;
	const end = resolveOfficialDeepSeekPrice({
		...input,
		at: input.completedAt
	});
	if (end.kind === "unpriced") return end;
	const startAmount = amountFor(start.record, input.usage);
	if (startAmount === void 0) return unpriced("invalid decimal price record");
	const crossesBoundary = spansPublishedPriceBoundary(input.startedAt, input.completedAt);
	if (start.record.band === end.record.band && !crossesBoundary) return {
		kind: "exact",
		currency: start.record.currency,
		band: start.record.band,
		...startAmount
	};
	const comparisonRecord = start.record.band === end.record.band ? priceRecordInBand(start.record, start.record.band === "peak" ? "off-peak" : "peak") : end.record;
	const endAmount = amountFor(comparisonRecord, input.usage);
	if (endAmount === void 0) return unpriced("invalid decimal price record");
	const startFemto = BigInt(startAmount.femtoUnits);
	const endFemto = BigInt(endAmount.femtoUnits);
	return {
		kind: "range",
		currency: start.record.currency,
		bands: [start.record.band, comparisonRecord.band],
		minimum: startFemto <= endFemto ? startAmount : endAmount,
		maximum: startFemto <= endFemto ? endAmount : startAmount
	};
}
/** Detect any published UTC band boundary, even when both endpoints share a band. */
function spansPublishedPriceBoundary(startedAt, completedAt) {
	const start = startedAt.getTime();
	const end = completedAt.getTime();
	if (end <= start) return false;
	const dayMs = 864e5;
	if (end - start >= 7 * dayMs) return true;
	const firstDay = Math.floor(start / dayMs) * dayMs;
	for (let day = firstDay; day <= end; day += dayMs) {
		const weekday = new Date(day).getUTCDay();
		if (weekday === 0 || weekday === 6) continue;
		for (const hour of [
			1,
			4,
			6,
			10
		]) {
			const boundary = day + hour * 60 * 60 * 1e3;
			if (boundary > start && boundary <= end) return true;
		}
	}
	return false;
}
function priceRecordInBand(record, band) {
	const [inputCacheHit, inputCacheMiss, output] = PRICES[record.modelId][record.currency][band];
	return Object.freeze({
		...record,
		band,
		inputCacheHit,
		inputCacheMiss,
		output
	});
}
/**
* Parse a non-negative decimal rate into nano-currency units, without Number arithmetic.
* @param value - canonical non-negative decimal with at most nine fractional digits.
* @returns Integer nano-units, or undefined when the decimal is invalid.
*/
function decimalRateNanoUnits(value) {
	const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/u.exec(value);
	if (match === null) return void 0;
	const whole = match[1] ?? "0";
	const fraction = (match[2] ?? "").padEnd(9, "0");
	return BigInt(whole) * 1000000000n + BigInt(fraction || "0");
}
function amountFor(record, usage) {
	const hit = decimalRateNanoUnits(record.inputCacheHit);
	const miss = decimalRateNanoUnits(record.inputCacheMiss);
	const output = decimalRateNanoUnits(record.output);
	if (hit === void 0 || miss === void 0 || output === void 0) return void 0;
	const femtoUnits = BigInt(usage.cacheReadTokens) * hit + BigInt(usage.cacheMissTokens) * miss + BigInt(usage.outputTokens) * output;
	return {
		femtoUnits: femtoUnits.toString(),
		decimal: formatFemto(femtoUnits)
	};
}
function formatFemto(value) {
	const digits = value.toString().padStart(16, "0");
	const whole = digits.slice(0, -15);
	const fraction = digits.slice(-15).replace(/0+$/u, "");
	return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}
function modelPrices(version, usdOffPeak, usdPeak, cnyOffPeak, cnyPeak) {
	return Object.freeze({
		version,
		USD: Object.freeze({
			"off-peak": usdOffPeak,
			peak: usdPeak
		}),
		CNY: Object.freeze({
			"off-peak": cnyOffPeak,
			peak: cnyPeak
		})
	});
}
function isOfficialModel(value) {
	return Object.prototype.hasOwnProperty.call(PRICES, value);
}
function unpriced(reason) {
	return {
		kind: "unpriced",
		reason
	};
}
//#endregion
//#region src/adaptive-cost.ts
/**
* Bound Adaptive's benefit and cache-loss exposure without attributing the
* request-level cache split to individual messages. Removed tokens are not
* charged again as part of the retained suffix.
* @param input - exact planned reclaim, adjacent request measurement, and same-revision nodes.
* @returns Conservative removal/cache-risk bounds or an explicit unknown reason.
*/
function deriveAdaptiveTokenBounds(input) {
	if (!isCount(input.exactReclaimedTokens) || input.exactReclaimedTokens === 0) return unknown("invalid-reclaimed-token-count");
	if (!isCount(input.earliestChangedSeq)) return unknown("invalid-earliest-changed-seq");
	if (!isCount(input.previousPromptTokens)) return unknown("invalid-previous-prompt-tokens");
	if (input.expectedTokenizerRevision.length === 0) return unknown("expected-tokenizer-revision-unavailable");
	const request = input.previousRequestMeasurement;
	let margin = 0;
	let measurementKind;
	if (request.kind === "unavailable") return unknown("request-measurement-unavailable");
	if (request.kind === "exact-tokenizer") {
		if (!isCount(request.tokens) || request.tokens !== input.previousPromptTokens) return unknown("exact-request-usage-mismatch");
		if (request.tokenizerRevision !== input.expectedTokenizerRevision) return unknown("request-tokenizer-revision-mismatch");
		measurementKind = request.kind;
	} else {
		const calibration = request.calibration;
		if (calibration === void 0) return unknown("estimate-calibration-unavailable");
		if (!isCount(request.tokens) || !isCount(request.upperBoundTokens) || request.upperBoundTokens < request.tokens || input.previousPromptTokens > request.upperBoundTokens || !isCount(calibration.sampleCount) || !isCount(calibration.conservativeMarginTokens)) return unknown("invalid-estimate-calibration");
		margin = calibration.conservativeMarginTokens;
		measurementKind = request.kind;
	}
	const reclaimedLowerBoundTokens = Math.max(0, input.exactReclaimedTokens - margin);
	if (reclaimedLowerBoundTokens === 0) return unknown("reclaim-not-positive-after-margin");
	let identity;
	let exactPrefixLowerBoundTokens = 0;
	const seen = /* @__PURE__ */ new Set();
	for (const node of input.measuredNodes) {
		if (!isCount(node.seq) || seen.has(node.seq)) return unknown("invalid-measured-node-sequence");
		seen.add(node.seq);
		if (node.seq >= input.earliestChangedSeq || node.count.kind !== "exact-tokenizer") continue;
		if (!isCount(node.count.tokens)) return unknown("invalid-exact-prefix-count");
		if (node.count.tokenizerRevision !== input.expectedTokenizerRevision) return unknown("exact-prefix-tokenizer-revision-mismatch");
		if (identity !== void 0 && (identity.tokenizerId !== node.count.tokenizerId || identity.tokenizerRevision !== node.count.tokenizerRevision)) return unknown("exact-prefix-tokenizer-identity-mismatch");
		identity ??= node.count;
		exactPrefixLowerBoundTokens += node.count.tokens;
		if (!isCount(exactPrefixLowerBoundTokens)) return unknown("exact-prefix-overflow");
	}
	const accounted = exactPrefixLowerBoundTokens + reclaimedLowerBoundTokens;
	if (!isCount(accounted) || accounted > input.previousPromptTokens) return unknown("adaptive-bounds-exceed-previous-prompt");
	return {
		kind: "available",
		measurementKind,
		reclaimedLowerBoundTokens,
		affectedRetainedSuffixUpperBoundTokens: input.previousPromptTokens - accounted,
		exactPrefixLowerBoundTokens
	};
}
/**
* Allow routine History only when D*P_hit is strictly greater than A*(P_miss-P_hit).
* @param input - capacity state, token bounds, request hit cap, and official input rates.
* @returns Capacity override or a strict fixed-point conservative-cost decision.
*/
function decideConservativeAdaptive(input) {
	if (input.capacityPressure) return {
		allowHistory: true,
		reason: "capacity-override"
	};
	if (input.bounds.kind === "unknown") return {
		allowHistory: false,
		reason: input.bounds.reason
	};
	if (input.inputCacheHitRate === void 0 || input.inputCacheMissRate === void 0) return {
		allowHistory: false,
		reason: "adaptive-unknown-price"
	};
	const hit = decimalRateNanoUnits(input.inputCacheHitRate);
	const miss = decimalRateNanoUnits(input.inputCacheMissRate);
	if (hit === void 0 || miss === void 0 || miss < hit) return {
		allowHistory: false,
		reason: "adaptive-unknown-price"
	};
	if (input.observedCacheReadTokens !== void 0 && !isCount(input.observedCacheReadTokens)) return {
		allowHistory: false,
		reason: "adaptive-invalid-cache-telemetry"
	};
	const affectedHitUpperBound = input.observedCacheReadTokens === void 0 ? input.bounds.affectedRetainedSuffixUpperBoundTokens : Math.min(input.bounds.affectedRetainedSuffixUpperBoundTokens, input.observedCacheReadTokens);
	const minimumRemovalValue = BigInt(input.bounds.reclaimedLowerBoundTokens) * hit;
	const maximumCacheLossPenalty = BigInt(affectedHitUpperBound) * (miss - hit);
	return {
		allowHistory: minimumRemovalValue > maximumCacheLossPenalty,
		reason: minimumRemovalValue > maximumCacheLossPenalty ? "cost-interval-clearly-favourable" : "cache-risk-not-clearly-paid-back",
		minimumRemovalValue: minimumRemovalValue.toString(),
		maximumCacheLossPenalty: maximumCacheLossPenalty.toString()
	};
}
function unknown(reason) {
	return {
		kind: "unknown",
		reason
	};
}
function isCount(value) {
	return Number.isSafeInteger(value) && value >= 0;
}
//#endregion
//#region src/audit.ts
/** Stable prefix used to locate one JSON audit record in Harness runtime logs. */
const COMPRESSION_AUDIT_PREFIX = "context-compression audit ";
/**
* Encode one stable single-line audit message.
* @param record - content-free structured audit record.
* @returns the fixed prefix followed by one JSON object.
*/
function formatCompressionAudit(record) {
	return `${COMPRESSION_AUDIT_PREFIX}${JSON.stringify(record)}`;
}
/**
* Publish one audit message through the Harness logger.
* @param logger - current plugin logger.
* @param record - structured record committed by the caller.
*/
function emitCompressionAudit(logger, record) {
	try {
		logger.info(formatCompressionAudit(record));
	} catch {}
}
//#endregion
//#region src/index.ts
/**
* Replay-safe, model-free context-compression selector for tool results.
*
* Standard profiles never rewrite ordinary Assistant prose. The only durable
* replacements emitted here are content-only `tool/result` rewrites whose
* full source remains in the append-only Session log.
*
* @module dsh-context-compression-improved-runtime
*/
const BS = String.fromCharCode(10);
/** Count the lines present in the original but absent from the replacement. */
function countOmittedLines(original, replacement) {
	const omitted = original.split(BS).length - replacement.split(BS).length;
	return omitted > 0 ? omitted : void 0;
}
const RICH_BLOCK_PRESSURE_COST = 256;
/** Routed-context utilization required before capacity-pressure History may age sent history. */
const CAPACITY_PRESSURE_RATIO = .7;
/** Mixed deterministic selector behind the existing `ctx.toolResultPruner` seam. */
var ToolResultPruner = class extends Service {
	static inject = ["tokenMeter"];
	static Config = z.object({
		profile: z.union([...COMPRESSION_PROFILES]).default(DEFAULTS.profile),
		headChars: z.number().step(1).min(0).default(DEFAULTS.headChars),
		tailChars: z.number().step(1).min(0).default(DEFAULTS.tailChars),
		nativeTriggerTokens: z.number().step(1).min(1).required(false),
		nativeTargetTokens: z.number().step(1).min(1).required(false),
		freshTriggerTokens: z.number().step(1).min(1).required(false),
		freshTargetTokens: z.number().step(1).min(1).required(false),
		aggregateTriggerTokens: z.number().step(1).min(1).required(false),
		aggregateTargetTokens: z.number().step(1).min(1).required(false),
		historyTriggerTokens: z.number().step(1).min(1).required(false),
		historyKeepRecentToolCalls: z.number().step(1).min(0).required(false),
		historyKeepRecentTokens: z.number().step(1).min(0).required(false),
		historyMinReclaimTokens: z.number().step(1).min(1).required(false),
		autoCompactThresholdPercent: z.number().step(1).min(50).max(90).required(false)
	});
	/** Resolved immutable deployment configuration. */
	config;
	/** Complete canonical setting document frozen when each Session first reaches this root service. */
	sessionSettings = /* @__PURE__ */ new WeakMap();
	/** Original result seqs whose first-exposure KEEP/REDUCE decision has committed. */
	firstExposure = /* @__PURE__ */ new WeakMap();
	/** Result seqs permanently exempt from further reduction (recovery outputs and registered equivalents). */
	recoveryExemptions = /* @__PURE__ */ new WeakMap();
	/** Per-session canonical-content hash index backing tokenpilot-inspired dedupe. */
	dedupeTables = /* @__PURE__ */ new WeakMap();
	/** Advisory estimator verdicts consumed by the read-state classification. */
	estimatorVerdicts = /* @__PURE__ */ new WeakMap();
	/** Per-session estimator failure backoff state. */
	estimatorFailures = /* @__PURE__ */ new WeakMap();
	/** Runtime prerequisite warnings deduplicated per Session and failure key. */
	warnedFailures = /* @__PURE__ */ new WeakMap();
	/** Last Adaptive postflight attempt emitted per Session; keeps diagnostics bounded and independent. */
	postflightDiagnostics = /* @__PURE__ */ new WeakMap();
	/** Current pre-step chain identity, shared by this producer and downstream compaction-basic. */
	activeRequestBoundaries = /* @__PURE__ */ new WeakMap();
	/** Boundary identity that already attempted one fully preflighted TailTrim publication. */
	tailTrimBoundaryAttempts = /* @__PURE__ */ new WeakMap();
	/** Last effective policy audit key emitted for each Session. */
	policyResolutionAudits = /* @__PURE__ */ new WeakMap();
	constructor(ctx, config = {}) {
		super(ctx, "toolResultPruner");
		ctx.inject(["tools", "systemPrompt"], (recoveryCtx) => {
			installContextCompressionRetrieve(recoveryCtx);
		});
		this.config = resolveConfig(config);
		ctx.on("session/event", (session, event) => {
			if (event.type === "compaction/summary") {
				emitCompressionAudit(ctx.logger, {
					schemaVersion: 1,
					kind: "native-auto-compact",
					sessionId: String(session.id),
					manifestEventType: "compaction/summary",
					manifestSeq: event.seq,
					reducer: "llm-summary",
					provider: event.data.provider,
					model: event.data.model,
					tokensBefore: event.data.shadowedTokenCount,
					tokensAfter: null
				});
				return;
			}
			if (event.type === "compaction/end") try {
				this.attachSummaryLocator(session, event.data.compactionId);
			} catch (error) {
				this.auditFailure(session, "pressure", "summary-locator", error);
				ctx.logger.warn("context-compression summary locator failed open: %o", error);
			}
		});
		ctx.on("agent/pre-step", async ({ agent, signal, turn, step }, next) => {
			const boundary = {};
			this.activeRequestBoundaries.set(agent.session, boundary);
			try {
				if (!signal.aborted) try {
					this.runRequestBoundary(agent.session, turn, step - 1, signal);
				} catch (error) {
					this.auditFailure(agent.session, "fresh", "request-boundary", error);
					ctx.logger.warn("context-compression fresh pass failed open: %o", error);
				}
				return await next();
			} finally {
				if (this.activeRequestBoundaries.get(agent.session) === boundary) this.activeRequestBoundaries.delete(agent.session);
			}
		}, { prepend: true });
		ctx.on("agent/turn-stopping", ({ agent, turn, signal }) => {
			if (signal.aborted) return;
			try {
				const step = this.latestCompletedToolStep(agent.session, turn);
				if (step !== void 0) this.runRequestBoundary(agent.session, turn, step, signal);
			} catch (error) {
				this.auditFailure(agent.session, "fresh", "terminal-pass", error);
				ctx.logger.warn("context-compression terminal pass failed open: %o", error);
			}
			this.postflightEstimatorPass(agent.session, signal).catch(() => void 0);
		});
	}
	/**
	* Measure text content in Unicode code points; non-text blocks cost zero.
	* @param blocks - tool-result content to measure.
	* @returns total Unicode code points across text blocks.
	*/
	measureContent(blocks) {
		let chars = 0;
		for (const block of blocks) if (block.type === "text") chars += codePointLength(block.text);
		return chars;
	}
	pressureCost(blocks) {
		let cost = 0;
		for (const block of blocks) switch (block.type) {
			case "text":
			case "reasoning":
				cost += codePointLength(block.text);
				break;
			case "tool-call":
				cost += RICH_BLOCK_PRESSURE_COST + codePointLength(block.name) + codePointLength(block.arguments);
				break;
			case "tool-result":
				cost += RICH_BLOCK_PRESSURE_COST + this.pressureCost(block.content);
				break;
			default: {
				const serialized = JSON.stringify(block);
				cost += Math.max(RICH_BLOCK_PRESSURE_COST, codePointLength(serialized));
			}
		}
		return cost;
	}
	/**
	* Apply the configured native head/middle/tail transform.
	* @param blocks - original tool-result content.
	* @returns reduced content, or `null` when no reduction is required.
	*/
	pruneContent(blocks) {
		return this.nativePruneContent(blocks, this.config.headChars + codePointLength(PRUNE_MARKER) + this.config.tailChars, this.config.headChars, this.config.tailChars);
	}
	/**
	* Run one stable-surface pass. `fresh` is invoked before every request and
	* only reduces original oversized results. `pressure` is called by
	* compaction-basic and may additionally age old results at one high-water.
	* @param session - session whose current tool-result surface may be rewritten.
	* @param options - pass stage and optional completed-step coordinates.
	* @returns landed replacements and aggregate Unicode-code-point savings.
	*/
	pruneSession(session, options = {}) {
		const stage = options.stage ?? "pressure";
		const contextWindowTokens = options.contextWindowTokens ?? this.contextWindowForRequest(session);
		const policy = this.activePolicy(session, contextWindowTokens, stage);
		if (policy === void 0) return emptyResult();
		const profile = policy.profile;
		const view = measureForCompaction(this.ctx, session);
		if (stage === "fresh") return this.decideFreshStep(session, options, policy, view);
		if (profile === "off") return emptyResult();
		const landed = [];
		if (policy.nativeToolResultEnabled) {
			const eligible = this.snapshot(session, view).filter((candidate) => !this.isRecoveryExempt(session, candidate));
			const exactUnavailable = eligible.some((candidate) => candidate.count.kind !== "exact-tokenizer");
			if (exactUnavailable) this.warnExactUnavailable(session, view, "native");
			const planned = eligible.map((candidate) => this.planNative(candidate, session, stage, policy, view)).filter((entry) => entry !== null);
			landed.push(...this.landAll(session, planned));
			if (landed.length === 0) {
				const exact = eligible.flatMap((candidate) => candidate.count.kind === "exact-tokenizer" ? [candidate.count.tokens] : []);
				this.auditComponent(session, policy, "native-tool-result", "pressure", "skipped", exactUnavailable ? "exact-tokenizer-unavailable" : exact.length === 0 ? "no-tool-result-candidates" : Math.max(...exact) <= policy.nativeTriggerTokens ? "at-or-below-trigger" : planned.length === 0 ? "no-valid-reduction" : "recovery-tool-unavailable", {
					measurementKind: exactUnavailable ? "unavailable" : "exact-tokenizer",
					...exact.length === 0 ? {} : { currentTokens: Math.max(...exact) },
					triggerTokens: policy.nativeTriggerTokens,
					targetTokens: policy.nativeTargetTokens
				});
			}
			return summarize(landed);
		}
		let historyOutcome = {
			kind: "planned",
			plans: []
		};
		let historyAllowed = false;
		if (policy.historyMode === "adaptive") {
			historyOutcome = this.planHistoricalAging(session, policy, view);
			if (historyOutcome.kind === "planned") {
				const capacityPressure = this.capacityPressureActive(session, view, policy);
				historyAllowed = this.adaptiveHistoryAllowed(session, view, historyOutcome.plans, capacityPressure);
				if (historyAllowed) landed.push(...this.landAll(session, historyOutcome.plans));
			}
		} else {
			historyAllowed = this.historyAllowed(session, policy, view);
			if (historyAllowed) {
				historyOutcome = this.planHistoricalAging(session, policy, view);
				if (historyOutcome.kind === "planned") landed.push(...this.landAll(session, historyOutcome.plans));
			}
		}
		if (!landed.some((entry) => entry.stage === "pressure")) this.auditHistoryEvaluation(session, policy, view, historyAllowed, historyOutcome);
		if (policy.tailTrim?.enabled === true) {
			const tailView = measureForCompaction(this.ctx, session);
			this.landOldestTailTrimGroup(session, policy, tailView);
		} else this.auditComponent(session, policy, "tail-trim", "pressure", "disabled", "profile-policy");
		return summarize(landed);
	}
	activeSettings(session) {
		const frozen = this.sessionSettings.get(session);
		if (frozen !== void 0) return frozen;
		const settings = this.ctx.get("settings")?.get(CONTEXT_COMPRESSION_SETTINGS_NAMESPACE);
		let resolved;
		let settingsSource = settings === void 0 ? "plugin-config-fallback" : "host-settings";
		let autoCompactThresholdSource = settings === void 0 ? "schema-default" : "host-settings";
		let settingsInvalidFallback;
		try {
			resolved = settings === void 0 ? ContextCompressionSettingsSchema({ profile: this.config.profile }) : parseContextCompressionSettings(settings);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.auditFailure(session, "pressure", "policy-resolution", error);
			this.warnOnce(session, `settings-invalid:${reason}`, "context-compression froze this session effectively off because the stored settings document is invalid: %s", reason);
			resolved = ContextCompressionSettingsSchema({ profile: "off" });
			settingsSource = "plugin-config-fallback";
			autoCompactThresholdSource = "schema-default";
			settingsInvalidFallback = "lossless-off";
		}
		if (this.config.autoCompactThresholdPercent !== void 0) {
			resolved = {
				...resolved,
				autoCompact: { thresholdPercent: this.config.autoCompactThresholdPercent }
			};
			autoCompactThresholdSource = "generation-config";
		}
		const snapshot = deepFreeze(structuredClone(resolved));
		this.sessionSettings.set(session, snapshot);
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "policy-frozen",
			sessionId: String(session.id),
			settingsSource,
			autoCompactThresholdSource,
			...settingsInvalidFallback === void 0 ? {} : { settingsInvalidFallback },
			settings: snapshot,
			deploymentConfig: this.config
		});
		return snapshot;
	}
	/**
	* TokenPilot-inspired A2: replace the compaction summary checkpoint node
	* with the same summary plus an Exact Sources locator block. Fails open:
	* any unresolved shape (no trace, no checkpoint node, already annotated)
	* leaves the summary untouched.
	*/
	attachSummaryLocator(session, compactionId) {
		const policy = this.activePolicy(session);
		if (policy?.presetOptions?.summaryLocator !== true) return;
		const events = sessionEvents(session);
		const trace = findCompactionTrace(events, compactionId);
		if (trace === void 0) return;
		const located = buildLocatorBlock(events, trace.summaryShadowedRange);
		if (located === null) return;
		const block = located.text;
		let checkpointSeq;
		for (const seq of [...session.surface.nodes].reverse()) {
			const event = events[seq];
			if (event === void 0 || event.type !== "user/message") continue;
			const source = event.data.source;
			if (source === void 0 || source === null) continue;
			if (source.compactionId !== compactionId) continue;
			checkpointSeq = seq;
			break;
		}
		if (checkpointSeq === void 0) return;
		const original = events[checkpointSeq];
		if (original?.type !== "user/message") return;
		const content = original.data.content.map((block) => ({ ...block }));
		const lastText = content.filter((block) => block.type === "text").at(-1);
		const marker = "## Exact Sources (locators)";
		if (lastText === void 0) return;
		if (lastText.text.includes(marker)) return;
		lastText.text = `${lastText.text}\n\n${block}`;
		const replacement = createUserMessage({
			content,
			source: {
				kind: "plugin",
				plugin: "dsh-context-compression-improved-runtime"
			}
		});
		session.append("user/message", replacement, {
			surfaceOp: {
				op: "replace",
				start: checkpointSeq,
				end: checkpointSeq
			},
			sourceEventSeqs: [checkpointSeq]
		});
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "summary-locator",
			sessionId: String(session.id),
			profile: policy.profile,
			checkpointSeq,
			summarySeq: trace.summarySeq,
			locatorChars: codePointLength(located.text),
			spillFiles: located.spillFiles,
			touchedFiles: located.touchedFiles
		});
	}
	/**
	* TokenPilot-inspired E1: sample oversized historical reads and ask the
	* auxiliary estimator whether their file state is still likely to be
	* referenced. Fire-and-forget: never awaited on the pruning chain, failures
	* back off exponentially per Session, verdicts only extend the rule-only
	* superseded classification.
	*/
	async postflightEstimatorPass(session, signal) {
		const policy = this.activePolicy(session);
		const presetOptions = policy?.presetOptions;
		if (policy === void 0 || presetOptions?.readState !== true) return;
		const estimatorMode = presetOptions.estimator?.mode ?? "";
		if (estimatorMode === "") return;
		const failures = this.estimatorFailures.get(session);
		if (isCoolingDown(failures, Date.now())) return;
		const events = sessionEvents(session);
		const samples = [];
		const now = Date.now();
		for (const candidate of this.snapshot(session, measureForCompaction(this.ctx, session))) {
			if (samples.length >= 3) break;
			if (candidate.event.data.turn === void 0) continue;
			const tokens = exactTokens(candidate.count);
			if (tokens === void 0 || tokens <= policy.freshTriggerTokens) continue;
			const path = toolCallPath(candidate.call.arguments);
			if (path === void 0) continue;
			if (isSupersededRead(events, candidate.seq, path)) continue;
			if (this.estimatorVerdicts.get(session)?.has(candidate.seq) === true) continue;
			samples.push({
				seq: candidate.seq,
				path,
				turn: candidate.event.data.turn
			});
		}
		if (samples.length === 0) return;
		const answer = await new Estimator(this.ctx, this.activeSettings(session).presetOptions ?? {}).ask(buildEstimatorSystemPrompt(), buildEstimatorUserPrompt(samples), signal);
		const latencyMs = Date.now() - now;
		const ok = answer !== void 0 && signal.aborted === false;
		let expired = 0;
		if (ok && answer !== void 0) {
			let verdicts = this.estimatorVerdicts.get(session);
			if (verdicts === void 0) {
				verdicts = /* @__PURE__ */ new Map();
				this.estimatorVerdicts.set(session, verdicts);
			}
			for (const verdict of parseEstimatorAnswer(answer)) {
				if (verdicts.has(verdict.seq)) continue;
				verdicts.set(verdict.seq, verdict.expired);
				if (verdict.expired) expired += 1;
			}
		} else {
			const next = {
				failures: (failures?.failures ?? 0) + 1,
				cooldownUntil: Date.now() + backoffCooldownMs((failures?.failures ?? 0) + 1)
			};
			this.estimatorFailures.set(session, next);
		}
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "estimator-outcome",
			sessionId: String(session.id),
			profile: policy.profile,
			channel: estimatorMode === "host" ? "host" : "direct",
			sampled: samples.length,
			expired,
			latencyMs,
			ok
		});
	}
	activePolicy(session, contextWindowTokens, stage = "pressure") {
		const settings = this.activeSettings(session);
		try {
			const policy = resolvePolicy(this.config, settings.profile, settings.custom, {
				...contextWindowTokens === void 0 ? {} : { contextWindowTokens },
				autoCompactThresholdPercent: settings.autoCompact.thresholdPercent
			});
			const route = this.routeAuditFact(session);
			const auditKey = JSON.stringify({
				policy,
				contextWindowTokens: contextWindowTokens ?? null,
				route: route ?? null
			});
			if (this.policyResolutionAudits.get(session) !== auditKey) {
				this.policyResolutionAudits.set(session, auditKey);
				const overriddenLinkedFields = [
					"historyTriggerTokens",
					"historyKeepRecentTokens",
					"historyMinReclaimTokens"
				].filter((key) => this.config[key] !== void 0).length;
				emitCompressionAudit(this.ctx.logger, {
					schemaVersion: 1,
					kind: "policy-resolved",
					sessionId: String(session.id),
					policy,
					...contextWindowTokens === void 0 ? {} : { contextWindowTokens },
					coordination: {
						thresholdPercent: settings.autoCompact.thresholdPercent,
						...policy.autoCompactTokens === void 0 ? {} : { autoCompactTokens: policy.autoCompactTokens },
						...policy.microDeadlineTokens === void 0 ? {} : { microDeadlineTokens: policy.microDeadlineTokens },
						paramSource: settings.profile === "custom" ? "custom-manual" : overriddenLinkedFields === 3 ? "deployment-override" : overriddenLinkedFields > 0 ? "mixed" : policy.microDeadlineTokens === void 0 ? "fixed-preset" : "auto-compact-linked"
					},
					...route === void 0 ? {} : { route },
					...route === void 0 ? {} : this.tokenizerAuditFact(route)
				});
			}
			return policy;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.auditFailure(session, stage, "policy-resolution", error);
			this.warnOnce(session, `custom-policy:${settings.profile}:${reason}`, "context-compression kept original tool results because the Custom policy is not effective: %s", reason);
			return;
		}
	}
	/** Routed provider/model when the durable request header names one route. */
	routeAuditFact(session) {
		const header = session.requestHeader()?.config;
		if (header === void 0 || header.provider.length === 0 || header.model.length === 0) return void 0;
		return {
			provider: header.provider,
			model: header.model
		};
	}
	/** Bundled tokenizer identity for one route, when the route is eligible. */
	tokenizerAuditFact(route) {
		const identity = route.provider === "deepseek" || route.provider === "deepseek-official" ? deepSeekV4TokenizerForModel(route.model)?.countText("") : void 0;
		if (identity?.kind === "exact-tokenizer") return { tokenizer: {
			repository: identity.tokenizerId,
			revision: identity.tokenizerRevision
		} };
		return { tokenizer: {
			repository: "unavailable",
			revision: "unavailable"
		} };
	}
	contextWindowForRequest(session) {
		const settings = this.activeSettings(session);
		if (settings.profile === "off" || settings.profile === "native") return void 0;
		if (settings.profile === "custom" && settings.custom.unit !== "context-percent") return void 0;
		const config = session.requestHeader()?.config;
		const routed = session.requestContext();
		if (config === void 0 || config.provider.length === 0 || config.model.length === 0 || routed === void 0) return;
		if (routed.provider !== config.provider || routed.model !== config.model) {
			this.warnOnce(session, `custom-context-window-route:${config.provider}\0${config.model}`, "context-compression kept the context-linked policy inactive because durable route capacity belongs to %s/%s, not %s/%s", routed.provider, routed.model, config.provider, config.model);
			return;
		}
		if (!Number.isSafeInteger(routed.contextWindow) || routed.contextWindow === void 0 || routed.contextWindow <= 0) {
			this.warnOnce(session, `custom-context-window-capacity:${config.provider}\0${config.model}`, "context-compression kept the context-linked policy inactive because %s/%s has no positive durable context capacity", config.provider, config.model);
			return;
		}
		return routed.contextWindow;
	}
	runRequestBoundary(session, turn, step, signal) {
		const contextWindowTokens = this.contextWindowForRequest(session);
		if (signal.aborted) return;
		const policy = this.activePolicy(session, contextWindowTokens, "fresh");
		if (policy === void 0) return;
		const capacity = contextWindowTokens === void 0 ? {} : { contextWindowTokens };
		this.pruneSession(session, {
			stage: "fresh",
			freshTurn: turn,
			freshStep: step,
			...capacity
		});
		if (policy.historyMode !== "disabled" || policy.tailTrim?.enabled === true) this.pruneSession(session, {
			stage: "pressure",
			...capacity
		});
	}
	/** Resolve historical-aging authority without accepting caller-supplied elevation. */
	historyAllowed(session, policy, view) {
		switch (policy.historyMode) {
			case "disabled": return false;
			case "routine": return true;
			case "capacity-pressure": return this.capacityPressureActive(session, view, policy);
			case "adaptive": return false;
			/* v8 ignore next -- closed-union exhaustiveness guard */
			default: return assertNever(policy.historyMode, "history mode");
		}
	}
	/**
	* Match the compaction-basic pressure gate using public durable data. The
	* frozen Auto Compact deadline `D = floor(A x 0.875)` replaces the legacy
	* fixed 0.7 ratio once the standard-profile linkage resolved; without
	* linkage the 0.7 ratio is the documented fallback and reproduces the
	* previous behavior.
	*/
	capacityPressureActive(session, view, policy) {
		const deadline = policy.microDeadlineTokens;
		if (deadline !== void 0) return view.totalTokens >= deadline;
		const header = session.requestHeader()?.config;
		const routed = session.requestContext();
		const contextWindow = routed?.contextWindow;
		if (header === void 0 || routed === void 0 || routed.provider !== header.provider || routed.model !== header.model || contextWindow === void 0 || !Number.isSafeInteger(contextWindow) || contextWindow <= 0) return false;
		return view.totalTokens >= Math.floor(contextWindow * CAPACITY_PRESSURE_RATIO);
	}
	/** Emit one bounded, independently correlatable postflight cost diagnostic per completed attempt. */
	logAdaptivePostflight(session, usage) {
		const attemptId = String(usage.attemptId);
		if (this.postflightDiagnostics.get(session) === attemptId) return;
		this.postflightDiagnostics.set(session, attemptId);
		const key = usage.key;
		let priceRecord;
		let cost;
		if (key === void 0) cost = {
			kind: "unpriced",
			reason: "measurement key unavailable"
		};
		else if (usage.responseModelId !== key.modelId) cost = {
			kind: "unpriced",
			reason: "response model mismatch or unavailable"
		};
		else if (usage.observedOutputTokens === void 0) cost = {
			kind: "unpriced",
			reason: "output token count unavailable"
		};
		else if (usage.cacheStatus !== "complete" || usage.cacheReadTokens === void 0 || usage.cacheMissTokens === void 0) cost = {
			kind: "unpriced",
			reason: "complete cache split unavailable"
		};
		else {
			const startedAt = new Date(usage.startedAtMs);
			const completedAt = new Date(usage.completedAtMs);
			const resolution = resolveOfficialDeepSeekPrice({
				provider: key.provider,
				baseUrlClass: key.baseUrlClass,
				apiRoute: key.apiRoute,
				modelId: key.modelId,
				currency: "USD",
				at: startedAt
			});
			if (resolution.kind === "priced") priceRecord = {
				catalogVersion: resolution.record.catalogVersion,
				checkedAt: resolution.record.checkedAt,
				sourceUrl: resolution.record.sourceUrl,
				currency: resolution.record.currency,
				modelId: resolution.record.modelId,
				apiRoute: resolution.record.apiRoute,
				startBand: resolution.record.band
			};
			cost = priceOfficialDeepSeekUsage({
				provider: key.provider,
				baseUrlClass: key.baseUrlClass,
				apiRoute: key.apiRoute,
				modelId: key.modelId,
				currency: "USD",
				startedAt,
				completedAt,
				usage: {
					cacheReadTokens: usage.cacheReadTokens,
					cacheMissTokens: usage.cacheMissTokens,
					outputTokens: usage.observedOutputTokens
				}
			});
		}
		this.ctx.logger.debug(`context-compression adaptive postflight ${JSON.stringify({
			sessionId: String(session.id),
			providerRequestOrdinal: Number(usage.providerRequestOrdinal),
			attemptId,
			startedAtMs: usage.startedAtMs,
			completedAtMs: usage.completedAtMs,
			measurementKind: usage.measurement.kind,
			catalogVersion: DEEPSEEK_OFFICIAL_PRICE_CATALOG_VERSION,
			...priceRecord === void 0 ? {} : { priceRecord },
			usage: {
				promptTokens: usage.observedPromptTokens,
				...usage.observedOutputTokens === void 0 ? {} : { outputTokens: usage.observedOutputTokens },
				cacheStatus: usage.cacheStatus ?? "unknown",
				...usage.cacheReadTokens === void 0 ? {} : { cacheReadTokens: usage.cacheReadTokens },
				...usage.cacheMissTokens === void 0 ? {} : { cacheMissTokens: usage.cacheMissTokens }
			},
			cost
		})}`);
	}
	/** Decide one already-planned History batch from adjacent request-level facts only. */
	adaptiveHistoryAllowed(session, view, plans, capacityPressure) {
		const log = (allowHistory, reason, detail = {}) => {
			this.ctx.logger.debug(`context-compression adaptive ${JSON.stringify({
				sessionId: String(session.id),
				allowHistory,
				reason,
				catalogVersion: DEEPSEEK_OFFICIAL_PRICE_CATALOG_VERSION,
				...detail
			})}`);
			return allowHistory;
		};
		const usage = view.lastCompletedUsage;
		if (usage !== void 0) this.logAdaptivePostflight(session, usage);
		if (plans.length === 0) return false;
		if (capacityPressure) return log(true, "capacity-override");
		const currentKey = view.latestEnvelopeKey;
		if (usage === void 0) return log(false, "usage-unavailable");
		if (usage.key === void 0 || currentKey === void 0) return log(false, "measurement-key-unavailable");
		if (!sameProviderMeasurementKey(usage.key, currentKey)) return log(false, "measurement-key-mismatch");
		if (usage.responseModelId !== usage.key.modelId) return log(false, "response-model-mismatch-or-unavailable");
		if (usage.cacheStatus !== "complete" || usage.cacheReadTokens === void 0 || usage.cacheMissTokens === void 0) return log(false, "cache-split-incomplete");
		const price = resolveOfficialDeepSeekPrice({
			provider: usage.key.provider,
			baseUrlClass: usage.key.baseUrlClass,
			apiRoute: usage.key.apiRoute,
			modelId: usage.key.modelId,
			currency: "USD",
			at: /* @__PURE__ */ new Date()
		});
		if (price.kind === "unpriced") return log(false, `adaptive-unknown-price:${price.reason}`);
		const bounds = deriveAdaptiveTokenBounds({
			exactReclaimedTokens: plans.reduce((sum, plan) => sum + plan.tokensBefore - plan.tokensAfter, 0),
			earliestChangedSeq: Math.min(...plans.map((plan) => plan.candidate.seq)),
			previousPromptTokens: usage.observedPromptTokens,
			expectedTokenizerRevision: usage.key.tokenizerRevision,
			previousRequestMeasurement: usage.measurement,
			measuredNodes: view.measuredNodes
		});
		const decision = decideConservativeAdaptive({
			capacityPressure: false,
			bounds,
			inputCacheHitRate: price.record.inputCacheHit,
			inputCacheMissRate: price.record.inputCacheMiss,
			observedCacheReadTokens: usage.cacheReadTokens
		});
		return log(decision.allowHistory, decision.reason, {
			priceBand: price.record.band,
			observedPromptTokens: usage.observedPromptTokens,
			observedCacheReadTokens: usage.cacheReadTokens,
			bounds,
			..."minimumRemovalValue" in decision ? { minimumRemovalValue: decision.minimumRemovalValue } : {},
			..."maximumCacheLossPenalty" in decision ? { maximumCacheLossPenalty: decision.maximumCacheLossPenalty } : {}
		});
	}
	latestCompletedToolStep(session, turn) {
		let latest;
		for (const event of sessionEvents(session)) if (event.type === "step/end" && event.data.turn === turn) latest = event.data.step;
		return latest;
	}
	decisions(session) {
		let decisions = this.firstExposure.get(session);
		if (decisions === void 0) {
			decisions = /* @__PURE__ */ new Set();
			this.firstExposure.set(session, decisions);
		}
		return decisions;
	}
	/**
	* TokenPilot-style skipReduction: recovery tool output is permanently exempt
	* from every reduction pass so retrieved content can never enter a
	* compress-restore-oscillation loop. A call-name match covers the built-in
	* recovery tool; the per-session set admits future recovery paths.
	*/
	isRecoveryExempt(session, candidate) {
		if (candidate.call.name === "context_compression_retrieve") return true;
		return this.recoveryExemptions.get(session)?.has(candidate.seq) ?? false;
	}
	/** Register a result seq as permanently exempt from further reduction. */
	grantRecoveryExemption(session, seq) {
		let exemptions = this.recoveryExemptions.get(session);
		if (exemptions === void 0) {
			exemptions = /* @__PURE__ */ new Set();
			this.recoveryExemptions.set(session, exemptions);
		}
		exemptions.add(seq);
	}
	decideFreshStep(session, options, policy, view) {
		if (options.freshTurn === void 0 || options.freshStep === void 0) {
			this.auditComponent(session, policy, "fresh", "fresh", policy.freshEnabled ? "skipped" : "disabled", policy.freshEnabled ? "missing-completed-step-coordinates" : "profile-policy");
			this.auditComponent(session, policy, "aggregate", "fresh", policy.aggregateEnabled ? "skipped" : "disabled", policy.aggregateEnabled ? "missing-completed-step-coordinates" : "profile-policy");
			return emptyResult();
		}
		const decisions = this.decisions(session);
		const candidates = this.snapshot(session, view).filter((candidate) => typeof candidate.event.surfaceOp !== "object" && candidate.event.data.turn === options.freshTurn && candidate.event.data.step === options.freshStep && !decisions.has(candidate.seq));
		if (candidates.length === 0) {
			this.auditComponent(session, policy, "fresh", "fresh", policy.freshEnabled ? "skipped" : "disabled", policy.freshEnabled ? "no-new-tool-result-candidates" : "profile-policy");
			this.auditComponent(session, policy, "aggregate", "fresh", policy.aggregateEnabled ? "skipped" : "disabled", policy.aggregateEnabled ? "no-new-tool-result-candidates" : "profile-policy");
			return emptyResult();
		}
		const plans = /* @__PURE__ */ new Map();
		let freshPlanned = 0;
		let dedupePlanned = 0;
		const dedupeEnabled = policy.presetOptions?.dedupeToolResults === true;
		const exactCandidateTokens = candidates.map((candidate) => exactTokens(candidate.count));
		const exactAvailable = exactCandidateTokens.every((tokens) => tokens !== void 0);
		const maxCandidateTokens = exactAvailable ? Math.max(...exactCandidateTokens) : void 0;
		if (policy.freshEnabled) {
			if (candidates.some((candidate) => candidate.call.name !== "context_compression_retrieve" && candidate.count.kind !== "exact-tokenizer")) this.warnExactUnavailable(session, view, "fresh");
			for (const candidate of candidates) {
				if (this.isRecoveryExempt(session, candidate)) continue;
				if (dedupeEnabled) {
					const dedupePlan = this.planDedupe(candidate, session, policy, view);
					if (dedupePlan !== null) {
						plans.set(candidate.seq, dedupePlan);
						dedupePlanned += 1;
						continue;
					}
				}
				const plan = this.planFresh(candidate, session, policy, view);
				if (plan !== null) {
					plans.set(candidate.seq, plan);
					freshPlanned += 1;
				}
			}
		}
		let aggregateInputTokens;
		let aggregatePlanned = 0;
		if (policy.aggregateEnabled) {
			const aggregateAvailable = exactAvailable;
			if (!aggregateAvailable) this.warnExactUnavailable(session, view, "aggregate");
			let total = aggregateAvailable ? candidates.reduce((sum, candidate) => sum + (plans.get(candidate.seq)?.tokensAfter ?? exactTokens(candidate.count) ?? 0), 0) : 0;
			if (aggregateAvailable) aggregateInputTokens = total;
			if (aggregateAvailable && total > policy.aggregateTriggerTokens) {
				const remaining = candidates.filter((candidate) => !this.isRecoveryExempt(session, candidate)).sort((a, b) => Number(this.isError(a)) - Number(this.isError(b)) || (plans.get(b.seq)?.tokensAfter ?? exactTokens(b.count) ?? 0) - (plans.get(a.seq)?.tokensAfter ?? exactTokens(a.count) ?? 0));
				for (const candidate of remaining) {
					const previous = plans.get(candidate.seq);
					const plan = this.planAggregate(candidate, session, view);
					const previousTokens = previous?.tokensAfter ?? exactTokens(candidate.count) ?? 0;
					if (plan === null || plan.tokensAfter >= previousTokens) continue;
					plans.set(candidate.seq, plan);
					aggregatePlanned += 1;
					total -= previousTokens - plan.tokensAfter;
					if (total <= policy.aggregateTargetTokens) break;
				}
				if (total > policy.aggregateTargetTokens) this.ctx.logger.warn("context-compression fresh aggregate residual: %d tokens exceed target %d", total, policy.aggregateTargetTokens);
			}
		}
		const landed = this.landAll(session, candidates.map((candidate) => plans.get(candidate.seq)).filter((plan) => plan !== void 0));
		const freshLanded = landed.some((entry) => entry.stage === "fresh" && plans.get(entry.originalSeq)?.component === "fresh");
		const aggregateLanded = landed.some((entry) => entry.stage === "fresh" && plans.get(entry.originalSeq)?.component === "aggregate");
		if (!freshLanded) this.auditComponent(session, policy, "fresh", "fresh", policy.freshEnabled ? "skipped" : "disabled", !policy.freshEnabled ? "profile-policy" : !exactAvailable ? "exact-tokenizer-unavailable" : (maxCandidateTokens ?? 0) <= policy.freshTriggerTokens ? "at-or-below-trigger" : freshPlanned > 0 && aggregatePlanned > 0 ? "superseded-by-aggregate" : freshPlanned === 0 ? "no-valid-reduction" : "recovery-tool-unavailable", {
			measurementKind: exactAvailable ? "exact-tokenizer" : "unavailable",
			...maxCandidateTokens === void 0 ? {} : { currentTokens: maxCandidateTokens },
			triggerTokens: policy.freshTriggerTokens,
			targetTokens: policy.freshTargetTokens
		});
		if (!aggregateLanded) this.auditComponent(session, policy, "aggregate", "fresh", policy.aggregateEnabled ? "skipped" : "disabled", !policy.aggregateEnabled ? "profile-policy" : !exactAvailable ? "exact-tokenizer-unavailable" : (aggregateInputTokens ?? 0) <= policy.aggregateTriggerTokens ? "at-or-below-trigger" : aggregatePlanned === 0 ? "no-valid-reduction" : "recovery-tool-unavailable", {
			measurementKind: exactAvailable ? "exact-tokenizer" : "unavailable",
			...aggregateInputTokens === void 0 ? {} : { currentTokens: aggregateInputTokens },
			triggerTokens: policy.aggregateTriggerTokens,
			targetTokens: policy.aggregateTargetTokens
		});
		for (const candidate of candidates) decisions.add(candidate.seq);
		return summarize(landed);
	}
	snapshot(session, view) {
		const events = sessionEvents(session);
		const calls = /* @__PURE__ */ new Map();
		for (const event of events) if (event.type === "tool/call") calls.set(event.data.callId, {
			name: event.data.name,
			arguments: event.data.arguments
		});
		const candidates = [];
		const measured = new Map(view.measuredNodes.map((node) => [node.seq, node.count]));
		const projectionPrices = new Map(view.nodes.map((node) => [node.seq, node.tokens]));
		for (const seq of [...session.surface.nodes]) {
			const event = events[seq];
			if (event?.type !== "tool/result") continue;
			const shadowedHeuristicTokenCount = projectionPrices.get(seq);
			if (shadowedHeuristicTokenCount === void 0) throw new Error(`surface node ${String(seq)} is absent from the atomic legacy projection`);
			const content = event.data.message.content[0].content;
			candidates.push({
				seq,
				event,
				call: calls.get(event.data.message.source.callId) ?? {
					name: "unknown",
					arguments: "{}"
				},
				count: onlyTextBlocks(content) === null ? unavailableCount(`surface node ${String(seq)} contains unsupported rich tool-result content`) : measured.get(seq) ?? unavailableCount(`surface node ${String(seq)} is absent from the atomic token view`),
				shadowedHeuristicTokenCount,
				characterPressure: this.pressureCost(content)
			});
		}
		return candidates;
	}
	planNative(candidate, session, stage, policy, view) {
		if (this.isRecoveryExempt(session, candidate)) return null;
		const tokensBefore = exactTokens(candidate.count);
		if (tokensBefore === void 0 || tokensBefore <= policy.nativeTriggerTokens) return null;
		const result = candidate.event.data.message.content[0];
		if (onlyTextBlocks(result.content) === null) return null;
		const sourceSeq = this.rootToolResultSeq(session, candidate.seq);
		const marker = recoveryMarker(this.sourceRef(session, sourceSeq), "tool result middle pruned");
		let head = this.config.headChars;
		let tail = this.config.tailChars;
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const threshold = head + codePointLength(marker) + tail;
			const content = this.nativePruneContent(result.content, threshold, head, tail, marker);
			if (content !== null) {
				const plan = this.plan(candidate, content, sourceSeq, "native-head-tail", stage, "native-tool-result", void 0, view);
				if (plan !== null && plan.tokensAfter <= policy.nativeTargetTokens) return plan;
			}
			if (head === 0 && tail === 0) break;
			head = Math.floor(head / 2);
			tail = Math.floor(tail / 2);
		}
		return this.planAggregate(candidate, session, view, "native-whole-result", stage, policy.nativeTargetTokens, "native-tool-result");
	}
	/**
	* TokenPilot-inspired A1: replace a byte-identical repeat of an earlier
	* oversized tool result with a pointer to its first occurrence. The first
	* occurrence's hash is always recorded so later repeats can point at the
	* append-only original event even after the surface copy is reduced.
	*/
	planDedupe(candidate, session, policy, view) {
		if (typeof candidate.event.surfaceOp === "object") return null;
		const result = candidate.event.data.message.content[0];
		const text = flattenPlainText(result.content);
		if (text === void 0) return null;
		const tokensBefore = exactTokens(candidate.count);
		if (tokensBefore === void 0 || tokensBefore <= policy.freshTriggerTokens) return null;
		let table = this.dedupeTables.get(session);
		if (table === void 0) {
			table = new DedupeTable();
			this.dedupeTables.set(session, table);
		}
		const hash = dedupeHash(text, "trim-eol");
		const entry = table.get(hash);
		if (entry !== void 0 && entry.seq !== candidate.seq) {
			const placeholder = dedupePlaceholder(entry, codePointLength(text));
			const plan = this.plan(candidate, [{
				type: "text",
				text: placeholder
			}], entry.seq, "dedupe-pointer", "fresh", "fresh", void 0, view, { noNetSavingsGuard: true });
			if (plan !== null) return plan;
			return null;
		}
		if (entry === void 0) table.record(hash, {
			seq: candidate.seq,
			sourceRef: this.sourceRef(session, candidate.seq),
			toolName: candidate.call.name,
			originalChars: codePointLength(text)
		});
		return null;
	}
	planFresh(candidate, session, policy, view) {
		if (typeof candidate.event.surfaceOp === "object") return null;
		const result = candidate.event.data.message.content[0];
		const tokensBefore = exactTokens(candidate.count);
		if (tokensBefore === void 0 || tokensBefore <= policy.freshTriggerTokens) return null;
		const sourceSeq = candidate.seq;
		const sourceRef = this.sourceRef(session, sourceSeq);
		const textBlock = onlyTextBlock(result.content);
		if (textBlock !== null) {
			let budgetChars = Math.max(1, Math.floor(codePointLength(textBlock.text) * .75));
			const codeSkeleton = this.activeSettings(session).codeSkeleton.enabled;
			for (let attempt = 0; attempt < 10; attempt += 1) {
				const output = reduceFreshToolResult({
					toolName: candidate.call.name,
					argumentsText: candidate.call.arguments,
					text: textBlock.text,
					budgetChars,
					sourceRef,
					isError: result.isError === true || candidate.event.data.error !== void 0,
					codeSkeleton
				});
				if (output !== null) {
					const plan = this.plan(candidate, [{
						...textBlock,
						text: output.text
					}], sourceSeq, output.reducer, "fresh", "fresh", void 0, view, { noNetSavingsGuard: policy.presetOptions?.noNetSavingsGuard === true });
					if (plan !== null && plan.tokensAfter <= policy.freshTargetTokens) return plan;
				}
				if (budgetChars === 1) break;
				budgetChars = Math.max(1, Math.floor(budgetChars / 2));
			}
		}
		return this.planAggregate(candidate, session, view, "fresh-whole-result", "fresh", policy.freshTargetTokens, "fresh");
	}
	planAggregate(candidate, session, view, reducer = "fresh-step-aggregate", stage = "fresh", targetTokens, component = "aggregate", historyMode) {
		if (this.isError(candidate)) return this.planErrorEvidence(candidate, session, view, stage, targetTokens, component, historyMode);
		const sourceSeq = this.rootToolResultSeq(session, candidate.seq);
		const sourceRef = this.sourceRef(session, sourceSeq);
		const text = [
			"[Tool result reduced to satisfy the completed-step aggregate budget]",
			`tool: ${candidate.call.name}`,
			`source: ${sourceRef}`,
			"Use context_compression_retrieve with this source if the omitted evidence is necessary."
		].join("\n");
		const plan = this.plan(candidate, [{
			type: "text",
			text
		}], sourceSeq, reducer, stage, component, historyMode, view);
		return plan !== null && (targetTokens === void 0 || plan.tokensAfter <= targetTokens) ? plan : null;
	}
	/** Preserve bounded diagnostic evidence whenever an all-text error is reduced. */
	planErrorEvidence(candidate, session, view, stage, targetTokens, component = "aggregate", historyMode) {
		if (!this.isError(candidate)) return null;
		const result = candidate.event.data.message.content[0];
		const blocks = onlyTextBlocks(result.content);
		if (blocks === null) return null;
		const text = blocks.map((block) => block.text).join("\n");
		const sourceSeq = this.rootToolResultSeq(session, candidate.seq);
		const sourceRef = this.sourceRef(session, sourceSeq);
		const output = historicalPlaceholder({
			toolName: candidate.call.name,
			sourceRef,
			charsBefore: codePointLength(text),
			isError: true,
			text,
			compact: false
		});
		if (!verifyReduction({
			toolName: candidate.call.name,
			argumentsText: candidate.call.arguments,
			text,
			budgetChars: 1200,
			sourceRef,
			isError: true
		}, output)) return null;
		const plan = this.plan(candidate, [{
			type: "text",
			text: output.text
		}], sourceSeq, "error-evidence-placeholder", stage, component, historyMode, view);
		return plan !== null && (targetTokens === void 0 || plan.tokensAfter <= targetTokens) ? plan : null;
	}
	isError(candidate) {
		return candidate.event.data.message.content[0].isError === true || candidate.event.data.error !== void 0;
	}
	historyOutcome(plans) {
		return {
			kind: "planned",
			plans: [...plans]
		};
	}
	planHistoricalAging(session, policy, view) {
		const candidates = this.snapshot(session, view);
		const events = sessionEvents(session);
		const exact = [];
		for (const candidate of candidates) {
			const tokens = exactTokens(candidate.count);
			if (tokens === void 0) {
				this.warnExactUnavailable(session, view, "history");
				return { kind: "exact-tokenizer-unavailable" };
			}
			exact.push(tokens);
		}
		const total = exact.reduce((sum, tokens) => sum + tokens, 0);
		const trigger = policy.historyTriggerTokens;
		const deadline = policy.microDeadlineTokens;
		const lastChance = deadline !== void 0 && view.totalTokens >= deadline;
		if (total <= trigger && !lastChance) return { kind: "below-profile-trigger" };
		const protectedSeqs = this.protectedHistoryCandidateSeqs(candidates, policy);
		const isUnsafe = (candidate) => {
			if (this.isRecoveryExempt(session, candidate)) return true;
			const result = candidate.event.data.message.content[0];
			return onlyTextBlock(result.content)?.text.includes("[Old tool result content cleared from active context]") === true;
		};
		const safe = candidates.filter((candidate) => !isUnsafe(candidate));
		const eligible = safe.filter((candidate) => !protectedSeqs.has(candidate.seq));
		if (eligible.length === 0) return safe.length === 0 ? { kind: "no-safe-candidates" } : { kind: "protected-working-set" };
		const planned = [];
		let reclaim = 0;
		const microTarget = deadline === void 0 ? void 0 : Math.max(0, deadline - policy.historyMinReclaimTokens);
		const required = Math.max(policy.historyMinReclaimTokens, total - trigger, ...microTarget === void 0 ? [] : [view.totalTokens - microTarget]);
		const batchTarget = microTarget === void 0 ? policy.historyMinReclaimTokens : required;
		for (const candidate of eligible) {
			const result = candidate.event.data.message.content[0];
			const block = onlyTextBlock(result.content);
			if (policy.presetOptions?.readState === true && block !== null) {
				const readPath = toolCallPath(candidate.call.arguments);
				const estimatorExpired = this.estimatorVerdicts.get(session)?.get(candidate.seq) === true;
				if (readPath !== void 0 && (isSupersededRead(events, candidate.seq, readPath) || estimatorExpired)) {
					const plan = this.planAggregate(candidate, session, view, "superseded-read-whole-result", "pressure", void 0, "history", policy.historyMode);
					if (plan === null) continue;
					planned.push(plan);
					reclaim += plan.tokensBefore - plan.tokensAfter;
					if (reclaim >= required) break;
					continue;
				}
			}
			const sourceSeq = this.rootToolResultSeq(session, candidate.seq);
			if (block === null) {
				const plan = this.planAggregate(candidate, session, view, "historical-rich-whole-result", "pressure", void 0, "history", policy.historyMode);
				if (plan === null) continue;
				planned.push(plan);
				reclaim += plan.tokensBefore - plan.tokensAfter;
				if (reclaim >= required) break;
				continue;
			}
			const output = historicalPlaceholder({
				toolName: candidate.call.name,
				sourceRef: this.sourceRef(session, sourceSeq),
				charsBefore: codePointLength(block.text),
				isError: result.isError === true || candidate.event.data.error !== void 0,
				text: block.text,
				compact: false
			});
			if (!verifyReduction({
				toolName: candidate.call.name,
				argumentsText: candidate.call.arguments,
				text: block.text,
				budgetChars: 1200,
				sourceRef: this.sourceRef(session, sourceSeq),
				isError: result.isError === true || candidate.event.data.error !== void 0
			}, output)) continue;
			let replacementText = output.text;
			if (policy.presetOptions?.readState === true) {
				const omitted = countOmittedLines(block.text, output.text);
				const census = omitted === void 0 ? void 0 : clusterOmittedLines(block.text, omitted);
				if (census !== void 0) replacementText = `${output.text}
[... ${census} ...]`;
			}
			const plan = this.plan(candidate, [{
				...block,
				text: replacementText
			}], sourceSeq, output.reducer, "pressure", "history", policy.historyMode, view);
			if (plan === null) continue;
			planned.push(plan);
			reclaim += plan.tokensBefore - plan.tokensAfter;
			if (reclaim >= required) break;
		}
		if (reclaim >= batchTarget && planned.length > 0) return this.historyOutcome(planned);
		return lastChance ? {
			kind: "cannot-reach-deadline-target",
			reclaim,
			required
		} : {
			kind: "insufficient-reclaim",
			reclaim,
			required
		};
	}
	protectedHistoryResultSeqs(session, policy, view) {
		const candidates = this.snapshot(session, view);
		if (candidates.some((candidate) => exactTokens(candidate.count) === void 0)) return null;
		return this.protectedHistoryCandidateSeqs(candidates, policy);
	}
	/** Select the newest completed tool calls and token tail for History-derived stages. */
	protectedHistoryCandidateSeqs(candidates, policy) {
		const protectedSeqs = /* @__PURE__ */ new Set();
		for (let index = candidates.length - 1; index >= 0 && candidates.length - index <= policy.historyKeepRecentToolCalls; index--) {
			const candidate = candidates[index];
			if (candidate !== void 0) protectedSeqs.add(candidate.seq);
		}
		let recentTokens = 0;
		for (let index = candidates.length - 1; index >= 0 && recentTokens < policy.historyKeepRecentTokens; index--) {
			const candidate = candidates[index];
			if (candidate === void 0) continue;
			protectedSeqs.add(candidate.seq);
			recentTokens += exactTokens(candidate.count) ?? 0;
		}
		return protectedSeqs;
	}
	/** Atomically replace at most one oldest safe completed tool-call group. */
	landOldestTailTrimGroup(session, policy, view) {
		const tailTrim = policy.tailTrim;
		if (tailTrim?.enabled !== true) return;
		const events = sessionEvents(session);
		if (view.currentSurface.kind !== "exact-tokenizer" || view.currentSurface.tokens <= tailTrim.triggerTokens) {
			if (view.currentSurface.kind !== "exact-tokenizer") this.warnExactUnavailable(session, view, "tailtrim");
			this.auditComponent(session, policy, "tail-trim", "pressure", "skipped", view.currentSurface.kind !== "exact-tokenizer" ? "exact-tokenizer-unavailable" : "at-or-below-trigger", {
				measurementKind: view.currentSurface.kind,
				...view.currentSurface.kind === "exact-tokenizer" ? { currentTokens: view.currentSurface.tokens } : {},
				triggerTokens: tailTrim.triggerTokens
			});
			return;
		}
		const surfaceCount = view.currentSurface;
		if (!this.hasRecoveryTool(session)) {
			this.auditComponent(session, policy, "tail-trim", "pressure", "skipped", "recovery-tool-unavailable", {
				measurementKind: "exact-tokenizer",
				currentTokens: surfaceCount.tokens,
				triggerTokens: tailTrim.triggerTokens
			});
			return;
		}
		if (!this.hasOpenTurn(session)) {
			this.auditComponent(session, policy, "tail-trim", "pressure", "skipped", "no-open-turn", {
				measurementKind: "exact-tokenizer",
				currentTokens: surfaceCount.tokens,
				triggerTokens: tailTrim.triggerTokens
			});
			return;
		}
		const protectedResults = this.protectedHistoryResultSeqs(session, policy, view);
		if (protectedResults === null) {
			this.auditComponent(session, policy, "tail-trim", "pressure", "skipped", "exact-tokenizer-unavailable-in-protected-set", {
				measurementKind: "unavailable",
				currentTokens: surfaceCount.tokens,
				triggerTokens: tailTrim.triggerTokens
			});
			return;
		}
		const measured = new Map(view.measuredNodes.map((node) => [node.seq, node.count]));
		const heuristic = new Map(view.nodes.map((node) => [node.seq, node.tokens]));
		const completedTurns = /* @__PURE__ */ new Set();
		const completedSteps = /* @__PURE__ */ new Set();
		for (const event of events) if (event.type === "turn/end") completedTurns.add(event.data.turn);
		else if (event.type === "step/end") completedSteps.add(`${String(event.data.turn)}:${String(event.data.step)}`);
		const firstCompletedSurfaceTurn = session.surface.nodes.map((seq) => events[seq]).filter((event) => (event?.type === "assistant/message" || event?.type === "tool/result") && completedTurns.has(event.data.turn)).reduce((first, event) => first === void 0 ? event.data.turn : Math.min(first, event.data.turn), void 0);
		const nodes = [...session.surface.nodes];
		for (let index = 0; index < nodes.length; index++) {
			const assistantSeq = nodes[index];
			if (assistantSeq === void 0) continue;
			const assistant = events[assistantSeq];
			if (assistant?.type !== "assistant/message" || assistant.data.interrupted === true || assistant.data.message.content.length === 0 || assistant.data.message.content.some((block) => block.type !== "tool-call") || assistant.data.turn === firstCompletedSurfaceTurn || !completedTurns.has(assistant.data.turn) || !completedSteps.has(`${String(assistant.data.turn)}:${String(assistant.data.step)}`)) continue;
			const calls = assistant.data.message.content;
			if (calls.some((call) => call.name === "context_compression_retrieve")) continue;
			const callIds = calls.map((call) => String(call.id));
			if (new Set(callIds).size !== callIds.length) continue;
			const resultSeqs = nodes.slice(index + 1, index + 1 + calls.length);
			if (resultSeqs.length !== calls.length || resultSeqs.some((seq) => protectedResults.has(seq))) continue;
			const results = resultSeqs.map((seq) => events[seq]);
			if (results.some((event) => {
				if (event?.type !== "tool/result" || event.data.turn !== assistant.data.turn || event.data.step !== assistant.data.step || event.data.error !== void 0) return true;
				const block = event.data.message.content[0];
				if (block.isError === true) return true;
				return block.content.some((contentBlock) => contentBlock.type !== "text");
			})) continue;
			const next = events[nodes[index + 1 + calls.length] ?? -1];
			if (next?.type === "tool/result" && next.data.turn === assistant.data.turn && next.data.step === assistant.data.step) continue;
			const resultIds = results.map((event) => event?.type === "tool/result" ? String(event.data.message.source.callId) : "");
			if (new Set(resultIds).size !== resultIds.length || resultIds.some((id, resultIndex) => id !== callIds[resultIndex])) continue;
			const shadowedSeqs = [assistantSeq, ...resultSeqs];
			const roots = shadowedSeqs.map((seq) => this.uniqueAppendRoot(session, seq));
			if (roots.some((root) => root === null)) continue;
			const sourceEventSeqs = roots;
			if (new Set(sourceEventSeqs).size !== sourceEventSeqs.length) continue;
			const counts = shadowedSeqs.map((seq) => measured.get(seq));
			if (counts.some((count) => count?.kind !== "exact-tokenizer")) continue;
			const exactCounts = counts;
			if (exactCounts.some((count) => count.tokenizerId !== surfaceCount.tokenizerId || count.tokenizerRevision !== surfaceCount.tokenizerRevision)) continue;
			const tokensBefore = exactCounts.reduce((sum, count) => sum + count.tokens, 0);
			const manifestSeq = events.length;
			const ref = tailTrimRef(String(session.id), manifestSeq);
			const stub = tailTrimStub(ref, calls.map((call) => call.name), sourceEventSeqs);
			if (stub === null) continue;
			const stubCount = countExactCanonicalTextFields([stub], (candidate) => view.countCanonicalText(candidate), "TailTrim group stub");
			if (stubCount.kind !== "exact-tokenizer" || stubCount.tokenizerId !== surfaceCount.tokenizerId || stubCount.tokenizerRevision !== surfaceCount.tokenizerRevision || stubCount.tokens <= 0 || tokensBefore - stubCount.tokens < policy.historyMinReclaimTokens) continue;
			const heuristicTokens = shadowedSeqs.reduce((sum, seq) => sum + (heuristic.get(seq) ?? 0), 0);
			const range = {
				start: assistantSeq,
				end: resultSeqs.at(-1) ?? assistantSeq
			};
			if (!this.reserveTailTrimBoundaryAttempt(session)) {
				this.auditComponent(session, policy, "tail-trim", "pressure", "skipped", "already-attempted-at-request-boundary", {
					measurementKind: "exact-tokenizer",
					currentTokens: surfaceCount.tokens,
					triggerTokens: tailTrim.triggerTokens
				});
				return;
			}
			const manifest = session.append("compaction/prune", {
				shadowedRange: range,
				shadowedSeqs,
				shadowedTokenCount: heuristicTokens
			});
			let replacement;
			try {
				replacement = session.append("user/message", tailTrimMessage(stub), {
					surfaceOp: {
						op: "replace",
						...range
					},
					sourceEventSeqs: [manifest.seq, ...shadowedSeqs]
				});
			} catch (error) {
				this.auditPublicationFailure(session, "pressure", "tail-trim", manifest.seq, error);
				return;
			}
			emitCompressionAudit(this.ctx.logger, {
				schemaVersion: 1,
				kind: "rewrite",
				sessionId: String(session.id),
				profile: policy.profile,
				component: "tail-trim",
				stage: "pressure",
				reducer: "pair-preserving-tail-trim",
				manifestEventType: "compaction/prune",
				manifestSeq: manifest.seq,
				replacementSeq: replacement.seq,
				sourceSeqs: sourceEventSeqs,
				tokensBefore,
				tokensAfter: stubCount.tokens,
				tokensRemoved: tokensBefore - stubCount.tokens,
				tokenizerId: stubCount.tokenizerId,
				tokenizerRevision: stubCount.tokenizerRevision
			});
			return;
		}
		this.auditComponent(session, policy, "tail-trim", "pressure", "skipped", "no-safe-eligible-tool-group", {
			measurementKind: "exact-tokenizer",
			currentTokens: surfaceCount.tokens,
			triggerTokens: tailTrim.triggerTokens
		});
	}
	reserveTailTrimBoundaryAttempt(session) {
		const boundary = this.activeRequestBoundaries.get(session);
		if (boundary === void 0) return true;
		if (this.tailTrimBoundaryAttempts.get(session) === boundary) return false;
		this.tailTrimBoundaryAttempts.set(session, boundary);
		return true;
	}
	uniqueAppendRoot(session, seq) {
		const events = sessionEvents(session);
		const pending = [{
			seq,
			depth: 0
		}];
		const visited = /* @__PURE__ */ new Set();
		const roots = /* @__PURE__ */ new Set();
		while (pending.length > 0) {
			const next = pending.pop();
			if (next === void 0 || next.depth > 64 || visited.has(next.seq)) continue;
			visited.add(next.seq);
			if (visited.size > 64) return null;
			const event = events[next.seq];
			if (event === void 0 || event.type !== "assistant/message" && event.type !== "tool/result") return null;
			if (event.surfaceOp === "append") roots.add(event.seq);
			else if (typeof event.surfaceOp === "object") {
				const sources = event.sourceEventSeqs;
				if (sources === void 0 || sources.length === 0) return null;
				for (const source of sources) pending.push({
					seq: source,
					depth: next.depth + 1
				});
			} else return null;
			if (roots.size > 1) return null;
		}
		return roots.size === 1 ? [...roots][0] ?? null : null;
	}
	plan(candidate, content, sourceSeq, reducer, stage, component, historyMode, view, options = {}) {
		const countBefore = candidate.count;
		if (countBefore.kind !== "exact-tokenizer") return null;
		const countAfter = countToolContent(content, view);
		if (countAfter.kind !== "exact-tokenizer" || countAfter.tokenizerId !== countBefore.tokenizerId || countAfter.tokenizerRevision !== countBefore.tokenizerRevision) return null;
		const tokensBefore = countBefore.tokens;
		const tokensAfter = countAfter.tokens;
		if (tokensAfter <= 0 || tokensAfter >= tokensBefore) return null;
		if (options.noNetSavingsGuard === true) {
			const originalBlocks = onlyTextBlocks(candidate.event.data.message.content[0].content);
			const replacementBlocks = onlyTextBlocks(content);
			if (originalBlocks !== null && replacementBlocks !== null) {
				const originalChars = originalBlocks.reduce((sum, block) => sum + codePointLength(block.text), 0);
				if (replacementBlocks.reduce((sum, block) => sum + codePointLength(block.text), 0) >= originalChars) return null;
			}
		}
		const charsBefore = candidate.characterPressure;
		const charsAfter = this.pressureCost(content);
		return {
			candidate,
			content,
			sourceSeq,
			reducer,
			stage,
			component,
			...historyMode === void 0 ? {} : { historyMode },
			charsBefore,
			charsAfter,
			tokensBefore,
			tokensAfter,
			tokenizerId: countBefore.tokenizerId,
			tokenizerRevision: countBefore.tokenizerRevision
		};
	}
	land(session, plan) {
		const { candidate } = plan;
		const result = candidate.event.data.message.content[0];
		const message = freezeMessage({
			...candidate.event.data.message,
			content: [{
				...result,
				content: plan.content
			}]
		});
		const manifest = session.append("compaction/prune", {
			shadowedRange: {
				start: candidate.seq,
				end: candidate.seq
			},
			shadowedSeqs: [candidate.seq],
			shadowedTokenCount: candidate.shadowedHeuristicTokenCount
		});
		let replacement;
		try {
			replacement = session.append("tool/result", {
				...candidate.event.data,
				message
			}, {
				surfaceOp: {
					op: "replace",
					start: candidate.seq,
					end: candidate.seq
				},
				sourceEventSeqs: [candidate.seq]
			});
		} catch (error) {
			this.auditPublicationFailure(session, plan.stage, plan.component, manifest.seq, error);
			return null;
		}
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "rewrite",
			sessionId: String(session.id),
			profile: this.activeSettings(session).profile,
			component: plan.component,
			stage: plan.stage,
			reducer: plan.reducer,
			...plan.historyMode === void 0 ? {} : { historyMode: plan.historyMode },
			manifestEventType: "compaction/prune",
			manifestSeq: manifest.seq,
			replacementSeq: replacement.seq,
			sourceSeqs: [plan.sourceSeq],
			tokensBefore: plan.tokensBefore,
			tokensAfter: plan.tokensAfter,
			tokensRemoved: plan.tokensBefore - plan.tokensAfter,
			tokenizerId: plan.tokenizerId,
			tokenizerRevision: plan.tokenizerRevision
		});
		return {
			originalSeq: candidate.seq,
			sourceSeq: plan.sourceSeq,
			replacementSeq: replacement.seq,
			callId: candidate.event.data.message.source.callId,
			reducer: plan.reducer,
			stage: plan.stage,
			charsBefore: plan.charsBefore,
			charsAfter: plan.charsAfter,
			tokensBefore: plan.tokensBefore,
			tokensAfter: plan.tokensAfter
		};
	}
	landAll(session, plans) {
		if (plans.length === 0) return [];
		if (!this.hasRecoveryTool(session)) {
			this.warnOnce(session, "missing-context-retrieve", "context-compression kept original tool results because context_compression_retrieve is unavailable");
			return [];
		}
		if (!this.hasOpenTurn(session)) throw new Error("tool-result pruning cannot append a surface replacement outside any open turn");
		const landed = [];
		for (const plan of plans) {
			const entry = this.land(session, plan);
			if (entry === null) break;
			landed.push(entry);
		}
		return landed;
	}
	hasRecoveryTool(session) {
		const tools = this.ctx.get("tools");
		if (tools === void 0) return false;
		const agent = this.ctx.get("agents")?.get(session.id);
		return tools.get("context_compression_retrieve", agent) !== void 0;
	}
	auditHistoryEvaluation(session, policy, view, allowed, outcome) {
		if (policy.historyMode === "disabled") {
			this.auditComponent(session, policy, "history", "pressure", "disabled", "profile-policy", { historyMode: policy.historyMode });
			return;
		}
		if (!allowed && outcome.kind === "planned") {
			const deadlineTrigger = policy.microDeadlineTokens;
			const capacity = deadlineTrigger === void 0 ? session.requestContext()?.contextWindow : void 0;
			const capacityTrigger = deadlineTrigger !== void 0 ? deadlineTrigger : Number.isSafeInteger(capacity) && capacity !== void 0 && capacity > 0 ? Math.floor(capacity * CAPACITY_PRESSURE_RATIO) : void 0;
			this.auditComponent(session, policy, "history", "pressure", "skipped", policy.historyMode === "capacity-pressure" ? "below-micro-deadline" : "adaptive-cost-rejected", {
				historyMode: policy.historyMode,
				measurementKind: view.currentSurface.kind,
				currentTokens: view.totalTokens,
				...capacityTrigger === void 0 ? {} : { triggerTokens: capacityTrigger }
			});
			return;
		}
		const deadline = policy.microDeadlineTokens;
		const lastChance = deadline !== void 0 && view.totalTokens >= deadline;
		const detail = (extra = {}) => ({
			historyMode: policy.historyMode,
			measurementKind: outcome.kind === "exact-tokenizer-unavailable" ? "unavailable" : "exact-tokenizer",
			currentTokens: view.totalTokens,
			...outcome.kind === "insufficient-reclaim" || outcome.kind === "cannot-reach-deadline-target" ? {
				reclaimTokens: outcome.reclaim,
				requiredTokens: outcome.required
			} : {},
			...extra
		});
		switch (outcome.kind) {
			case "exact-tokenizer-unavailable":
				this.auditComponent(session, policy, "history", "pressure", "skipped", "exact-tokenizer-unavailable", detail({ triggerTokens: policy.historyTriggerTokens }));
				return;
			case "below-profile-trigger":
				this.auditComponent(session, policy, "history", "pressure", "skipped", "below-profile-trigger", detail({ triggerTokens: policy.historyTriggerTokens }));
				return;
			case "no-safe-candidates":
				this.auditComponent(session, policy, "history", "pressure", "skipped", "no-safe-candidates", detail({ triggerTokens: policy.historyTriggerTokens }));
				return;
			case "protected-working-set":
				this.auditComponent(session, policy, "history", "pressure", "skipped", "protected-working-set", detail({ triggerTokens: policy.historyTriggerTokens }));
				return;
			case "insufficient-reclaim":
				this.auditComponent(session, policy, "history", "pressure", "skipped", "insufficient-reclaim", detail({ triggerTokens: policy.historyTriggerTokens }));
				return;
			case "cannot-reach-deadline-target":
				this.auditComponent(session, policy, "history", "pressure", "skipped", "cannot-reach-deadline-target", detail(lastChance ? { triggerTokens: deadline } : {}));
				return;
			case "planned":
				this.auditComponent(session, policy, "history", "pressure", "skipped", outcome.plans.length > 0 ? "recovery-tool-unavailable" : "insufficient-reclaim", detail({ triggerTokens: lastChance ? deadline : policy.historyTriggerTokens }));
				return;
			/* v8 ignore next -- closed-union exhaustiveness guard */
			default: return assertNever(outcome, "history plan outcome");
		}
	}
	auditComponent(session, policy, component, stage, status, reason, detail = {}) {
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "component-evaluation",
			sessionId: String(session.id),
			profile: policy.profile,
			component,
			stage,
			status,
			reason,
			...detail
		});
	}
	auditFailure(session, stage, operation, error) {
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "failure",
			sessionId: String(session.id),
			stage,
			operation,
			errorName: error instanceof Error ? error.name : "UnknownError",
			errorMessage: error instanceof Error ? error.message : String(error)
		});
	}
	auditPublicationFailure(session, stage, component, manifestSeq, error) {
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "failure",
			sessionId: String(session.id),
			stage,
			operation: "publication",
			component,
			manifestSeq,
			errorName: error instanceof Error ? error.name : "UnknownError",
			errorMessage: "surface replacement append failed after compaction/prune committed"
		});
	}
	warnExactUnavailable(session, view, gate) {
		const provider = view.providerRoute ?? "unbound-provider";
		const model = view.modelId ?? "unbound-model";
		this.warnOnce(session, `exact-tokenizer:${gate}:${provider}\0${model}`, "context-compression %s kept original tool results because exact tokenizer counts are unavailable for %s/%s", gate, provider, model);
	}
	warnOnce(session, key, message, ...args) {
		let warned = this.warnedFailures.get(session);
		if (warned === void 0) {
			warned = /* @__PURE__ */ new Set();
			this.warnedFailures.set(session, warned);
		}
		if (warned.has(key)) return;
		warned.add(key);
		this.ctx.logger.warn(message, ...args);
	}
	/** Surface replacements are durable turn work; reject before writing the audit half. */
	hasOpenTurn(session) {
		let open = false;
		for (const event of sessionEvents(session)) if (event.type === "turn/start") open = true;
		else if (event.type === "turn/end") open = false;
		return open;
	}
	rootToolResultSeq(session, seq) {
		const events = sessionEvents(session);
		let current = seq;
		const seen = /* @__PURE__ */ new Set();
		while (!seen.has(current)) {
			seen.add(current);
			const event = events[current];
			if (event?.type !== "tool/result" || typeof event.surfaceOp !== "object") return current;
			const previous = event.sourceEventSeqs?.[0];
			if (previous === void 0) return current;
			current = previous;
		}
		return seq;
	}
	sourceRef(session, seq) {
		return `session://${session.id}/event/${String(seq)}`;
	}
	nativePruneContent(blocks, thresholdChars, headChars, tailChars, marker = PRUNE_MARKER) {
		const totalChars = this.measureContent(blocks);
		if (totalChars <= thresholdChars) return null;
		const markerChars = codePointLength(marker);
		const safeHead = Math.max(0, Math.min(headChars, thresholdChars - markerChars));
		const safeTail = Math.max(0, Math.min(tailChars, thresholdChars - markerChars - safeHead));
		const removedStart = safeHead;
		const removedEnd = totalChars - safeTail;
		const pruned = [];
		let consumed = 0;
		let markerInserted = false;
		for (const block of blocks) {
			if (block.type !== "text") {
				pruned.push(block);
				continue;
			}
			const points = Array.from(block.text);
			const blockStart = consumed;
			const blockEnd = blockStart + points.length;
			const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart));
			const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart));
			const insertion = blockStart < removedEnd && blockEnd > removedStart && !markerInserted ? marker : "";
			if (insertion !== "") markerInserted = true;
			const text = points.slice(0, headEnd).join("") + insertion + points.slice(tailStart).join("");
			if (text !== "") pruned.push({
				...block,
				text
			});
			consumed = blockEnd;
		}
		if (!markerInserted) return null;
		const charsAfter = this.measureContent(pruned);
		return charsAfter <= thresholdChars && charsAfter < totalChars ? pruned : null;
	}
};
function onlyTextBlock(blocks) {
	return blocks.length === 1 && blocks[0]?.type === "text" ? blocks[0] : null;
}
function onlyTextBlocks(blocks) {
	return blocks.every((block) => block.type === "text") ? blocks : null;
}
function countToolContent(blocks, view) {
	const text = onlyTextBlocks(blocks);
	if (text === null) return unavailableCount("tool result contains unsupported rich content");
	return countExactCanonicalTextFields(text.map((block) => block.text), (candidate) => view.countCanonicalText(candidate), "tool result replacement");
}
function exactTokens(count) {
	return count.kind === "exact-tokenizer" ? count.tokens : void 0;
}
function sameProviderMeasurementKey(left, right) {
	return left.provider === right.provider && left.baseUrlClass === right.baseUrlClass && left.apiRoute === right.apiRoute && left.modelId === right.modelId && left.requestTemplateRevision === right.requestTemplateRevision && left.tokenizerRevision === right.tokenizerRevision && left.modality === right.modality;
}
function unavailableCount(reason) {
	return Object.freeze({
		kind: "unavailable",
		reason
	});
}
function recoveryMarker(sourceRef, label) {
	return `\n\n[... ${label}; source=${sourceRef}; use context_compression_retrieve if needed ...]\n\n`;
}
function summarize(entries) {
	return {
		pruned: entries,
		charsRemoved: entries.reduce((sum, entry) => sum + entry.charsBefore - entry.charsAfter, 0),
		tokensRemoved: entries.reduce((sum, entry) => sum + entry.tokensBefore - entry.tokensAfter, 0)
	};
}
function emptyResult() {
	return {
		pruned: [],
		charsRemoved: 0,
		tokensRemoved: 0
	};
}
//#endregion
export { AUTO_COMPACT_THRESHOLD_LIMITS, COMPRESSION_PROFILES, CONTEXT_COMPRESSION_SETTINGS_NAMESPACE, ContextCompressionSettingsSchema, CustomCompressionPolicySchema, DEFAULTS, DEFAULT_CUSTOM_COMPRESSION_POLICY, PRUNE_MARKER, ToolResultPruner, ToolResultPruner as default, codePointLength, historicalPlaceholder, isCompressionProfile, isValidAutoCompactThresholdPercent, measureForCompaction, normalizeTerminalText, parseContextCompressionSettings, reduceFreshToolResult, resolveConfig, resolveCustomPolicy, resolvePolicy, verifyReduction };
