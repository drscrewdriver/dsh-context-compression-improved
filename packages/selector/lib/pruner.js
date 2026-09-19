import { _ as DEFAULT_CUSTOM_COMPRESSION_POLICY, a as AUTO_COMPACT_THRESHOLD_LIMITS, b as deepFreeze, c as DEFAULTS, d as isCompressionProfile, f as isValidAutoCompactThresholdPercent, g as CustomCompressionPolicySchema, h as resolvePolicy, i as ReviewQueue, l as PRUNE_MARKER, m as resolveConfig, o as CONTEXT_COMPRESSION_SETTINGS_NAMESPACE, p as parseContextCompressionSettings, r as sharedReviewStore, s as ContextCompressionSettingsSchema, t as registerReviewPruner, u as codePointLength, v as resolveCustomPolicy, x as COMPRESSION_PROFILES, y as assertNever } from "./review-registry.js";
import { a as validatePublishedTailTrim, i as tailTrimStub, n as tailTrimMessage, o as eventBySeq, r as tailTrimRef, s as sessionEvents, t as parseTailTrimRef } from "./tail-trim.js";
import z from "@deepseek-ai/schemastery";
import { createHash } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import { createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm";
import { SessionSeq, deriveEventMessage } from "@deepseek-ai/dsh-session";
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
//#region src/runtime/deepseek-v4-vision-tokens.ts
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
//#region src/runtime/token-count.ts
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
//#region src/runtime/measurement.ts
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
	const eventsBySeq = new Map(events.map((event) => [Number(event.seq), event]));
	const measuredNodes = measurement.nodes.map((node) => {
		const event = eventsBySeq.get(Number(node.seq));
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
/** Count the lines present in the original but absent from the replacement. */
function countOmittedLines(original, replacement) {
	const omitted = original.split("\n").length - replacement.split("\n").length;
	return omitted > 0 ? omitted : void 0;
}
/** Routed-context utilization required before capacity-pressure History may age sent history. */
const CAPACITY_PRESSURE_RATIO = .7;
//#endregion
//#region src/pruner/content.ts
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
function recoveryMarker(sourceRef, label, startLine) {
	return `\n\n[... ${label}; source=${sourceRef}; ${startLine === void 0 ? "use context_compression_retrieve if needed" : `retrieve with context_compression_retrieve({"ref":"${sourceRef}","start_line":${String(startLine)},"max_lines":80})`} ...]\n\n`;
}
/**
* Measure text content in Unicode code points; non-text blocks cost zero.
* @param blocks - tool-result content to measure.
* @returns total Unicode code points across text blocks.
*/
function measureContent(blocks) {
	let chars = 0;
	for (const block of blocks) if (block.type === "text") chars += codePointLength(block.text);
	return chars;
}
function pressureCost(blocks) {
	let cost = 0;
	for (const block of blocks) switch (block.type) {
		case "text":
		case "reasoning":
			cost += codePointLength(block.text);
			break;
		case "tool-call":
			cost += 256 + codePointLength(block.name) + codePointLength(block.arguments);
			break;
		case "tool-result":
			cost += 256 + pressureCost(block.content);
			break;
		default: {
			const serialized = JSON.stringify(block);
			cost += Math.max(256, codePointLength(serialized));
		}
	}
	return cost;
}
function nativePruneContent(blocks, thresholdChars, headChars, tailChars, marker = PRUNE_MARKER) {
	const totalChars = measureContent(blocks);
	if (totalChars <= thresholdChars) return null;
	const markerChars = codePointLength(typeof marker === "function" ? marker(1) : marker);
	const safeHead = Math.max(0, Math.min(headChars, thresholdChars - markerChars));
	const safeTail = Math.max(0, Math.min(tailChars, thresholdChars - markerChars - safeHead));
	const removedStart = safeHead;
	const removedEnd = totalChars - safeTail;
	const pruned = [];
	let consumed = 0;
	let markerInserted = false;
	let newlinesBefore = 0;
	for (const block of blocks) {
		if (block.type !== "text") {
			pruned.push(block);
			newlinesBefore += 1;
			continue;
		}
		const points = Array.from(block.text);
		const blockStart = consumed;
		const blockEnd = blockStart + points.length;
		const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart));
		const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart));
		const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart;
		const headText = points.slice(0, headEnd).join("");
		const insertion = intersectsRemoved && !markerInserted && typeof marker === "function" ? marker(1 + newlinesBefore + headText.split("\n").length - 1) : intersectsRemoved && !markerInserted ? marker : "";
		if (insertion !== "") markerInserted = true;
		const text = points.slice(0, headEnd).join("") + insertion + points.slice(tailStart).join("");
		if (text !== "") pruned.push({
			...block,
			text
		});
		newlinesBefore += block.text.split("\n").length - 1 + 1;
		consumed = blockEnd;
	}
	if (!markerInserted) return null;
	const charsAfter = measureContent(pruned);
	return charsAfter <= thresholdChars && charsAfter < totalChars ? pruned : null;
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
//#region src/pruner/session.ts
/** Check whether the session currently has an open (unterminated) turn. */
function hasOpenTurn(session) {
	let open = false;
	for (const event of sessionEvents(session)) if (event.type === "turn/start") open = true;
	else if (event.type === "turn/end") open = false;
	return open;
}
/** Walk the tool-result source chain to find the root result seq. */
function rootToolResultSeq(session, seq) {
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
/** Build a session:// event reference string for a given seq. */
function sourceRef(session, seq) {
	return `session://${session.id}/event/${String(seq)}`;
}
/** Find the latest completed step number for a given turn. */
function latestCompletedToolStep(session, turn) {
	let latest;
	for (const event of sessionEvents(session)) if (event.type === "step/end" && event.data.turn === turn) latest = event.data.step;
	return latest;
}
/** Routed provider/model when the durable request header names one route. */
function routeAuditFact(session) {
	const header = session.requestHeader()?.config;
	if (header === void 0 || header.provider.length === 0 || header.model.length === 0) return void 0;
	return {
		provider: header.provider,
		model: header.model
	};
}
/** Bundled tokenizer identity for one route, when the route is eligible. */
function tokenizerAuditFact(route) {
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
/** Check whether a snapshot candidate represents an error result. */
function isError(candidate) {
	return candidate.event.data.message.content[0].isError === true || candidate.event.data.error !== void 0;
}
/** Wrap a plan list into a HistoryPlanOutcome. */
function historyOutcome(plans) {
	return {
		kind: "planned",
		plans: [...plans]
	};
}
//#endregion
//#region src/runtime/tokenpilot/locator.ts
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
			"(Use `read <spill file>` or `context_compression_retrieve` with a `session://` source — pass start_line/max_lines to window the text — to restore exact text.)"
		].join("\n"),
		spillFiles: spillFiles.size,
		touchedFiles: touchedFiles.size
	};
}
//#endregion
//#region src/runtime/toolclass.ts
/** task_11 (AD3): exact-token matching, no substring hits. */
const TOKEN_SEPARATOR = /[-_/]+/;
/** Multi-token names that must match as a whole word, not as a token. */
const READ_NAMES = /* @__PURE__ */ new Set(["open_file"]);
const READ_TOKENS = /* @__PURE__ */ new Set([
	"read",
	"cat",
	"view"
]);
const SHELL_TOKENS = /* @__PURE__ */ new Set([
	"shell",
	"bash",
	"pwsh",
	"powershell",
	"terminal",
	"exec",
	"command"
]);
const SEARCH_TOKENS = /* @__PURE__ */ new Set([
	"grep",
	"rg",
	"ripgrep"
]);
const PATH_LISTING_TOKENS = /* @__PURE__ */ new Set([
	"glob",
	"tree",
	"ls",
	"fd",
	"find"
]);
const SEARCH_COMMAND_PATTERN = /(?:^|\s)(?:rg|grep|ripgrep)\s/;
const PATH_COMMAND_PATTERN = /(?:^|\s)(?:find|fd|ls|tree)\s/;
/** grep-style hit line: `path:line[:column][: content]`. */
const PATH_LINE_CONTENT_PATTERN = /^(.*?):(\d+)(?::\d+)?(?::|\s+-\s+)(.*)$/;
/**
* Classify a tool result's source.
* @param name - raw tool name (case-insensitive).
* @param command - extracted command argument, '' when absent.
* @param text - result text; enables the C13/C14 content fallback for names
*   that no whitelist (and no command hit) claims.
* @returns the tool source class.
*/
function classifyToolSource(name, command, text) {
	const lowered = name.toLowerCase();
	const tokens = lowered.split(TOKEN_SEPARATOR).filter((token) => token !== "");
	if (tokens.includes("mcp")) return "generic";
	const byName = classifyByName(lowered, tokens);
	if (byName !== "generic") return byName;
	const byCommand = classifyByCommand(command);
	if (byCommand !== "generic") return byCommand;
	return text === void 0 ? "generic" : classifyByContent(text);
}
function classifyByName(lowered, tokens) {
	if (READ_NAMES.has(lowered) || tokens.some((token) => READ_TOKENS.has(token))) return "read";
	if (tokens.some((token) => SHELL_TOKENS.has(token))) return "shell";
	if (tokens.some((token) => SEARCH_TOKENS.has(token))) return "search";
	if (tokens.some((token) => PATH_LISTING_TOKENS.has(token))) return "path-listing";
	return "generic";
}
function classifyByCommand(command) {
	if (command === "") return "generic";
	if (SEARCH_COMMAND_PATTERN.test(command)) return "search";
	if (PATH_COMMAND_PATTERN.test(command)) return "path-listing";
	return "generic";
}
/** A path-shaped hit locator needs a path-looking prefix, not just `:digits`. */
function looksLikeFilePath(prefix) {
	if (prefix.includes("://")) return false;
	return prefix.includes("/") || prefix.includes("\\") || /\.[A-Za-z0-9]{1,8}$/.test(prefix);
}
/** A bare path: no whitespace, no URL scheme, with a separator or an extension. */
function isPurePathLine(line) {
	if (/\s/.test(line) || line.includes("://")) return false;
	return line.includes("/") || line.includes("\\") || /\.[A-Za-z0-9]{1,8}$/.test(line);
}
/**
* Content fallback (C13/C14) for unknown names: one path-plausible
* `path:line:content` line reads as grep output; a body of ≥80% pure paths
* reads as a directory listing. Both require file-path evidence so prose
* (`Note: 2024 - ...`) and URLs (`https://host:8080 - ...`) stay generic.
*/
function classifyByContent(text) {
	let nonEmpty = 0;
	let purePaths = 0;
	let pathLineHits = 0;
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		nonEmpty += 1;
		const match = PATH_LINE_CONTENT_PATTERN.exec(line);
		if (match !== null && looksLikeFilePath(match[1] ?? "")) pathLineHits += 1;
		if (isPurePathLine(line)) purePaths += 1;
	}
	if (pathLineHits >= 1) return "search";
	if (nonEmpty >= 4 && purePaths / nonEmpty >= .8) return "path-listing";
	return "generic";
}
//#endregion
//#region src/runtime/reducers.ts
/** Deterministic, evidence-backed reducers for fresh tool results. */
/** Ranked-first ordering: ranked ids keep their rank, the rest append in order. */
function rankedFirst(items, ranking) {
	if (ranking === void 0 || ranking.length === 0) return items;
	const ranked = /* @__PURE__ */ new Map();
	for (const id of ranking) {
		const found = items.find((item) => item.id === id);
		if (found !== void 0 && !ranked.has(id)) ranked.set(id, found);
	}
	return [...ranked.values(), ...items.filter((item) => !ranked.has(item.id))];
}
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
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+\S/;
const LIST_ITEM_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const TABLE_ROW_PATTERN = /^\s*\|/;
const FENCE_PATTERN = /^\s*(?:```|~~~)/;
const UUID_PATTERN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{64,}\b/g;
const LONG_BASE64_PATTERN = /[A-Za-z0-9+/]{200,}={0,2}/g;
const HTML_TAG_PATTERN = /<!DOCTYPE html|<html\b|<head\b|<div\b|<span\b|<script\b|<style\b|<body\b|<p>|<table\b|<a\s/i;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const HTML_DROPPED_ELEMENTS = /<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_DATA_URI_PATTERN = /\s(?:src|href)="data:[^"]*"/gi;
const HTML_TAG_PATTERN_FULL = /<([a-z][a-z0-9]*)((?:\s[^<>]*?)?)\/?>/gi;
const HTML_INLINE_TAG_PATTERN = /<\/?(?:em|strong|b|i|u|s|code|small|sub|sup|span|br)\b[^<>]*>/gi;
const HTML_WHITELISTED_ATTRIBUTES = /\s(?:href|src|alt|title|id)="[^"]*"/gi;
const ADJACENT_REPEAT_MARKER = "[previous line repeated";
/** Non-adjacent folding only pays off once a line recurs enough to beat the marker cost. */
const NON_ADJACENT_FOLD_THRESHOLD = 3;
/** Read-output line-number gutter added unconditionally by the host's `formatReadOutput`. */
const READ_GUTTER_PATTERN = /^(\d+): ?/;
/**
* Block-level read-gutter detection (GF-1). The host prefixes read output with
* `N: ` line numbers unconditionally and cannot be configured off. The gutter
* is only recognized when the block as a whole reads like a numbered listing —
* enough non-empty lines, a large majority guttered, and the numbers strictly
* increasing — so prose like `12:30 pm` (one stray gutter-looking line) is
* never stripped. The stripping happens on the CONTENT view only; the output
* view keeps the gutter because it is the model's only inline locator into the
* original file (and its measured cost, 9.16% of read bodies, never gets
* retrieved anyway).
*/
function hasReadGutter(lines) {
	let nonEmpty = 0;
	let guttered = 0;
	let previousNumber = 0;
	for (const line of lines) {
		if (line.trim() === "") continue;
		nonEmpty += 1;
		const match = READ_GUTTER_PATTERN.exec(line);
		if (match === null) continue;
		const number = Number(match[1]);
		if (number <= previousNumber) return false;
		previousNumber = number;
		guttered += 1;
	}
	return nonEmpty >= 4 && guttered / nonEmpty >= .75;
}
/**
* Replace long opaque literals with length summaries (R12). Data URIs, base64
* blobs, and long hex dumps are pure noise in a compressed view; the prefix is
* kept so the model can still recognize the value. Short strings are never
* touched, and replacements never span lines, so the line mapping survives.
*/
function placeholderizeLongStrings(line) {
	if (!/[0-9a-zA-Z+/]{32}/.test(line) && !/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(line)) return line;
	let result = line.replace(UUID_PATTERN, "[uuid]");
	result = result.replace(LONG_HEX_PATTERN, (match) => `[hex ${String(match.length)} chars: ${match.slice(0, 16)}…]`);
	result = result.replace(LONG_BASE64_PATTERN, (match) => `[base64 ${String(match.length)} chars: ${match.slice(0, 16)}…]`);
	return result;
}
/**
* Select a reducer from verified tool, command, and content evidence.
* @param input - original result text, recovery source, and output budget.
* @returns a verified candidate, or `null` when every reducer fails open.
*/
function reduceFreshToolResult(input, ranking) {
	const normalized = normalizeTerminalLines(input.text);
	const prepared = {
		...input,
		text: normalized.text,
		lines: normalized.folded,
		contentText: normalized.contentText
	};
	const command = extractCommand(input.argumentsText);
	const name = input.toolName.toLowerCase();
	const toolClass = classifyToolSource(input.toolName, command, normalized.contentText);
	const readTocFirst = toolClass === "read" && codePointLength(normalized.contentText) >= READ_TOC_MIN_CHARS;
	const candidates = [];
	if (looksLikeJson(normalized.contentText)) candidates.push(() => reduceJson(prepared));
	if (looksLikeMinified(normalized.contentText)) candidates.push(() => reduceBundledJs(prepared));
	if (toolClass === "search") candidates.push(() => reduceSearch(prepared, ranking?.files));
	if (isGitCommand(name, command)) candidates.push(() => reduceGit(prepared, command));
	if (isPackageCommand(command)) candidates.push(() => reducePatternLog(prepared, "hypa-package", packagePattern()));
	if (isBuildOrTestCommand(command)) candidates.push(() => reducePatternLog(prepared, "hypa-build-test", buildPattern()));
	if (looksLikeSourceCode(normalized.contentText)) {
		if (input.codeSkeleton === true) candidates.push(() => reduceCodeSkeleton(prepared));
		else if (readTocFirst) candidates.push(() => tocGuardedCodeSkeleton(prepared));
	}
	if (looksLikeHtml(normalized.contentText)) candidates.push(() => reduceHtml(prepared));
	if (looksLikeDocument(normalized.contentText)) candidates.push(() => reduceDocSkeleton(prepared, ranking?.sections));
	if (toolClass === "shell" || command !== "") candidates.push(() => reduceShell(prepared));
	candidates.push(() => reduceProseKeep(prepared));
	if (toolClass === "read") candidates.push(() => reduceHead(prepared, "pi-head"));
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
	const normalized = normalizeTerminalLines(input.text);
	const lastFolded = normalized.folded.at(-1);
	const elidedLines = lastFolded === void 0 ? void 0 : lastFolded.originalLineEnd ?? lastFolded.originalLine;
	const anchorLine = input.compact ? void 0 : (normalized.folded.find((line) => IMPORTANT_PATTERN.test(line.text)) ?? void 0)?.originalLine;
	const retrieveHint = anchorLine === void 0 ? `retrieve: context_compression_retrieve({"ref":"${input.sourceRef}"})` : `retrieve: context_compression_retrieve({"ref":"${input.sourceRef}","start_line":${String(anchorLine)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}})`;
	const lines = [
		"[Old tool result content cleared from active context]",
		`tool: ${input.toolName || "unknown"}`,
		`status: ${input.isError ? "error" : "completed"}`,
		`original_chars: ${String(input.charsBefore)}`,
		`source: ${input.sourceRef}`,
		retrieveHint
	];
	if (anchor !== "") lines.push(`retained_anchor: ${anchor}`);
	return {
		text: lines.join("\n"),
		reducer: input.compact ? "pair-preserving-tail-aging" : "historical-tool-result-aging",
		lossy: true,
		...elidedLines === void 0 ? {} : { elidedLines }
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
	return normalizeTerminalLines(text).text;
}
/**
* Structured normalization (R9a): `retrieve` reads the original event, so any
* line number a reducer prints must resolve against the ORIGINAL text, not the
* normalized surface. ANSI stripping and `\r` redraw collapse never change the
* line count (logical lines are 1:1 with original lines); only the adjacent
* duplicate fold drops lines, so every folded entry carries the original line
* (range) it was kept from.
*/
function normalizeTerminalLines(text) {
	const logical = text.replace(ANSI_PATTERN, "").split("\n").map((line) => {
		return placeholderizeLongStrings(line.split("\r").filter((part) => part !== "").at(-1) ?? "");
	});
	const stripGutter = hasReadGutter(logical);
	const folded = [];
	let previous;
	let firstText = "";
	let count = 0;
	let firstOriginal = 0;
	const flush = (nextOriginal) => {
		if (previous === void 0) return;
		folded.push({
			text: firstText,
			content: previous,
			originalLine: firstOriginal
		});
		if (count > 1) {
			const marker = `[previous line repeated ${String(count - 1)} more times]`;
			folded.push({
				text: marker,
				content: marker,
				originalLine: firstOriginal + 1,
				originalLineEnd: nextOriginal - 1
			});
		}
	};
	logical.forEach((line, index) => {
		const originalLine = index + 1;
		const content = stripGutter ? line.replace(READ_GUTTER_PATTERN, "") : line;
		if (content === previous) {
			count++;
			return;
		}
		flush(originalLine);
		previous = content;
		firstText = line;
		count = 1;
		firstOriginal = originalLine;
	});
	flush(logical.length + 1);
	const result = foldNonAdjacentRepeats(folded);
	return {
		folded: result,
		text: result.map((line) => line.text).join("\n"),
		contentText: result.map((line) => line.content).join("\n")
	};
}
/**
* Fold non-adjacent exact repeats (R11). Adjacent folding runs FIRST and only
* handles consecutive runs (0.03–0.32% of real duplicate content); separated
* repeats reached 8.37% in large results. Each surviving occurrence — a kept
* line plus its optional adjacent-repeat marker — is one unit; once a text
* recurs ≥ threshold times, the first unit is kept and every later unit is
* replaced by ONE counted marker citing the original-event span it covers.
* A pure consecutive run forms a single unit, so this pass is a no-op on it
* and can never double-fold the adjacent marker.
*/
function foldNonAdjacentRepeats(folded) {
	const units = [];
	for (const entry of folded) if (entry.text.startsWith(ADJACENT_REPEAT_MARKER) && units.length > 0) units[units.length - 1].repeat = entry;
	else units.push({ lead: entry });
	const totals = /* @__PURE__ */ new Map();
	for (const unit of units) totals.set(unit.lead.content, (totals.get(unit.lead.content) ?? 0) + 1);
	if (totals.size === units.length) return [...folded];
	const firstOriginal = /* @__PURE__ */ new Map();
	const lastOriginalEnd = /* @__PURE__ */ new Map();
	for (const unit of units) {
		const content = unit.lead.content;
		if (totals.get(content) < NON_ADJACENT_FOLD_THRESHOLD) continue;
		if (!firstOriginal.has(content)) firstOriginal.set(content, unit.lead.originalLine);
		const end = unit.repeat?.originalLineEnd ?? unit.lead.originalLineEnd ?? unit.lead.originalLine;
		lastOriginalEnd.set(content, end);
	}
	const seen = /* @__PURE__ */ new Map();
	const result = [];
	for (const unit of units) {
		const content = unit.lead.content;
		const total = totals.get(content);
		if (total < NON_ADJACENT_FOLD_THRESHOLD) {
			result.push(unit.lead);
			if (unit.repeat !== void 0) result.push(unit.repeat);
			continue;
		}
		if (!seen.has(content)) {
			seen.set(content, 1);
			result.push(unit.lead);
			if (unit.repeat !== void 0) result.push(unit.repeat);
			continue;
		}
		const ordinal = (seen.get(content) ?? 1) + 1;
		seen.set(content, ordinal);
		if (ordinal > 2) continue;
		const end = lastOriginalEnd.get(content);
		const marker = `[× ${String(total)} total: same as line ${String(firstOriginal.get(content))}; original lines ${String(unit.lead.originalLine)}-${String(end)}]`;
		result.push({
			text: marker,
			content: marker,
			originalLine: unit.lead.originalLine,
			originalLineEnd: end
		});
	}
	return result;
}
/** Default line window a retrieve hint suggests the model paste. */
const RETRIEVE_HINT_MAX_LINES = 80;
/**
* TOC-first (G6): read-class results at or above this size let the code
* skeleton compete before head/tail truncation. The 14,000-char boundary is
* the studied real-read cohort (findings §7), well above p90 of actual reads
* so ordinary results keep their existing dispatch.
*/
const READ_TOC_MIN_CHARS = 14e3;
/**
* A skeleton whose output is dominated by elision markers is worse than
* head/tail for the model (task_4b risk: structure-poor files degenerate into
* "almost all markers") — above this marker-char share the TOC candidate fails
* open to the prose reducers.
*/
const TOC_MARKER_RATIO_LIMIT = .5;
/**
* Fail-open wrapper for the TOC-first code-skeleton candidate: a skeleton that
* degenerates into mostly-elision markers (minified bundles, generated files)
* returns null so the prose head/tail pair takes over.
*/
function tocGuardedCodeSkeleton(input) {
	const output = reduceCodeSkeleton(input);
	if (output === null) return null;
	const total = codePointLength(output.text);
	return output.text.split("\n").filter((line) => line.startsWith("[...")).reduce((sum, line) => sum + codePointLength(line) + 1, 0) / total > TOC_MARKER_RATIO_LIMIT ? null : output;
}
/** R10a thresholds: one giant line, uniformly fat lines, or very few fat lines. */
const MINIFIED_MAX_LINE_CHARS = 2e3;
const MINIFIED_AVG_LINE_CHARS = 300;
const MINIFIED_FEW_LINES = 40;
const MINIFIED_FEW_LINES_TOTAL_CHARS = 2e4;
/**
* Require form evidence of a bundled/minified module (R10a): line-anchored
* reducers cannot see inside a 135k-character line, and R9 line ranges on a
* 53-line bundle cannot address anything smaller than the whole file.
* @param text - normalized result text.
* @returns whether the text reads as a bundled/minified module.
*/
function looksLikeMinified(text) {
	const lines = splitLines(text);
	if (lines.length === 0) return false;
	let total = 0;
	let max = 0;
	for (const line of lines) {
		const length = line.length;
		total += length;
		if (length > max) max = length;
	}
	if (max > MINIFIED_MAX_LINE_CHARS) return true;
	if (total / lines.length > MINIFIED_AVG_LINE_CHARS) return true;
	return lines.length < MINIFIED_FEW_LINES && total > MINIFIED_FEW_LINES_TOTAL_CHARS;
}
/**
* Statement-level declaration patterns scanned GLOBALLY per line: a bundle's
* statements are separated by `;` / `},{` / `);` inside one physical line, so
* line-anchored matching is useless here. Reserved-name traces (`exports.*`,
* `module.exports`) are extracted first and called out in the header because
* minifiers rename local symbols.
*/
const BUNDLED_DECLARATION_PATTERNS = [
	/\bexports\.([A-Za-z_$][\w$]*)\s*=/g,
	/\bmodule\.exports\s*=\s*([A-Za-z_$][\w$]*)/g,
	/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g,
	/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
	/\b([A-Za-z_$][\w$]*)\s*:\s*function\b/g
];
const SOURCEMAP_DIRECTIVE = "//# sourceMappingURL=";
/**
* Bundled/minified JS directory (R10-B). The useful first answer is the
* declaration/export directory — WHAT the bundle exposes — plus one honest
* whole-span marker: the host's continuation is line-addressed, so a
* line-range retrieve on a 53-line bundle hands back the whole file (R10d:
* character-range retrieval is a separate, undecided extension).
*/
function reduceBundledJs(input) {
	const declarations = /* @__PURE__ */ new Map();
	for (const line of input.lines) for (const pattern of BUNDLED_DECLARATION_PATTERNS) {
		pattern.lastIndex = 0;
		let match = pattern.exec(line.content);
		while (match !== null) {
			const symbol = match[1];
			if (symbol !== void 0 && !declarations.has(symbol)) declarations.set(symbol, line.originalLine);
			match = pattern.exec(line.content);
		}
	}
	if (declarations.size === 0) return null;
	const hasSourceMap = input.contentText.includes(SOURCEMAP_DIRECTIVE);
	const entries = [...declarations.entries()].sort((a, b) => a[1] - b[1]);
	const kept = [`[bundled/minified JS detected; ${String(entries.length)} declarations; minified symbols may be renamed — exports.*/module.exports traces are the reliable ones;${hasSourceMap ? " source map present, prefer reading the original source;" : ""} source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"}) (line-addressed: single-line bundles come back whole)]`, ...entries.slice(0, 400).map(([symbol, line]) => `${symbol}  (line ${String(line)})`)];
	const start = input.lines[0]?.originalLine ?? 1;
	const end = originalEnd(input.lines, input.lines.length - 1);
	if (end > start) kept.push(elidedRangeMarker(start, end));
	const text = fitLines(kept, input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer: "bundled-js-directory",
		lossy: true
	};
}
/**
* Continuous-mask marker (R9b): cites the ORIGINAL-event line range it elides
* and carries a pasteable retrieve hint starting at the first elided line.
* Falls back to the compact plain marker when the hint would not fit.
*/
function reduceHead(input, reducer) {
	const marker = omissionMarker(input, reducer);
	const available = input.budgetChars - codePointLength(marker) - 1;
	if (available <= 0) return null;
	const head = takeWholeLinesFromHead(input.text, available);
	if (head === input.text || head === "") return null;
	const keptCount = head.split("\n").length;
	const firstElided = input.lines[keptCount];
	if (firstElided !== void 0) {
		const elidedEnd = originalEnd(input.lines, input.lines.length - 1);
		const ranged = rangeOmissionMarker(input, reducer, firstElided.originalLine, elidedEnd);
		if (codePointLength(head) + codePointLength(ranged) + 1 <= input.budgetChars) return {
			text: `${head}\n${ranged}`,
			reducer,
			lossy: true
		};
	}
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
	const firstKept = input.lines.length - tail.split("\n").length;
	if (firstKept > 0) {
		const elidedEnd = originalEnd(input.lines, firstKept - 1);
		const ranged = rangeOmissionMarker(input, reducer, input.lines[0].originalLine, elidedEnd);
		if (codePointLength(ranged) + codePointLength(tail) + 1 <= input.budgetChars) return {
			text: `${ranged}\n${tail}`,
			reducer,
			lossy: true
		};
	}
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
/**
* Two-tier search folding (R10). L1 is a LOSSLESS per-file locator —
* `## <path> (<N> matches)  L12,L15,…` — one line number per hit, taken from
* the hit's own `path:line` prefix (falling back to the original-event line).
* L2 is the content quota, water-filled round-robin so no file vanishes and
* no file runs more than one row ahead of another; the budget is reserved for
* L1 first. When L1 itself cannot fit, the shortfall is ANNOUNCED
* (withheld file/match counts) — never silently truncated. Outputs without
* any `path:line` form fail open to salience.
*/
function reduceSearch(input, fileRanking) {
	const groups = /* @__PURE__ */ new Map();
	const ungrouped = [];
	input.lines.forEach((line) => {
		const match = PATH_LINE_PATTERN.exec(line.text);
		const row = {
			text: line.text,
			fileLine: match !== null ? Number(match[2]) : line.originalLine,
			important: IMPORTANT_PATTERN.test(line.text)
		};
		if (match === null) {
			ungrouped.push(row);
			return;
		}
		const path = match[1] ?? "<unknown>";
		const bucket = groups.get(path) ?? [];
		bucket.push(row);
		groups.set(path, bucket);
	});
	if (groups.size === 0) return reduceSalient(input, "search-salience");
	const totalMatches = [...groups.values()].reduce((sum, rows) => sum + rows.length, 0);
	const locatorFor = (path, rows) => `## ${path} (${String(rows.length)} matches)  ${rows.map((row) => `L${String(row.fileLine)}`).join(",")}`;
	const perFile = /* @__PURE__ */ new Map();
	for (const entry of rankedFirst([...groups.entries()].map(([id, rows]) => ({
		id,
		rows
	})), fileRanking)) perFile.set(entry.id, [...entry.rows].sort((a, b) => a.important === b.important ? a.fileLine - b.fileLine : a.important ? -1 : 1));
	const allLocators = [...perFile.keys()].map((path) => locatorFor(path, groups.get(path)));
	const headerFor = (l2Rows, omitted) => `[search results compressed; ${String(groups.size)} files, ${String(totalMatches)} matches; ${String(l2Rows)} content rows shown, ${String(omitted)} matches omitted; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"})]`;
	const fillL2 = (output, quotaChars) => {
		let used = 0;
		let shown = 0;
		let round = 0;
		let progress = true;
		while (progress && round < 512) {
			progress = false;
			for (const rows of perFile.values()) {
				if (round >= rows.length) continue;
				const row = rows[round];
				const cost = codePointLength(row.text) + 1;
				if (used + cost > quotaChars) continue;
				output.push(row.text);
				used += cost;
				shown += 1;
				progress = true;
			}
			round += 1;
		}
		for (const row of ungrouped.filter((entry) => entry.important).slice(0, 12)) {
			const cost = codePointLength(row.text) + 1;
			if (used + cost > quotaChars) break;
			output.push(row.text);
			used += cost;
			shown += 1;
		}
		return {
			shown,
			omitted: totalMatches - shown
		};
	};
	const finish = (output) => {
		const text = output.join("\n");
		return text.includes(input.sourceRef) ? {
			text,
			reducer: "search-by-file",
			lossy: true
		} : null;
	};
	const headerProbe = headerFor(0, 0);
	const budget = input.budgetChars - codePointLength(headerProbe) - 2;
	if (budget <= 0) return null;
	const locatorCost = allLocators.reduce((sum, line) => sum + codePointLength(line) + 1, 0);
	if (locatorCost > budget) {
		const announcementReserve = 160;
		const output = [];
		let used = 0;
		let withheldFiles = 0;
		let withheldMatches = 0;
		for (let index = 0; index < allLocators.length; index++) {
			const cost = codePointLength(allLocators[index]) + 1 + announcementReserve;
			if (used + cost > budget) {
				withheldFiles = allLocators.length - index;
				withheldMatches = totalMatches - [...groups.values()].slice(0, index).reduce((sum, rows) => sum + rows.length, 0);
				break;
			}
			output.push(allLocators[index]);
			used += cost - announcementReserve;
		}
		if (withheldFiles > 0) output.push(`[L1 locator partially withheld: ${String(withheldFiles)} file(s) / ${String(withheldMatches)} matches' line lists did not fit the budget; retrieve for the full hit list]`);
		const { shown, omitted } = fillL2(output, Math.max(0, budget - used - (withheldFiles > 0 ? announcementReserve : 0)));
		output.unshift(headerFor(shown, omitted + withheldMatches));
		return finish(output);
	}
	const output = [...allLocators];
	const { shown, omitted } = fillL2(output, budget - locatorCost);
	output.unshift(headerFor(shown, omitted));
	return finish(output);
}
function reduceGit(input, command) {
	const lines = input.lines;
	const lower = command.toLowerCase();
	let keep;
	let reducer;
	if (/\bgit\s+(?:diff|show)\b/.test(lower)) {
		reducer = "hypa-git-diff";
		keep = lines.map((line) => line.text).filter((line) => /^(?:diff --git|index |--- |\+\+\+ |@@ |[+-](?![+-]))/.test(line) || IMPORTANT_PATTERN.test(line));
	} else if (/\bgit\s+(?:status|switch|checkout|merge|rebase|cherry-pick)\b/.test(lower)) {
		reducer = "hypa-git-status";
		keep = lines.map((line) => line.text).filter((line) => GIT_STATUS_PATTERN.test(line) || IMPORTANT_PATTERN.test(line));
	} else {
		reducer = "hypa-git-log";
		keep = lines.map((line) => line.text).filter((line) => /^(?:commit\s+[0-9a-f]+|Author:|Date:|[0-9a-f]{7,}\s)/i.test(line) || IMPORTANT_PATTERN.test(line));
	}
	if (keep.length === 0) return reduceSalient(input, reducer);
	const text = fitLines([
		`[git output compressed; ${scannedTotals(input, keep.length)}; source: ${input.sourceRef}; scatter-masked: retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","query":"<keyword>"}) for missed rows]`,
		...keep,
		...lines.slice(-8).map((line) => line.text)
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer,
		lossy: true
	};
}
function reducePatternLog(input, reducer, pattern) {
	const lines = input.lines;
	const kept = lines.filter((line) => pattern.test(line.text) || IMPORTANT_PATTERN.test(line.text) || STATUS_PATTERN.test(line.text));
	const text = fitLines([
		`[command output compressed by ${reducer}; ${scannedTotals(input, kept.length)}; source: ${input.sourceRef}; scatter-masked: retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","query":"<keyword>"}) for missed rows]`,
		...kept.map((line) => line.text),
		...lines.slice(-20).map((line) => line.text)
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer,
		lossy: true
	};
}
function reduceShell(input) {
	const lines = input.lines;
	const important = lines.filter((line) => IMPORTANT_PATTERN.test(line.text));
	if (important.length === 0) return reduceTail(input, "pi-tail");
	const text = fitLines([
		`[shell/log output compressed; ${scannedTotals(input, important.length)}; source: ${input.sourceRef}; scatter-masked: retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","query":"<keyword>"}) for missed rows]`,
		...important.map((line) => line.text),
		"--- final output ---",
		...lines.slice(-40).map((line) => line.text)
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer: "shell-salience-tail",
		lossy: true
	};
}
function reduceSalient(input, reducer) {
	const lines = input.lines;
	if (lines.length < 3) return reduceHead(input, reducer);
	const marker = omissionMarker(input, reducer);
	const headBudget = Math.max(1, Math.floor((input.budgetChars - codePointLength(marker)) * .34));
	const tailBudget = headBudget;
	const head = takeWholeLinesFromHead(input.text, headBudget);
	const tail = takeWholeLinesFromTail(input.text, tailBudget);
	const salient = lines.filter((line) => IMPORTANT_PATTERN.test(line.text) || STATUS_PATTERN.test(line.text)).slice(0, 24);
	const keptCount = head.split("\n").length + salient.length + tail.split("\n").length;
	const text = fitLines([
		head,
		...salient.map((line) => line.text),
		`${marker} [${scannedTotals(input, keptCount)}]`,
		tail
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer,
		lossy: true
	};
}
/**
* Require content evidence of a structured document: enough Markdown heading
* lines among a bounded prefix. Pure form evidence — tool names, path
* extensions, and commands are never read (MCP output has no predictable
* identity). Real logs and build output carry no `#`-heading lines, which is
* the misjudgment guard.
* @param text - normalized result text.
* @returns whether the text qualifies as a structured document.
*/
function looksLikeDocument(text) {
	const lines = splitLines(text);
	let headings = 0;
	for (const line of lines.slice(0, 600)) if (MARKDOWN_HEADING_PATTERN.test(line)) {
		headings += 1;
		if (headings >= 3) return true;
	}
	return false;
}
/** One R9-spec elision marker: an original-event line range plus its count. */
function elidedRangeMarker(start, end) {
	return `[... lines ${String(start)}-${String(end)} elided (${String(end - start + 1)} lines) ...]`;
}
/**
* Require content evidence of HTML: enough lines carrying real markup tags
* among a bounded prefix. Angle-bracket prose (TS generics, comparisons) does
* not match the tag list, which is the misjudgment guard.
*/
function looksLikeHtml(text) {
	const lines = splitLines(text);
	let tags = 0;
	for (const line of lines.slice(0, 400)) if (HTML_TAG_PATTERN.test(line)) {
		tags += 1;
		if (tags >= 3) return true;
	}
	return false;
}
const HTML_DROPPED_OPEN = /<(script|style|noscript|svg|head)\b[^>]*>/i;
const HTML_BLOCK_MIN_LINES = 2;
const HTML_BLOCK_MAX_LINES = 8;
const HTML_BLOCK_MIN_OCCURRENCES = 3;
const HTML_TABLE_TAG_PATTERN = /<table\b|<tr\b|<th\b|<\/tr\b|<\/table\b/i;
/**
* Deterministic repeated-block folding for slimmed HTML (R4/RK-3): contiguous
* runs of 2–8 non-table lines whose digit-normalized signature recurs ≥3 times
* keep their first occurrence; every later occurrence becomes ONE counted
* marker. Tables never fold, and different copy never shares a signature —
* only counter/number drift does.
*/
function foldRepeatedHtmlBlocks(slim, originalLineFor) {
	const signatureOf = (from, length) => {
		let signature = `${String(length)}|`;
		for (let position = from; position < from + length; position++) {
			const text = slim[position].text;
			if (HTML_TABLE_TAG_PATTERN.test(text)) return null;
			signature += `${text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim()}\n`;
		}
		return signature;
	};
	const counts = /* @__PURE__ */ new Map();
	for (let length = HTML_BLOCK_MIN_LINES; length <= HTML_BLOCK_MAX_LINES; length++) for (let start = 0; start + length <= slim.length; start++) {
		const signature = signatureOf(start, length);
		if (signature === null) continue;
		const bucket = counts.get(signature);
		if (bucket === void 0) counts.set(signature, {
			count: 1,
			first: start
		});
		else bucket.count += 1;
	}
	const result = [];
	let position = 0;
	while (position < slim.length) {
		let foldedLength = 0;
		let matched;
		for (let length = HTML_BLOCK_MAX_LINES; length >= HTML_BLOCK_MIN_LINES; length--) {
			if (position + length > slim.length) continue;
			const signature = signatureOf(position, length);
			const bucket = signature === null ? void 0 : counts.get(signature);
			if (bucket !== void 0 && bucket.count >= HTML_BLOCK_MIN_OCCURRENCES) {
				foldedLength = length;
				matched = bucket;
				break;
			}
		}
		if (matched === void 0) {
			result.push({
				text: slim[position].text,
				index: slim[position].index
			});
			position += 1;
			continue;
		}
		if (matched.first === position) for (let offset = 0; offset < foldedLength; offset++) result.push({
			text: slim[position + offset].text,
			index: slim[position + offset].index
		});
		else {
			const firstLine = originalLineFor(slim[matched.first].index);
			result.push({
				text: `[×${String(matched.count)} repeated block, first at line ${String(firstLine)}]`,
				index: slim[position].index,
				marker: true
			});
		}
		position += foldedLength;
	}
	return result;
}
/**
* Two-stage HTML reduction (R13). HTML previously fell into `pi-head`, which
* keeps exactly the useless `<head>` metadata and drops the body.
*
* Stage 1 (`html-slim`) is a deterministic, line-aligned slimming pass:
* comments, script/style/noscript/svg/head elements (single- or multi-line),
* data URIs, non-whitelisted attributes, and inline-tag markup disappear;
* every surviving line keeps its original-event position for the R9 ranges.
* Stage 2 (`html-skeleton`) runs only when the slim output still exceeds the
* budget: heading hierarchy, each section's first line, and table header rows
* survive; the rest is elided with original-event line ranges.
*/
function reduceHtml(input) {
	const slim = [];
	let dropping = null;
	input.lines.forEach((line, index) => {
		let text = line.content;
		if (dropping !== null) {
			const close = new RegExp(`</${dropping}\\s*>`, "i").exec(text);
			if (close === null) return;
			text = text.slice(close.index + close[0].length);
			dropping = null;
		}
		text = text.replace(HTML_COMMENT_PATTERN, "");
		text = text.replace(HTML_DROPPED_ELEMENTS, "");
		const open = HTML_DROPPED_OPEN.exec(text);
		if (open !== null) {
			const close = new RegExp(`</${open[1] ?? ""}\\s*>`, "i").exec(text.slice(open.index));
			if (close !== null) {
				const end = open.index + open[0].length + close.index + close[0].length;
				text = text.slice(0, open.index) + text.slice(end);
			} else {
				dropping = open[1] ?? null;
				text = text.slice(0, open.index);
			}
		}
		text = text.replace(HTML_DATA_URI_PATTERN, "");
		text = text.replace(HTML_TAG_PATTERN_FULL, (match, name, attrs) => `<${name}${attrs.match(HTML_WHITELISTED_ATTRIBUTES)?.join("") ?? ""}>`);
		text = text.replace(HTML_INLINE_TAG_PATTERN, "");
		text = text.trim();
		if (text !== "") slim.push({
			text,
			index
		});
	});
	if (slim.length === 0) return null;
	const buildHeader = (reducer, firstElided) => {
		const startLine = firstElided === void 0 ? "" : `,"start_line":${String(firstElided.start)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}`;
		return `[html compressed by ${reducer}; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"${startLine}})]`;
	};
	const foldedSlim = foldRepeatedHtmlBlocks(slim, (index) => input.lines[index]?.originalLine ?? 1);
	if (foldedSlim.reduce((sum, line) => sum + codePointLength(line.text) + 1, 0) + 160 <= input.budgetChars) {
		const text = fitLines([buildHeader("html-slim"), ...foldedSlim.map((line) => line.text)], input.budgetChars, input.sourceRef);
		if (text !== null) return {
			text,
			reducer: "html-slim",
			lossy: true
		};
	}
	const keep = new Array(foldedSlim.length).fill(false);
	let tableRows = 0;
	let lastHeading = -2;
	for (let position = 0; position < foldedSlim.length; position++) {
		const text = foldedSlim[position].text;
		if (foldedSlim[position].marker === true) {
			keep[position] = true;
			continue;
		}
		if (/<h[1-6]\b/i.test(text)) {
			keep[position] = true;
			lastHeading = position;
			continue;
		}
		if (lastHeading === position - 1) {
			keep[position] = true;
			continue;
		}
		if (/<table\b|<tr\b|<th\b/i.test(text)) {
			if (tableRows < 2) keep[position] = true;
			tableRows += 1;
			continue;
		}
		if (!/<\/(tr|table)\b/i.test(text)) tableRows = 0;
		if (IMPORTANT_PATTERN.test(text)) keep[position] = true;
	}
	const kept = [];
	let position = 0;
	let firstElided;
	let elidedLines = 0;
	while (position < foldedSlim.length) {
		if (keep[position]) {
			kept.push(foldedSlim[position].text);
			position += 1;
			continue;
		}
		const runStart = position;
		while (position < foldedSlim.length && !keep[position]) position += 1;
		const start = input.lines[foldedSlim[runStart].index].originalLine;
		const end = originalEnd(input.lines, foldedSlim[position - 1].index);
		if (firstElided === void 0) firstElided = start;
		elidedLines += end - start + 1;
		kept.push(elidedRangeMarker(start, end));
	}
	const text = fitLines([buildHeader("html-skeleton", firstElided === void 0 ? void 0 : { start: firstElided }), ...kept], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer: "html-skeleton",
		lossy: true,
		elidedLines
	};
}
/** Original-event end line of folded entry `lines[index]`. */
function originalEnd(lines, index) {
	const line = lines[index];
	return line?.originalLineEnd ?? line?.originalLine ?? 0;
}
/**
* Keep a document skeleton: the heading hierarchy, each section's first and
* last content line, list-item starts, table headers, and fence markers,
* eliding the remaining bodies with R9 line-range markers. Fails open (null)
* when nothing is elidable or the budget cannot be met, so the next candidate
* takes over.
*/
function reduceDocSkeleton(input, sectionRanking) {
	const lines = input.lines;
	const keep = new Array(lines.length).fill(false);
	const headingIndex = [];
	let inFence = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].content;
		if (FENCE_PATTERN.test(line)) {
			inFence = !inFence;
			keep[index] = true;
			continue;
		}
		if (!inFence && MARKDOWN_HEADING_PATTERN.test(line)) {
			headingIndex.push(index);
			keep[index] = true;
			continue;
		}
		if (IMPORTANT_PATTERN.test(line)) keep[index] = true;
		else if (!inFence && LIST_ITEM_PATTERN.test(line)) keep[index] = true;
	}
	let tableRows = 0;
	let fenceOpen = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].content;
		if (FENCE_PATTERN.test(line)) {
			fenceOpen = !fenceOpen;
			tableRows = 0;
			continue;
		}
		if (fenceOpen || line.trim() === "") continue;
		if (TABLE_ROW_PATTERN.test(line)) {
			if (tableRows < 2) keep[index] = true;
			tableRows += 1;
			continue;
		}
		tableRows = 0;
	}
	const sectionStarts = [-1, ...headingIndex];
	const sectionEnds = [...headingIndex, lines.length];
	const sections = headingIndex.map((heading, position) => ({
		id: lines[heading].content.replace(/^#+\s*/, "").trim(),
		heading,
		from: heading + 1,
		to: position + 1 < headingIndex.length ? headingIndex[position + 1] : lines.length
	}));
	const floorKeep = new Array(lines.length).fill(false);
	for (let section = 0; section < sectionStarts.length; section++) {
		const from = sectionStarts[section] + 1;
		const to = sectionEnds[section];
		let first = -1;
		let last = -1;
		for (let index = from; index < to; index++) {
			if (lines[index].content.trim() === "") continue;
			if (first === -1) first = index;
			last = index;
		}
		if (first !== -1) floorKeep[first] = true;
		if (last !== -1) floorKeep[last] = true;
	}
	/** Emit the skeleton for one keep-set: header, kept lines, R9 range markers. */
	const assemble = (flags, budget) => {
		const kept = [];
		let index = 0;
		let firstElided;
		let elidedLines = 0;
		while (index < lines.length) {
			if (flags[index]) {
				kept.push(lines[index].text);
				index += 1;
				continue;
			}
			const runStart = index;
			while (index < lines.length && !flags[index]) index += 1;
			const start = lines[runStart].originalLine;
			const end = originalEnd(lines, index - 1);
			if (firstElided === void 0) firstElided = start;
			elidedLines += end - start + 1;
			kept.push(elidedRangeMarker(start, end));
		}
		const hint = firstElided === void 0 ? "" : `,"start_line":${String(firstElided)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}`;
		kept.unshift(`[document compressed by doc-skeleton; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"${hint}})]`);
		return {
			text: fitLines(kept, budget, input.sourceRef),
			...firstElided === void 0 ? {} : { firstElided },
			elidedLines
		};
	};
	const combine = (base, overlay) => lines.map((_, index) => (base[index] ?? false) || (overlay[index] ?? false));
	const mechanical = assemble(combine(keep, floorKeep), input.budgetChars);
	if (mechanical.text === null) return null;
	if (sectionRanking === void 0 || sectionRanking.length === 0) return {
		text: mechanical.text,
		reducer: "doc-skeleton",
		lossy: true,
		elidedLines: mechanical.elidedLines
	};
	const cap = Math.min(input.budgetChars, codePointLength(input.text) - 1);
	const rankedFloor = new Array(lines.length).fill(false);
	for (const section of sections) for (let index = section.from; index < section.to; index++) {
		if (lines[index].content.trim() === "") continue;
		rankedFloor[index] = true;
		break;
	}
	/** Exact packed-output size of a keep-set: header + kept lines + markers. */
	const packedSize = (flags) => {
		let size = 180;
		let index = 0;
		while (index < lines.length) {
			if (flags[index]) {
				size += codePointLength(lines[index].text) + 1;
				index += 1;
				continue;
			}
			const runStart = index;
			while (index < lines.length && !flags[index]) index += 1;
			size += codePointLength(elidedRangeMarker(lines[runStart].originalLine, originalEnd(lines, index - 1))) + 1;
		}
		return size;
	};
	const fill = new Array(lines.length).fill(false);
	for (const section of rankedFirst(sections, sectionRanking)) for (let index = section.from; index < section.to; index++) {
		if (rankedFloor[index] || fill[index] || lines[index].content.trim() === "") continue;
		fill[index] = true;
		if (packedSize(combine(combine(keep, rankedFloor), fill)) > cap) {
			fill[index] = false;
			break;
		}
	}
	const ranked = assemble(combine(combine(keep, rankedFloor), fill), cap);
	return ranked.text === null ? null : {
		text: ranked.text,
		reducer: "doc-skeleton",
		lossy: true,
		elidedLines: ranked.elidedLines
	};
}
/**
* Universal prose fallback (R8b, the main force): keep the head AND the tail
* of any non-code text and one R9 line-range marker for everything elided in
* between. Unstructured prose (85%+ of large results) previously landed on
* head-only truncation; a tail keep preserves conclusions and closing state.
* Fails open for code-like text and when the budget cannot hold both ends.
*/
function reduceProseKeep(input) {
	const lines = input.lines;
	if (lines.length < 8) return null;
	if (looksLikeSourceCode(input.contentText)) return null;
	const first = lines[0];
	const last = lines[lines.length - 1];
	const tailLine = last.originalLineEnd ?? last.originalLine;
	const markerTemplate = elidedRangeMarker(first.originalLine, tailLine);
	const sourceNoteTemplate = `; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"})`;
	const reserved = codePointLength(markerTemplate) + codePointLength(sourceNoteTemplate) + 2;
	const bodyBudget = input.budgetChars - reserved;
	if (bodyBudget <= 0) return null;
	const headBudget = Math.floor(bodyBudget / 2);
	const tailBudget = bodyBudget - headBudget;
	let headCount = 0;
	let used = 0;
	while (headCount < lines.length) {
		const cost = codePointLength(lines[headCount].text) + (headCount === 0 ? 0 : 1);
		if (used + cost > headBudget) break;
		used += cost;
		headCount += 1;
	}
	let tailCount = 0;
	used = 0;
	while (tailCount < lines.length - headCount) {
		const index = lines.length - 1 - tailCount;
		const cost = codePointLength(lines[index].text) + (tailCount === 0 ? 0 : 1);
		if (used + cost > tailBudget) break;
		used += cost;
		tailCount += 1;
	}
	if (headCount === 0 || tailCount === 0 || headCount + tailCount >= lines.length) return null;
	const elidedStart = lines[headCount].originalLine;
	const elidedEnd = originalEnd(lines, lines.length - tailCount - 1);
	if (elidedEnd < elidedStart) return null;
	const sourceNote = `; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","start_line":${String(elidedStart)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}})`;
	return {
		text: [
			...lines.slice(0, headCount).map((line) => line.text),
			elidedRangeMarker(elidedStart, elidedEnd) + sourceNote,
			...lines.slice(lines.length - tailCount).map((line) => line.text)
		].join("\n"),
		reducer: "prose-keep",
		lossy: true,
		elidedLines: elidedEnd - elidedStart + 1
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
	const lines = input.lines.map((line) => line.content);
	const kept = [];
	let elided = 0;
	let elidedTotal = 0;
	let firstElided;
	const flushElided = () => {
		if (elided > 0) {
			const start = input.lines[index - elided]?.originalLine ?? 0;
			const end = originalEnd(input.lines, index - 1);
			if (firstElided === void 0) firstElided = {
				start,
				end
			};
			kept.push(elidedRangeMarker(start, end));
			elidedTotal += elided;
		}
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
	return finishSkeleton(kept, lines, input, firstElided, elidedTotal);
}
function finishSkeleton(kept, lines, input, firstElided, elidedLines) {
	const hint = firstElided === void 0 ? "" : `; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","start_line":${String(firstElided.start)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}})`;
	const text = fitLines([
		`[code output compressed by hypa-code-skeleton; source: ${input.sourceRef}${hint}]`,
		...kept,
		...lines.slice(-4)
	], input.budgetChars, input.sourceRef);
	return text === null ? null : {
		text,
		reducer: "hypa-code-skeleton",
		lossy: true,
		elidedLines
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
/**
* Continuous-mask marker (R9b): an original-event line range plus a pasteable
* retrieve hint whose start_line is the first elided line. Line numbers point
* at the RAW event because retrieve reads raw events (D8).
*/
function rangeOmissionMarker(input, reducer, elidedStart, elidedEnd) {
	return `[... lines ${String(elidedStart)}-${String(elidedEnd)} elided (${String(elidedEnd - elidedStart + 1)} lines); ${reducer}; original_chars=${String(codePointLength(input.text))}; source=${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","start_line":${String(elidedStart)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}}) ...]`;
}
/** Scatter-mask note (R9b): totals instead of fragmented per-run ranges. */
function scannedTotals(input, kept) {
	const last = input.lines[input.lines.length - 1];
	const lastLine = Math.max(last?.originalLineEnd ?? 0, last?.originalLine ?? 0, input.lines.length);
	return `lines 1-${String(lastLine)} scanned, ${String(kept)} kept`;
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
/**
* Extract the command argument from a tool call's arguments (task_10/AD2):
* ONLY `command` / `cmd` / `script` are command keys. `input` was removed —
* any MCP tool with a non-empty `input` string parameter would otherwise be
* misrouted into the shell reducer, the single largest misroute source.
* @param argumentsText - raw JSON arguments of the tool call.
* @returns the command string, or '' when absent.
*/
function extractCommand(argumentsText) {
	try {
		const parsed = JSON.parse(argumentsText);
		if (typeof parsed !== "object" || parsed === null) return "";
		const record = parsed;
		for (const key of [
			"command",
			"cmd",
			"script"
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
//#region src/runtime/tokenpilot/read-state.ts
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
const SECTION_HEADING = /^#{1,3}\s+(.{1,80})/;
/**
* Cluster one omitted line-count into a summary appended to a placeholder
* marker, giving the model meta-knowledge about what was dropped. Document
* content (R8) swaps the error/warn/info census for a section-heading list —
* `0 error, 0 warn, N info` carries no information about a dropped document,
* while its heading list does.
*/
function clusterOmittedLines(text, omittedLines) {
	if (omittedLines <= 0) return void 0;
	if (looksLikeDocument(text)) return documentCensus(text, omittedLines);
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
/** Bounded section-heading list for an omitted document (R8 census). */
function documentCensus(text, omittedLines) {
	const titles = [];
	for (const line of text.split("\n")) {
		const match = SECTION_HEADING.exec(line);
		if (match === null) continue;
		titles.push(match[1].trim());
		if (titles.length >= 8) break;
	}
	if (titles.length === 0) return `${String(omittedLines)} lines omitted (document content)`;
	let summary = titles.join(" · ");
	if (summary.length > 240) summary = `${summary.slice(0, 240)}…`;
	return `${String(omittedLines)} lines omitted (sections: ${summary})`;
}
//#endregion
//#region src/runtime/tokenpilot/sidechannel.ts
/** One bound side channel. `ask` resolves `undefined` on ANY failure. */
var SideChannel = class {
	ctx;
	options;
	constructor(ctx, options) {
		this.ctx = ctx;
		this.options = options;
	}
	get enabled() {
		return this.options.estimatorMode === "host" || this.options.estimatorMode === "direct";
	}
	async ask(request) {
		const timeoutMs = this.options.estimatorTimeoutMs ?? 3e3;
		const timeout = AbortSignal.timeout(timeoutMs);
		const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([request.signal, timeout]) : timeout;
		try {
			if (this.options.estimatorMode === "host") return await this.askHost(request.system, request.user, signal);
			if (this.options.estimatorMode === "direct") return await this.askDirect(request.system, request.user, signal);
			return;
		} catch {
			return;
		}
	}
	/** Failure-open wrapper that also records one audit record per call. */
	async askAudited(request) {
		const now = Date.now();
		const text = await this.ask(request);
		const audit = {
			ok: text !== void 0,
			latencyMs: Date.now() - now,
			...this.identity() !== void 0 ? { channel: this.identity() } : {},
			...text === void 0 ? { reason: "channel returned no content (timeout, non-2xx, parse failure, or reasoning ate the 256-token budget)" } : {}
		};
		return {
			...text === void 0 ? {} : { text },
			audit
		};
	}
	identity() {
		if (this.options.estimatorMode === "direct") return `direct:${this.options.estimatorModel ?? ""}`;
		if (this.options.estimatorMode === "host") {
			const route = this.resolveHostRoute();
			return route === void 0 ? "host" : `host:${route.provider}/${route.model}`;
		}
	}
	/** Same host-route resolution as the estimator: explicit, then host default. */
	resolveHostRoute() {
		const provider = this.options.estimatorProvider ?? "";
		const model = this.options.estimatorModel ?? "";
		if (provider.length > 0 && model.length > 0) return {
			provider,
			model
		};
		try {
			const selected = this.ctx.get("agentDefaultModel")?.currentSelection?.();
			const selectedProvider = selected?.provider ?? "";
			const selectedModel = selected?.model ?? "";
			if (selectedProvider.length > 0 && selectedModel.length > 0) return {
				provider: provider.length > 0 ? provider : selectedProvider,
				model: model.length > 0 ? model : selectedModel
			};
		} catch {}
	}
	async askHost(system, user, signal) {
		let llm;
		try {
			llm = this.ctx.get("llm");
		} catch {
			return;
		}
		if (llm?.stream === void 0) return void 0;
		const route = this.resolveHostRoute();
		if (route === void 0) return void 0;
		let text = "";
		const stream = llm.stream({
			provider: route.provider,
			model: route.model,
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
		for await (const chunk of stream) if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
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
//#region src/runtime/tokenpilot/estimator.ts
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
		"Answer with ONLY a JSON array: [{\"seq\":<number>,\"expired\":<boolean>}].",
		"Optionally, if you can estimate how many user turns remain in this session, answer",
		"with {\"expectedRemainingTurns\":<number>,\"items\":[{\"seq\":<number>,\"expired\":<boolean>}]}",
		"instead; omit the field when you cannot estimate it."
	].join(" ");
}
function buildEstimatorUserPrompt(samples) {
	return samples.map((sample) => `{"seq":${String(sample.seq)},"path":${JSON.stringify(sample.path)},"turn":${String(sample.turn)}}`).join("\n");
}
function parseVerdictArray(value) {
	if (!Array.isArray(value)) return [];
	const verdicts = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry;
		if (typeof record.seq !== "number" || typeof record.expired !== "boolean") continue;
		verdicts.push({
			seq: record.seq,
			expired: record.expired
		});
	}
	return verdicts;
}
/**
* Parse the estimator answer including the optional session-level
* `expectedRemainingTurns`. Accepts both the legacy bare verdict array and the
* extended object form; anything malformed yields no verdicts and no Ŝ.
*/
function parseEstimatorAnswerDetailed(text) {
	const objectStart = text.indexOf("{");
	const objectEnd = text.lastIndexOf("}");
	if (objectStart >= 0 && objectEnd > objectStart) try {
		const parsed = JSON.parse(text.slice(objectStart, objectEnd + 1));
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			const record = parsed;
			const verdicts = parseVerdictArray(record.verdicts ?? record.items);
			if (verdicts.length > 0) {
				const turns = record.expectedRemainingTurns;
				if (typeof turns === "number" && Number.isFinite(turns) && turns >= 0) return {
					verdicts,
					expectedRemainingTurns: Math.floor(turns)
				};
				return { verdicts };
			}
		}
	} catch {}
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start < 0 || end <= start) return { verdicts: [] };
	try {
		return { verdicts: parseVerdictArray(JSON.parse(text.slice(start, end + 1))) };
	} catch {
		return { verdicts: [] };
	}
}
/** One channel-bound estimator. `ask` resolves undefined on any failure. */
var Estimator = class {
	ctx;
	options;
	channel;
	constructor(ctx, options) {
		this.ctx = ctx;
		this.options = options;
		this.channel = new SideChannel(ctx, options);
	}
	get enabled() {
		return this.options.estimatorMode === "host" || this.options.estimatorMode === "direct";
	}
	async ask(system, user, signal) {
		return this.channel.ask({
			system,
			user,
			signal
		});
	}
};
//#endregion
//#region src/runtime/tokenpilot/dedup.ts
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
		"retrieve with context_compression_retrieve({\"ref\":\"" + entry.sourceRef + "\",\"start_line\":1}) if the omitted evidence is necessary.]"
	].join(" ");
}
//#endregion
//#region src/runtime/tokenpilot/proposal.ts
/**
* TokenPilot-inspired R4: benefit model for the human-gated review pipeline.
*
* Pure functions only: the classifier needs no I/O, no session state, and no
* host services, so every decision is unit-testable and audit-replayable.
*
* The cost model follows the TokenPilot paper's cache-accounting view: one
* merged mutation pays a one-time tail KV-cache refill penalty of
* `(1−α)·tailTokens`, and every later turn recovers the reclaimed tokens at
* the cache-hit discount `α`:
*
* ```
* R              = Σ(tokensBefore − tokensAfter)   // net reclaimed tokens
* paybackTurns   = (1−α)·tailTokens / (α·R)        // one-time refill / per-turn saving
* expectedSaving = α·R·max(0, Ŝ − paybackTurns)    // Ŝ = estimated remaining turns
* ```
*
* `expectedSaving` is only produced when Ŝ is known (the estimator answered
* with `expectedRemainingTurns`); it is never fabricated from a guess.
*/
/**
* Aggregate the batch-level benefit of a set of reduction candidates.
*
* Individual candidates whose replacement would grow the context contribute
* zero recovery (they never make a batch look better than dropping them).
*/
function computeBenefit(candidates, input) {
	const { alpha, tailTokens, remainingTurns } = input;
	let recoveredTokens = 0;
	for (const candidate of candidates) recoveredTokens += Math.max(0, candidate.tokensBefore - candidate.tokensAfter);
	const penaltyTokens = (1 - alpha) * tailTokens;
	const perTurnSaving = alpha * recoveredTokens;
	if (perTurnSaving <= 0) return remainingTurns === void 0 ? {
		recoveredTokens,
		penaltyTokens
	} : {
		recoveredTokens,
		penaltyTokens,
		expectedSaving: -penaltyTokens
	};
	const paybackTurns = penaltyTokens / perTurnSaving;
	if (remainingTurns === void 0) return {
		recoveredTokens,
		penaltyTokens,
		paybackTurns
	};
	return {
		recoveredTokens,
		penaltyTokens,
		paybackTurns,
		expectedSaving: perTurnSaving * Math.max(0, remainingTurns - paybackTurns)
	};
}
/**
* Stable proposal identity: the sha-256 of the serialized item digests, cut to
* 12 hex chars. Stable across re-enqueues of the same content so a repeated
* classification cannot duplicate a pending proposal.
*/
function proposalId(itemDigests) {
	const hash = createHash("sha256");
	for (const digest of itemDigests) hash.update(digest);
	hash.update(String(itemDigests.length));
	return hash.digest("hex").slice(0, 12);
}
/**
* Canonical content digest reused from the dedup hash: plain-text results hash
* through the dedupe canonicalization; rich blocks fall back to canonical JSON
* so every candidate is freezable.
*/
function contentDigest(content) {
	return dedupeHash(flattenPlainText(content) ?? JSON.stringify(content), "trim-eol");
}
function proposalKindFor(candidate, estimatorSeqs) {
	if (estimatorSeqs?.has(candidate.sourceSeq) === true) return "estimator";
	if (candidate.reducer === "dedupe-pointer") return "dedup";
	return "read-state";
}
/**
* Triage planned replacements into the three review-mode buckets, pricing the
* pass as ONE merged mutation (R1): the tail KV-cache refill penalty is a
* property of the landing event, not of any single candidate, so it must be
* paid exactly once per batch. Pricing per candidate overstates the payback
* N-fold and starves every real batch out of the auto path.
*
* Pipeline: zero/negative-recovery candidates are priced out first (they never
* make a batch look better), the surviving batch is priced once through
* `computeBenefit`, the verdict is a batch decision, and any high-impact
* candidate (`tokensBefore ≥ reviewHighImpactTokens`) covers the whole batch
* into review — splitting the batch would pay a second cache break that the
* accounting does not model. Review skeletons are grouped one proposal per
* kind; a proposal id covers every item digest.
*
* Batch verdict bands (identical thresholds to the per-candidate model):
* - any high-impact candidate, or α too small to price a payback → review;
* - `paybackTurns ≤ 1`, or Ŝ known and `paybackTurns ≤ 0.25·Ŝ` → auto;
* - Ŝ known and `paybackTurns ∈ (1, 3]` → review;
* - everything else (Ŝ unknown with a slow payback) → drop.
*/
function classifyCandidates(candidates, input) {
	const drop = [];
	const usable = [];
	for (const candidate of candidates) {
		if (Math.max(0, candidate.tokensBefore - candidate.tokensAfter) <= 0) {
			drop.push(candidate);
			continue;
		}
		usable.push(candidate);
	}
	if (usable.length === 0) return {
		auto: [],
		review: [],
		drop
	};
	const benefit = computeBenefit(usable, input);
	const payback = benefit.paybackTurns;
	const highImpact = usable.some((candidate) => candidate.tokensBefore >= input.reviewHighImpactTokens);
	let verdict;
	if (highImpact || payback === void 0) verdict = "review";
	else if (payback <= 1 || input.remainingTurns !== void 0 && payback <= .25 * input.remainingTurns) verdict = "auto";
	else if (input.remainingTurns !== void 0 && payback <= 3) verdict = "review";
	else verdict = "drop";
	if (verdict === "auto") return {
		auto: usable,
		review: [],
		drop
	};
	if (verdict === "drop") return {
		auto: [],
		review: [],
		drop: [...drop, ...usable]
	};
	const itemsByKind = /* @__PURE__ */ new Map();
	for (const candidate of usable) {
		const item = {
			seq: candidate.sourceSeq,
			component: candidate.component,
			kind: proposalKindFor(candidate, input.estimatorSeqs),
			tokensBefore: candidate.tokensBefore,
			tokensAfter: candidate.tokensAfter,
			digest: contentDigest(candidate.content)
		};
		const bucket = itemsByKind.get(item.kind) ?? [];
		bucket.push(item);
		itemsByKind.set(item.kind, bucket);
	}
	const review = [];
	for (const [kind, items] of itemsByKind) review.push({
		id: proposalId(items.map((item) => item.digest)),
		kind,
		items,
		benefit
	});
	return {
		auto: [],
		review,
		drop
	};
}
//#endregion
//#region src/runtime/tokenpilot/review-storage.ts
/** Domain name — `UNIT_NAME_RE` (`/^[a-z][a-z0-9_]*$/`) allows no hyphens. */
const REVIEW_STORAGE_DOMAIN = "context_compression_review";
/** The one declared table: one record per session id. */
const REVIEW_STORAGE_TABLE = "sessions";
/** Structural validator: accepts exactly the shape this module persists. */
function reviewSessionRecordValidator() {
	return { safeParse(value) {
		if (typeof value !== "object" || value === null) return { success: false };
		const record = value;
		if (record.version !== 1 || !Array.isArray(record.proposals)) return { success: false };
		for (const proposal of record.proposals) {
			if (typeof proposal !== "object" || proposal === null) return { success: false };
			const entry = proposal;
			if (typeof entry.id !== "string" || typeof entry.sessionId !== "string") return { success: false };
			if (entry.kind !== "estimator" && entry.kind !== "dedup" && entry.kind !== "read-state") return { success: false };
			if (entry.status !== "pending" && entry.status !== "approved") return { success: false };
			if (!Number.isSafeInteger(entry.enqueuedTurn) || !Number.isSafeInteger(entry.lastTurnIndex)) return { success: false };
			if (!Array.isArray(entry.items) || typeof entry.benefit !== "object" || entry.benefit === null) return { success: false };
			for (const item of entry.items) {
				if (typeof item !== "object" || item === null) return { success: false };
				const one = item;
				if (!Number.isSafeInteger(one.seq) || typeof one.digest !== "string") return { success: false };
			}
		}
		return {
			success: true,
			data: value
		};
	} };
}
function reviewStorageSpec() {
	return {
		name: REVIEW_STORAGE_DOMAIN,
		version: 1,
		layout: "per-record",
		tables: { [REVIEW_STORAGE_TABLE]: { valueSchema: reviewSessionRecordValidator() } }
	};
}
/** Adapter presenting the sync KV face the queue expects over the domain table. */
var StorageDomainReviewStore = class {
	table;
	constructor(table) {
		this.table = table;
	}
	load(sessionId) {
		const value = this.table.get(sessionId);
		return typeof value === "object" && value !== null ? value : void 0;
	}
	save(sessionId, record) {
		this.table.put(sessionId, record).catch(() => void 0);
	}
	ids() {
		return [...this.table.keys()];
	}
};
/**
* Attempt to open the review storage domain through the optional
* `storageDomain` seam.
* @param getService - resolved once with the seam name; `undefined` means the
* host lacks the service.
* @returns the durable store, or `undefined` when the seam is absent or fails
* (the caller falls back to the in-memory store and logs one warning).
*/
async function openReviewStorage(getService) {
	let service;
	try {
		service = getService("storageDomain");
	} catch {
		return;
	}
	if (service === void 0 || service === null) return void 0;
	return new StorageDomainReviewStore((await service.open(reviewStorageSpec())).table(REVIEW_STORAGE_TABLE));
}
//#endregion
//#region src/runtime/deepseek-official-pricing.ts
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
//#region src/runtime/adaptive-cost.ts
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
//#region src/runtime/audit.ts
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
//#region src/pruner.ts
/**
* Replay-safe, model-free context-compression selector for tool results.
*
* Standard profiles never rewrite ordinary Assistant prose. The only durable
* replacements emitted here are content-only `tool/result` rewrites whose
* full source remains in the append-only Session log.
*
* @module dsh-context-compression-improved-runtime
*/
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
	/** Consolidated per-session mutable state. */
	state;
	/** 0.1.5-specific: per-session sets of already-audited native summary seqs. */
	auditedNativeSummaries = /* @__PURE__ */ new WeakMap();
	constructor(ctx, config = {}) {
		super(ctx, "toolResultPruner");
		ctx.inject(["tools", "systemPrompt"], (recoveryCtx) => {
			installContextCompressionRetrieve(recoveryCtx);
		});
		this.state = {
			config: resolveConfig(config),
			sessionSettings: /* @__PURE__ */ new WeakMap(),
			firstExposure: /* @__PURE__ */ new WeakMap(),
			recoveryExemptions: /* @__PURE__ */ new WeakMap(),
			dedupeTables: /* @__PURE__ */ new WeakMap(),
			estimatorVerdicts: /* @__PURE__ */ new WeakMap(),
			estimatorFailures: /* @__PURE__ */ new WeakMap(),
			warnedFailures: /* @__PURE__ */ new WeakMap(),
			postflightDiagnostics: /* @__PURE__ */ new WeakMap(),
			activeRequestBoundaries: /* @__PURE__ */ new WeakMap(),
			tailTrimBoundaryAttempts: /* @__PURE__ */ new WeakMap(),
			policyResolutionAudits: /* @__PURE__ */ new WeakMap(),
			reviewStore: sharedReviewStore(),
			reviewQueues: /* @__PURE__ */ new WeakMap(),
			reviewClocks: /* @__PURE__ */ new WeakMap(),
			estimatorRemainingTurns: /* @__PURE__ */ new WeakMap(),
			reviewSummaries: /* @__PURE__ */ new WeakMap()
		};
		ctx.effect(() => registerReviewPruner(this), "contextCompressionSelector.reviewRegistry()");
		openReviewStorage((name) => this.ctx.get(name)).then((store) => {
			if (store !== void 0) this.state.reviewStore = store;
		}).catch(() => {
			this.ctx.logger.warn("context-compression review storage unavailable; keeping in-memory review queue");
		});
		ctx.on("session/event", (session, event) => {
			this.scanForSeededNativeSummary(session);
			if (event.type === "compaction/summary") {
				this.emitNativeSummaryAudit(session, event.seq, event.data);
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
			this.state.activeRequestBoundaries.set(agent.session, boundary);
			try {
				if (!signal.aborted) try {
					this.reviewClock(agent.session, turn);
					this.runRequestBoundary(agent.session, turn, step - 1, signal);
				} catch (error) {
					this.auditFailure(agent.session, "fresh", "request-boundary", error);
					ctx.logger.warn("context-compression fresh pass failed open: %o", error);
				}
				const outcome = await next();
				this.scanForSeededNativeSummary(agent.session);
				return outcome;
			} finally {
				if (this.state.activeRequestBoundaries.get(agent.session) === boundary) this.state.activeRequestBoundaries.delete(agent.session);
			}
		}, { prepend: true });
		ctx.on("agent/turn-stopping", ({ agent, turn, signal }) => {
			if (signal.aborted) return;
			try {
				const step = latestCompletedToolStep(agent.session, turn);
				if (step !== void 0) this.runRequestBoundary(agent.session, turn, step, signal);
			} catch (error) {
				this.auditFailure(agent.session, "fresh", "terminal-pass", error);
				ctx.logger.warn("context-compression terminal pass failed open: %o", error);
			}
			try {
				this.expireReviewProposals(agent.session, turn);
				this.applyApprovedProposals(agent.session);
			} catch (error) {
				ctx.logger.warn("context-compression review turn-boundary pass failed open: %o", error);
			}
			this.postflightEstimatorPass(agent.session, signal).catch(() => void 0);
		});
	}
	/**
	* Measure text content in Unicode code points; non-text blocks cost zero.
	* @param blocks - tool-result content to measure.
	* @returns total Unicode code points across text blocks.
	*/
	/**
	* Apply the configured native head/middle/tail transform.
	* @param blocks - original tool-result content.
	* @returns reduced content, or `null` when no reduction is required.
	*/
	pruneContent(blocks) {
		return nativePruneContent(blocks, this.state.config.headChars + codePointLength(PRUNE_MARKER) + this.state.config.tailChars, this.state.config.headChars, this.state.config.tailChars);
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
		this.scanForSeededNativeSummary(session);
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
			landed.push(...this.landAll(session, this.triageForReview(session, policy, planned)));
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
				if (historyAllowed) landed.push(...this.landAll(session, this.triageForReview(session, policy, historyOutcome.plans)));
			}
		} else {
			historyAllowed = this.historyAllowed(session, policy, view);
			if (historyAllowed) {
				historyOutcome = this.planHistoricalAging(session, policy, view);
				if (historyOutcome.kind === "planned") landed.push(...this.landAll(session, this.triageForReview(session, policy, historyOutcome.plans)));
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
		const frozen = this.state.sessionSettings.get(session);
		if (frozen !== void 0) return frozen;
		const settings = this.ctx.get("settings")?.get(CONTEXT_COMPRESSION_SETTINGS_NAMESPACE);
		let resolved;
		let settingsSource = settings === void 0 ? "plugin-config-fallback" : "host-settings";
		let autoCompactThresholdSource = settings === void 0 ? "schema-default" : "host-settings";
		let settingsInvalidFallback;
		try {
			resolved = settings === void 0 ? ContextCompressionSettingsSchema({ profile: this.state.config.profile }) : parseContextCompressionSettings(settings);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.auditFailure(session, "pressure", "policy-resolution", error);
			this.warnOnce(session, `settings-invalid:${reason}`, "context-compression froze this session effectively off because the stored settings document is invalid: %s", reason);
			resolved = ContextCompressionSettingsSchema({ profile: "off" });
			settingsSource = "plugin-config-fallback";
			autoCompactThresholdSource = "schema-default";
			settingsInvalidFallback = "lossless-off";
		}
		if (this.state.config.autoCompactThresholdPercent !== void 0) {
			resolved = {
				...resolved,
				autoCompact: { thresholdPercent: this.state.config.autoCompactThresholdPercent }
			};
			autoCompactThresholdSource = "generation-config";
		}
		const snapshot = deepFreeze(structuredClone(resolved));
		this.state.sessionSettings.set(session, snapshot);
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "policy-frozen",
			sessionId: String(session.id),
			settingsSource,
			autoCompactThresholdSource,
			...settingsInvalidFallback === void 0 ? {} : { settingsInvalidFallback },
			settings: snapshot,
			deploymentConfig: this.state.config
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
			const event = eventBySeq(events, seq);
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
				startSeq: SessionSeq(checkpointSeq),
				endSeq: SessionSeq(checkpointSeq)
			},
			sourceEventSeqs: [SessionSeq(checkpointSeq)]
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
		const failures = this.state.estimatorFailures.get(session);
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
			if (this.state.estimatorVerdicts.get(session)?.has(candidate.seq) === true) continue;
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
			let verdicts = this.state.estimatorVerdicts.get(session);
			if (verdicts === void 0) {
				verdicts = /* @__PURE__ */ new Map();
				this.state.estimatorVerdicts.set(session, verdicts);
			}
			const detailed = parseEstimatorAnswerDetailed(answer);
			if (detailed.expectedRemainingTurns !== void 0) this.state.estimatorRemainingTurns.set(session, detailed.expectedRemainingTurns);
			for (const verdict of detailed.verdicts) {
				if (verdicts.has(verdict.seq)) continue;
				verdicts.set(verdict.seq, verdict.expired);
				if (verdict.expired) expired += 1;
			}
		} else {
			const next = {
				failures: (failures?.failures ?? 0) + 1,
				cooldownUntil: Date.now() + backoffCooldownMs((failures?.failures ?? 0) + 1)
			};
			this.state.estimatorFailures.set(session, next);
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
	/**
	* The per-session review queue, or `undefined` while review mode is off
	* (every review path must then behave exactly like before).
	*/
	reviewQueueFor(session, policy) {
		const presetOptions = policy?.presetOptions;
		if (presetOptions?.reviewMode !== true) return void 0;
		let queue = this.state.reviewQueues.get(session);
		if (queue === void 0) {
			queue = new ReviewQueue(this.state.reviewStore, { timeoutTurns: presetOptions.reviewTimeoutTurns });
			this.state.reviewQueues.set(session, queue);
		}
		return queue;
	}
	/**
	* Monotonic per-session turn clock for review patience and expiry. Bumped by
	* the agent loop payloads (`pre-step` / `turn-stopping`); passes without a
	* turn coordinate reuse the last observed value.
	*/
	reviewClock(session, turn) {
		const previous = this.state.reviewClocks.get(session) ?? 0;
		const next = typeof turn === "number" && Number.isSafeInteger(turn) && turn > previous ? turn : previous;
		this.state.reviewClocks.set(session, next);
		return next;
	}
	auditReviewOutcome(session, proposal, event, extra = {}, turnIndex) {
		const tokensBefore = proposal.items.reduce((sum, item) => sum + item.tokensBefore, 0);
		const tokensAfter = proposal.items.reduce((sum, item) => sum + item.tokensAfter, 0);
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "review-outcome",
			sessionId: String(session.id),
			proposalId: proposal.id,
			proposalKind: proposal.kind,
			event,
			...extra.decision === void 0 ? {} : { decision: extra.decision },
			...extra.receiptStatus === void 0 ? {} : { receiptStatus: extra.receiptStatus },
			...extra.reasonCode === void 0 ? {} : { reasonCode: extra.reasonCode },
			itemSeqs: proposal.items.map((item) => item.seq),
			tokensBefore,
			tokensAfter,
			...turnIndex === void 0 ? {} : { turnIndex }
		});
	}
	/**
	* Review-mode triage hook: classify one pass's planned replacements and
	* withhold the review bucket from landing, enqueuing it for human approval
	* instead. With review mode off (or nothing planned) this is the identity.
	*
	* The digest freezes each candidate's ORIGINAL surface content, so the apply
	* point can prove "what is removed now is what was approved then".
	*/
	triageForReview(session, policy, plans) {
		const queue = this.reviewQueueFor(session, policy);
		if (queue === void 0 || plans.length === 0) return plans;
		const presetOptions = policy.presetOptions;
		const estimatorVerdicts = this.state.estimatorVerdicts.get(session);
		const estimatorSeqs = new Set([...estimatorVerdicts?.entries() ?? []].filter(([, expired]) => expired).map(([seq]) => seq));
		const input = {
			alpha: presetOptions.cacheHitDiscountAlpha,
			tailTokens: Math.max(1, policy.historyKeepRecentTokens),
			reviewHighImpactTokens: presetOptions.reviewHighImpactTokens,
			...this.state.estimatorRemainingTurns.get(session) === void 0 ? {} : { remainingTurns: this.state.estimatorRemainingTurns.get(session) },
			estimatorSeqs
		};
		const classified = classifyCandidates(plans.map((plan) => ({
			sourceSeq: plan.sourceSeq,
			tokensBefore: plan.tokensBefore,
			tokensAfter: plan.tokensAfter,
			component: plan.component,
			reducer: plan.reducer,
			content: plan.candidate.event.data.message.content[0].content
		})), input);
		const autoSeqs = new Set(classified.auto.map((candidate) => candidate.sourceSeq));
		const clock = this.reviewClock(session);
		for (const skeleton of classified.review) if (queue.enqueue(String(session.id), skeleton, clock)) this.auditReviewOutcome(session, {
			id: skeleton.id,
			kind: skeleton.kind,
			items: skeleton.items
		}, "enqueue", {}, clock);
		return plans.filter((plan) => autoSeqs.has(plan.sourceSeq));
	}
	/**
	* Execute every approved proposal of one session as ONE merged replacement
	* batch at the current turn boundary, following the upstream applied-receipt
	* discipline: applied receipts are built only from real mutation evidence —
	* estimates never cross into applied savings.
	*
	* Per proposal: every item's frozen digest is re-checked against the current
	* surface content; any mismatch voids the whole proposal (deferred with a
	* reason code) instead of deleting something the user never approved.
	* Fail-open: any unexpected error only logs and leaves the queue intact.
	*/
	applyApprovedProposals(session) {
		const policy = this.activePolicy(session);
		const queue = this.reviewQueueFor(session, policy);
		if (queue === void 0) return;
		const sessionId = String(session.id);
		const approved = [...queue.listApproved(sessionId)];
		if (approved.length === 0) return;
		try {
			const view = measureForCompaction(this.ctx, session);
			const candidatesBySeq = new Map(this.snapshot(session, view).map((candidate) => [candidate.seq, candidate]));
			const settled = [];
			const now = (/* @__PURE__ */ new Date()).toISOString();
			for (const proposal of approved) {
				const voidedReason = this.reviewProposalVoided(session, proposal);
				if (voidedReason !== void 0) {
					settled.push({
						proposal,
						receipt: {
							status: "deferred",
							reasonCode: voidedReason,
							estimatedTokens: proposal.benefit.recoveredTokens,
							updatedAt: now
						}
					});
					continue;
				}
				const batchPlans = [];
				let planned = true;
				for (const item of proposal.items) {
					const candidate = candidatesBySeq.get(item.seq);
					if (candidate === void 0) {
						planned = false;
						break;
					}
					const plan = this.planAggregate(candidate, session, view, "review-approved-whole-result", "pressure", void 0, "history", policy?.historyMode);
					if (plan === null) {
						planned = false;
						break;
					}
					batchPlans.push(plan);
				}
				if (!planned || batchPlans.length === 0) {
					settled.push({
						proposal,
						receipt: {
							status: "deferred",
							reasonCode: "review_receipt_execution_invalid",
							estimatedTokens: proposal.benefit.recoveredTokens,
							updatedAt: now
						}
					});
					continue;
				}
				const landed = this.landAll(session, batchPlans);
				if (landed.length === 0) {
					settled.push({
						proposal,
						receipt: {
							status: "deferred",
							reasonCode: "review_receipt_execution_invalid",
							estimatedTokens: proposal.benefit.recoveredTokens,
							updatedAt: now
						}
					});
					continue;
				}
				const landedForProposal = new Map(landed.map((entry) => [entry.originalSeq, entry]));
				const measuredItems = proposal.items.map((item) => {
					const entry = landedForProposal.get(item.seq);
					return entry === void 0 ? item : {
						...item,
						tokensBefore: entry.tokensBefore,
						tokensAfter: entry.tokensAfter
					};
				});
				const appliedTokens = measuredItems.reduce((sum, item) => sum + item.tokensBefore - item.tokensAfter, 0);
				settled.push({
					proposal,
					auditItems: measuredItems,
					receipt: {
						status: "applied",
						estimatedTokens: proposal.benefit.recoveredTokens,
						appliedTokens,
						updatedAt: now
					}
				});
			}
			for (const { proposal, auditItems, receipt } of settled) {
				queue.recordReceipt(sessionId, proposal.id, receipt);
				const summary = this.reviewSummaryFor(session);
				if (receipt.status === "applied") summary.reviewApplied += 1;
				else summary.voided += 1;
				this.auditReviewOutcome(session, auditItems === void 0 ? proposal : {
					...proposal,
					items: auditItems
				}, receipt.status === "applied" ? "apply-receipt" : "apply-void", receipt.status === "applied" ? { receiptStatus: "applied" } : {
					receiptStatus: "deferred",
					reasonCode: receipt.reasonCode
				});
			}
		} catch (error) {
			this.ctx.logger.warn("context-compression review apply failed open: %o", error);
		}
	}
	/**
	* Current surface content at one seq: the newest covering replacement's
	* blocks when the seq was rewritten, otherwise the original event's blocks.
	*/
	surfaceContentAt(session, seq) {
		let content;
		for (const event of sessionEvents(session)) {
			if (event.type !== "tool/result") continue;
			const op = event.surfaceOp;
			if (typeof op === "object" && op.op === "replace" && op.startSeq <= seq && seq <= op.endSeq) content = event.data.message.content[0].content;
		}
		if (content !== void 0) return content;
		const original = sessionEvents(session).find((entry) => entry.seq === seq);
		return original?.type === "tool/result" ? original.data.message.content[0].content : void 0;
	}
	/**
	* The execution-point digest check: `undefined` when every item's frozen
	* digest still matches the current surface content, otherwise the aligned
	* reason code explaining the void.
	*/
	reviewProposalVoided(session, proposal) {
		for (const item of proposal.items) {
			const current = this.surfaceContentAt(session, item.seq);
			if (current === void 0) return "review_receipt_missing_candidate";
			if (contentDigest(current) !== item.digest) return "review_receipt_digest_invalid";
		}
	}
	reviewSummaryFor(session) {
		let summary = this.state.reviewSummaries.get(session);
		if (summary === void 0) {
			summary = {
				autoApplied: 0,
				reviewApplied: 0,
				expired: 0,
				voided: 0
			};
			this.state.reviewSummaries.set(session, summary);
		}
		return summary;
	}
	/** Live pending review proposals of one session; empty when review mode is off. */
	listReviewProposals(session) {
		return this.reviewQueueFor(session, this.activePolicy(session))?.listPending(String(session.id)) ?? [];
	}
	/**
	* Every session's live pending proposals, for the floating window's
	* aggregate badge (the client carries no session id of its own).
	*/
	listAllReviewProposals() {
		const ids = this.state.reviewStore.ids?.() ?? [];
		const reader = new ReviewQueue(this.state.reviewStore, { timeoutTurns: 1 });
		return ids.map((sessionId) => ({
			sessionId,
			proposals: [...reader.listPending(sessionId)]
		})).filter((entry) => entry.proposals.length > 0);
	}
	/** Four-state outcome counters of one session (floating-window summary row). */
	reviewSummary(session) {
		return { ...this.reviewSummaryFor(session) };
	}
	/**
	* Record one human decision. Returns the outcome, or `undefined` when
	* review mode is off for this session (the route maps that to 503).
	*/
	decideReviewProposal(session, proposalId, decision) {
		const queue = this.reviewQueueFor(session, this.activePolicy(session));
		if (queue === void 0) return void 0;
		const sessionId = String(session.id);
		const pending = queue.listPending(sessionId).find((entry) => entry.id === proposalId);
		const outcome = queue.decide(sessionId, proposalId, decision);
		if (outcome.ok && pending !== void 0) this.auditReviewOutcome(session, pending, "decide", { decision }, this.reviewClock(session));
		return outcome;
	}
	/**
	* Expire stale pending proposals at one turn boundary and audit each.
	* Public because tests drive it directly; the turn-stopping handler calls
	* it with the loop's own turn index.
	*/
	expireReviewProposals(session, turnIndex) {
		const queue = this.reviewQueueFor(session, this.activePolicy(session));
		if (queue === void 0) return [];
		const clock = this.reviewClock(session, turnIndex);
		const expired = queue.expireTurn(String(session.id), clock);
		if (expired.length > 0) this.reviewSummaryFor(session).expired += expired.length;
		for (const proposal of expired) this.auditReviewOutcome(session, proposal, "expire", {}, clock);
		return expired;
	}
	activePolicy(session, contextWindowTokens, stage = "pressure") {
		const settings = this.activeSettings(session);
		try {
			const policy = resolvePolicy(settings.presetOptions === void 0 ? this.state.config : {
				...this.state.config,
				presetOptions: settings.presetOptions
			}, settings.profile, settings.custom, {
				...contextWindowTokens === void 0 ? {} : { contextWindowTokens },
				autoCompactThresholdPercent: settings.autoCompact.thresholdPercent
			});
			const route = routeAuditFact(session);
			const auditKey = JSON.stringify({
				policy,
				contextWindowTokens: contextWindowTokens ?? null,
				route: route ?? null
			});
			if (this.state.policyResolutionAudits.get(session) !== auditKey) {
				this.state.policyResolutionAudits.set(session, auditKey);
				const overriddenLinkedFields = [
					"historyTriggerTokens",
					"historyKeepRecentTokens",
					"historyMinReclaimTokens"
				].filter((key) => this.state.config[key] !== void 0).length;
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
					...route === void 0 ? {} : tokenizerAuditFact(route)
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
		if (this.state.postflightDiagnostics.get(session) === attemptId) return;
		this.state.postflightDiagnostics.set(session, attemptId);
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
	decisions(session) {
		let decisions = this.state.firstExposure.get(session);
		if (decisions === void 0) {
			decisions = /* @__PURE__ */ new Set();
			this.state.firstExposure.set(session, decisions);
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
		return this.state.recoveryExemptions.get(session)?.has(candidate.seq) ?? false;
	}
	/** Register a result seq as permanently exempt from further reduction. */
	grantRecoveryExemption(session, seq) {
		let exemptions = this.state.recoveryExemptions.get(session);
		if (exemptions === void 0) {
			exemptions = /* @__PURE__ */ new Set();
			this.state.recoveryExemptions.set(session, exemptions);
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
				const remaining = candidates.filter((candidate) => !this.isRecoveryExempt(session, candidate)).sort((a, b) => Number(isError(a)) - Number(isError(b)) || (plans.get(b.seq)?.tokensAfter ?? exactTokens(b.count) ?? 0) - (plans.get(a.seq)?.tokensAfter ?? exactTokens(a.count) ?? 0));
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
		const freshCandidates = candidates.map((candidate) => plans.get(candidate.seq)).filter((plan) => plan !== void 0);
		const landed = this.landAll(session, this.triageForReview(session, policy, freshCandidates));
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
			const event = eventBySeq(events, seq);
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
				characterPressure: pressureCost(content)
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
		const sourceSeq = rootToolResultSeq(session, candidate.seq);
		const marker = (startLine) => recoveryMarker(sourceRef(session, sourceSeq), "tool result middle pruned", startLine);
		let head = this.state.config.headChars;
		let tail = this.state.config.tailChars;
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const threshold = head + codePointLength(marker(1)) + tail;
			const content = nativePruneContent(result.content, threshold, head, tail, marker);
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
		let table = this.state.dedupeTables.get(session);
		if (table === void 0) {
			table = new DedupeTable();
			this.state.dedupeTables.set(session, table);
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
			sourceRef: sourceRef(session, candidate.seq),
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
		const sourceRef$1 = sourceRef(session, sourceSeq);
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
					sourceRef: sourceRef$1,
					isError: result.isError === true || candidate.event.data.error !== void 0,
					codeSkeleton
				});
				if (output !== null) {
					const plan = this.plan(candidate, [{
						...textBlock,
						text: output.text
					}], sourceSeq, output.reducer, "fresh", "fresh", void 0, view, {
						noNetSavingsGuard: policy.presetOptions?.noNetSavingsGuard === true,
						...output.elidedLines === void 0 ? {} : { elidedLines: output.elidedLines }
					});
					if (plan !== null && plan.tokensAfter <= policy.freshTargetTokens) return plan;
				}
				if (budgetChars === 1) break;
				budgetChars = Math.max(1, Math.floor(budgetChars / 2));
			}
		}
		return this.planAggregate(candidate, session, view, "fresh-whole-result", "fresh", policy.freshTargetTokens, "fresh");
	}
	planAggregate(candidate, session, view, reducer = "fresh-step-aggregate", stage = "fresh", targetTokens, component = "aggregate", historyMode) {
		if (isError(candidate)) return this.planErrorEvidence(candidate, session, view, stage, targetTokens, component, historyMode);
		const sourceSeq = rootToolResultSeq(session, candidate.seq);
		const sourceRef$2 = sourceRef(session, sourceSeq);
		const text = [
			"[Tool result reduced to satisfy the completed-step aggregate budget]",
			`tool: ${candidate.call.name}`,
			`source: ${sourceRef$2}`,
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
		if (!isError(candidate)) return null;
		const result = candidate.event.data.message.content[0];
		const blocks = onlyTextBlocks(result.content);
		if (blocks === null) return null;
		const text = blocks.map((block) => block.text).join("\n");
		const sourceSeq = rootToolResultSeq(session, candidate.seq);
		const sourceRef$3 = sourceRef(session, sourceSeq);
		const output = historicalPlaceholder({
			toolName: candidate.call.name,
			sourceRef: sourceRef$3,
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
			sourceRef: sourceRef$3,
			isError: true
		}, output)) return null;
		const plan = this.plan(candidate, [{
			type: "text",
			text: output.text
		}], sourceSeq, "error-evidence-placeholder", stage, component, historyMode, view);
		return plan !== null && (targetTokens === void 0 || plan.tokensAfter <= targetTokens) ? plan : null;
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
				const estimatorExpired = this.state.estimatorVerdicts.get(session)?.get(candidate.seq) === true;
				if (readPath !== void 0 && (isSupersededRead(events, candidate.seq, readPath) || estimatorExpired)) {
					const plan = this.planAggregate(candidate, session, view, "superseded-read-whole-result", "pressure", void 0, "history", policy.historyMode);
					if (plan === null) continue;
					planned.push(plan);
					reclaim += plan.tokensBefore - plan.tokensAfter;
					if (reclaim >= required) break;
					continue;
				}
			}
			const sourceSeq = rootToolResultSeq(session, candidate.seq);
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
				sourceRef: sourceRef(session, sourceSeq),
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
				sourceRef: sourceRef(session, sourceSeq),
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
			}], sourceSeq, output.reducer, "pressure", "history", policy.historyMode, view, { ...output.elidedLines === void 0 ? {} : { elidedLines: output.elidedLines } });
			if (plan === null) continue;
			planned.push(plan);
			reclaim += plan.tokensBefore - plan.tokensAfter;
			if (reclaim >= required) break;
		}
		if (reclaim >= batchTarget && planned.length > 0) return historyOutcome(planned);
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
		if (!hasOpenTurn(session)) {
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
		const firstCompletedSurfaceTurn = session.surface.nodes.map((seq) => eventBySeq(events, seq)).filter((event) => (event?.type === "assistant/message" || event?.type === "tool/result") && completedTurns.has(event.data.turn)).reduce((first, event) => first === void 0 ? event.data.turn : Math.min(first, event.data.turn), void 0);
		const nodes = [...session.surface.nodes];
		for (let index = 0; index < nodes.length; index++) {
			const assistantSeq = nodes[index];
			if (assistantSeq === void 0) continue;
			const assistant = eventBySeq(events, assistantSeq);
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
				start: SessionSeq(assistantSeq),
				end: SessionSeq(resultSeqs.at(-1) ?? assistantSeq)
			};
			const surfaceRange = {
				op: "replace",
				startSeq: range.start,
				endSeq: range.end
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
					surfaceOp: surfaceRange,
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
		const boundary = this.state.activeRequestBoundaries.get(session);
		if (boundary === void 0) return true;
		if (this.state.tailTrimBoundaryAttempts.get(session) === boundary) return false;
		this.state.tailTrimBoundaryAttempts.set(session, boundary);
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
		const charsAfter = pressureCost(content);
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
			tokenizerRevision: countBefore.tokenizerRevision,
			...options.elidedLines === void 0 ? {} : { elidedLines: options.elidedLines }
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
				start: SessionSeq(candidate.seq),
				end: SessionSeq(candidate.seq)
			},
			shadowedSeqs: [SessionSeq(candidate.seq)],
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
					startSeq: SessionSeq(candidate.seq),
					endSeq: SessionSeq(candidate.seq)
				},
				sourceEventSeqs: [SessionSeq(candidate.seq)]
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
			tokenizerRevision: plan.tokenizerRevision,
			...plan.elidedLines === void 0 ? {} : { elidedLines: plan.elidedLines }
		});
		if (plan.reducer !== "review-approved-whole-result") this.reviewSummaryFor(session).autoApplied += 1;
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
		if (!hasOpenTurn(session)) throw new Error("tool-result pruning cannot append a surface replacement outside any open turn");
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
	/** Emit the native-auto-compact audit for one summary manifest, once. */
	emitNativeSummaryAudit(session, manifestSeq, data) {
		let audited = this.auditedNativeSummaries.get(session);
		if (audited === void 0) {
			audited = /* @__PURE__ */ new Set();
			this.auditedNativeSummaries.set(session, audited);
		}
		if (audited.has(manifestSeq)) return;
		audited.add(manifestSeq);
		emitCompressionAudit(this.ctx.logger, {
			schemaVersion: 1,
			kind: "native-auto-compact",
			sessionId: String(session.id),
			manifestEventType: "compaction/summary",
			manifestSeq,
			reducer: "llm-summary",
			provider: data.provider === void 0 ? "unknown" : String(data.provider),
			model: data.model === void 0 ? "unknown" : String(data.model),
			tokensBefore: typeof data.shadowedTokenCount === "number" ? data.shadowedTokenCount : null,
			tokensAfter: null
		});
	}
	/**
	* 0.1.5 commits Native auto-compact by reopening the Session with a seed
	* log; seed events never reach the `session/event` firehose, so scan the
	* snapshot for summary manifests the live listener could not observe.
	*/
	scanForSeededNativeSummary(session) {
		for (const event of sessionEvents(session)) if (event.type === "compaction/summary") this.emitNativeSummaryAudit(session, event.seq, event.data);
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
		let warned = this.state.warnedFailures.get(session);
		if (warned === void 0) {
			warned = /* @__PURE__ */ new Set();
			this.state.warnedFailures.set(session, warned);
		}
		if (warned.has(key)) return;
		warned.add(key);
		this.ctx.logger.warn(message, ...args);
	}
};
//#endregion
export { AUTO_COMPACT_THRESHOLD_LIMITS, COMPRESSION_PROFILES, CONTEXT_COMPRESSION_SETTINGS_NAMESPACE, ContextCompressionSettingsSchema, CustomCompressionPolicySchema, DEFAULTS, DEFAULT_CUSTOM_COMPRESSION_POLICY, PRUNE_MARKER, ToolResultPruner, ToolResultPruner as default, codePointLength, historicalPlaceholder, isCompressionProfile, isValidAutoCompactThresholdPercent, measureForCompaction, normalizeTerminalText, parseContextCompressionSettings, reduceFreshToolResult, resolveConfig, resolveCustomPolicy, resolvePolicy, verifyReduction };
