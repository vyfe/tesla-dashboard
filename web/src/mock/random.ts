/**
 * 确定性伪随机数：同一个 seed 永远产出同一串数字。
 *
 * demo 数据全靠它生成——保证每次打开看到的内容完全一致，
 * 截图、录屏、演示都能复现，不会出现「刚才那页数字怎么变了」。
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  /** 闭区间整数 [min, max]。 */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** 近似正态分布，让数值看起来自然而不呆板。 */
  normal(mean: number, stdDev: number): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
