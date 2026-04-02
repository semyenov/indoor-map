export type Point = [number, number];

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const polygonCentroid = (points: Point[]): Point => {
  if (points.length === 0) return [0, 0];
  const total = points.reduce(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1]] as Point,
    [0, 0],
  );
  return [total[0] / points.length, total[1] / points.length];
};

export const nearestPointOnSegment = (point: Point, a: Point, b: Point): Point => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq));
  return [a[0] + dx * t, a[1] + dy * t];
};

export const nearestPointOnLine = (point: Point, a: Point, b: Point): Point => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq;
  return [a[0] + dx * t, a[1] + dy * t];
};

export const lineIntersection = (a0: Point, a1: Point, b0: Point, b1: Point): Point | null => {
  const ax = a1[0] - a0[0];
  const ay = a1[1] - a0[1];
  const bx = b1[0] - b0[0];
  const by = b1[1] - b0[1];
  const det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-9) return null;

  const dx = b0[0] - a0[0];
  const dy = b0[1] - a0[1];
  const t = (dx * by - dy * bx) / det;
  return [a0[0] + ax * t, a0[1] + ay * t];
};
