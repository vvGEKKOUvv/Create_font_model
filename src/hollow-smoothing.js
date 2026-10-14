// A parallel inward offset forms cusps once thickness exceeds the local
// curvature radius. Bound it only along smoothly sampled convex boundaries;
// intentional polygon corners keep their existing miter behavior.
export function safeHollowThickness(rings, requestedThickness) {
  let radius = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const at = j => ring[(j + ring.length) % ring.length];
      const angle = j => {
        const a = at(j - 1), b = at(j), c = at(j + 1);
        const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
        return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      };
      const turn = angle(i);
      // Filled regions are on the left of normalized contours. Only positive
      // curvature shrinks its radius when the filled region is offset inward.
      if (!(turn > 1e-6 && turn < Math.PI / 9) ||
        Math.abs(angle(i - 1)) >= Math.PI / 9 || Math.abs(angle(i + 1)) >= Math.PI / 9) continue;
      const a = at(i - 1), b = at(i), c = at(i + 1);
      const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y);
      const ac = Math.hypot(c.x - a.x, c.y - a.y);
      const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (cross > 0 && ab > 0 && bc > 0) radius = Math.min(radius, ab * bc * ac / (2 * cross));
    }
  }
  return Math.min(requestedThickness, radius * 0.8);
}
