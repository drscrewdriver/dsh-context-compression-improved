/**
 * 视口比例位置持久化布局模块（百分位制，纯函数、node 环境可测、无 DOM 依赖）。
 *
 * 与 dsh-context-compression-improved monitor-fab 布局模型同构，改动须双侧同步
 * （同串纪律：本文件与其 packages/selector/src/client/fab-pos.ts 逐字节一致，
 * 测试用例同集对齐）。
 *
 * 存储模型：RatioPos { fx, fy } —— 悬浮物左上角相对视口的归一化位置（∈[0,1]，
 * 4 位小数）。兼容读入旧像素存档 { x, y }（按当前视口换算，形状判别即免迁移）。
 * 换算后越界由接线层既有 clamp 兜底；本模块只做比例语义，不做落位。
 */

export interface RatioPos {
    fx: number;
    fy: number;
}

export interface PixelPos {
    x: number;
    y: number;
}

/** vw/vh = 当前视口 CSS 像素；w/h = 悬浮物占位尺寸（本模块不参与运算，供接线层复用形状）。 */
export interface Viewport {
    vw: number;
    vh: number;
    w: number;
    h: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 除法结果的归一化兜底：±Infinity 夹到 1/0，NaN 视为无效。 */
const divClamp = (px: number, vpSize: number): number | null => {
    const q = px / vpSize;
    if (q === Infinity) return 1;
    if (q === -Infinity) return 0;
    if (!Number.isFinite(q)) return null;
    return clamp01(q);
};

/**
 * 读入 localStorage 存量形状并归一为比例态：
 * - {fx,fy} 均有限 → 夹回 [0,1] 直用；
 * - 否则 {x,y} 均有限（旧像素格式）→ 按当前视口除法换算（±Infinity 夹 1/0，NaN 拒）；
 * - 其余（非对象/数组/字段缺失/脏值）→ null，由调用方走默认位。
 */
export function normalizeStored(raw: unknown, vp: Viewport): RatioPos | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (isFin(r.fx) && isFin(r.fy)) return { fx: clamp01(r.fx), fy: clamp01(r.fy) };
    if (!isFin(r.x) || !isFin(r.y)) return null;
    const fx = divClamp(r.x, vp.vw);
    const fy = divClamp(r.y, vp.vh);
    if (fx === null || fy === null) return null;
    return { fx, fy };
}

/** 像素 → 比例，4 位小数舍入；像素本身可为 clamp 后越内值（先夹再存）。 */
export function toRatio(pos: PixelPos, vp: Viewport): RatioPos {
    const fx = divClamp(pos.x, vp.vw);
    const fy = divClamp(pos.y, vp.vh);
    return { fx: fx === null ? 0 : fx, fy: fy === null ? 0 : fy };
}

/** 比例 → 像素（不做 clamp——落位后由接线层既有 clamp 收边）。 */
export function fromRatio(r: RatioPos, vp: Viewport): PixelPos {
    return { x: Math.round(clamp01(r.fx) * vp.vw), y: Math.round(clamp01(r.fy) * vp.vh) };
}
