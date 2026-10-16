import { profileSpanIsStraight } from './bevel-profile.js';
const cache = new Map();

/** Every control vertex is an edge. Add `divisions` equal arc-length cuts
 * independently within each neighboring pair of controls. */
export function sampleBevelProfile(controls, evaluate, divisions, { height = 1, width = 1, straightFallback = false, cacheKey } = {}) {
  const count = Math.max(0, Math.floor(divisions));
  const anchors = controls.length >= 2 ? controls : [{ x: 0 }, { x: 1 }];
  const key = JSON.stringify([controls, count, height, width, straightFallback, cacheKey]);
  const canCache = controls.length >= 2 || cacheKey !== undefined;
  if (canCache && cache.has(key)) return cache.get(key).slice();
  const result = [anchors[0].x];
  for (let span = 0; span < anchors.length - 1; span++) {
    const a = anchors[span], b = anchors[span + 1];
    const straight = controls.length >= 2 ? profileSpanIsStraight(a, b) : straightFallback;
    if (count && straight) {
      for (let j = 1; j <= count; j++) result.push(a.x + (b.x - a.x) * j / (count + 1));
    } else if (count) {
      const resolution = 512, cumulative = [0], step = (b.x - a.x) / resolution;
      let previous = evaluate(a.x);
      for (let i = 1; i <= resolution; i++) {
        const value = evaluate(a.x + step * i);
        cumulative.push(cumulative.at(-1) + Math.hypot(height * step, width * (value - previous)));
        previous = value;
      }
      for (let j = 1; j <= count; j++) {
        const target = cumulative.at(-1) * j / (count + 1);
        let low = 0, high = resolution;
        while (high - low > 1) { const mid = (low + high) >> 1; if (cumulative[mid] < target) low = mid; else high = mid; }
        const length = cumulative[high] - cumulative[low];
        result.push(a.x + step * (low + (length > 0 ? (target - cumulative[low]) / length : 0)));
      }
    }
    result.push(b.x);
  }
  if (canCache) { if (cache.size >= 64) cache.delete(cache.keys().next().value); cache.set(key, result); }
  return result.slice();
}
