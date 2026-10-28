/**
 * fab-pos 纯函数钉桩（node 环境，无 DOM）——契约冻结点。
 * 与 dsh-context-compression-improved packages/selector/tests/fab-pos.spec.ts 同集对齐。
 */
import { describe, expect, it } from 'vitest';

import { fromRatio, normalizeStored, toRatio, type Viewport } from '../src/client/fab-pos';

const VP: Viewport = { vw: 1920, vh: 1080, w: 48, h: 48 };

describe('fab-pos viewport-fraction layout', () => {
    it('新格式 {fx,fy} 透传原样', () => {
        expect(normalizeStored({ fx: 0.5, fy: 0.5 }, VP)).toEqual({ fx: 0.5, fy: 0.5 });
    });

    it('旧格式 {x,y} 按当前视口换算', () => {
        expect(normalizeStored({ x: 960, y: 540 }, VP)).toEqual({ fx: 0.5, fy: 0.5 });
    });

    it('脏输入（非对象/数组/字段缺失/非有限数）返 null', () => {
        expect(normalizeStored(null, VP)).toBeNull();
        expect(normalizeStored('{"x":1}', VP)).toBeNull();
        expect(normalizeStored([1, 2], VP)).toBeNull();
        expect(normalizeStored({ x: 10 }, VP)).toBeNull();
        expect(normalizeStored({ x: NaN, y: 5 }, VP)).toBeNull();
        expect(normalizeStored({ fx: 0.1, fy: Infinity }, VP)).toBeNull();
    });

    it('fx/fy 越界夹回 [0,1]', () => {
        expect(normalizeStored({ fx: 1.5, fy: -0.2 }, VP)).toEqual({ fx: 1, fy: 0 });
    });

    it('toRatio→fromRatio 往返误差 ≤1px', () => {
        for (const [x, y] of [[1752, 902], [0, 0], [1919, 1079], [640, 360], [48, 96]] as const) {
            const back = fromRatio(toRatio({ x, y }, VP), VP);
            expect(Math.abs(back.x - x)).toBeLessThanOrEqual(1);
            expect(Math.abs(back.y - y)).toBeLessThanOrEqual(1);
        }
    });

    it('vw=0 防御：旧格式除法产 Infinity 夹成 1，不抛错', () => {
        const degenerate: Viewport = { vw: 0, vh: 0, w: 48, h: 48 };
        expect(normalizeStored({ x: 960, y: 540 }, degenerate)).toEqual({ fx: 1, fy: 1 });
        expect(() => toRatio({ x: 960, y: 540 }, degenerate)).not.toThrow();
        expect(fromRatio({ fx: 1, fy: 1 }, degenerate)).toEqual({ x: 0, y: 0 });
    });
});
