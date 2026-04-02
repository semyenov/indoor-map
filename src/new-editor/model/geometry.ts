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

const pointsEqual = (a: Point, b: Point, tolerance = 1e-6) =>
  Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;

const signedTriangleArea = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const stripDuplicateClosure = (polygon: Point[]) => {
  if (polygon.length > 1 && pointsEqual(polygon[0]!, polygon[polygon.length - 1]!)) {
    return polygon.slice(0, -1);
  }
  return polygon;
};

const simplifyClosedPolygon = (polygon: Point[]) => {
  const points = stripDuplicateClosure(polygon);
  if (points.length <= 3) return points;
  let current = [...points];
  let changed = true;
  while (changed && current.length > 3) {
    changed = false;
    current = current.filter((point, index) => {
      const prev = current[(index - 1 + current.length) % current.length]!;
      const next = current[(index + 1) % current.length]!;
      if (pointsEqual(prev, point) || pointsEqual(point, next)) {
        changed = true;
        return false;
      }
      if (Math.abs(signedTriangleArea(prev, point, next)) <= 1e-6) {
        changed = true;
        return false;
      }
      return true;
    });
  }
  return current;
};

const pathWithoutSharedEdge = (polygon: Point[], edgeIndex: number) => {
  const path: Point[] = [];
  for (let offset = 0; offset < polygon.length; offset += 1) {
    path.push(polygon[(edgeIndex + 1 + offset) % polygon.length]!);
  }
  return path;
};

export const mergePolygonsBySharedEdge = (primary: Point[], secondary: Point[]): Point[] | null => {
  for (let primaryEdgeIndex = 0; primaryEdgeIndex < primary.length; primaryEdgeIndex += 1) {
    const primaryA = primary[primaryEdgeIndex]!;
    const primaryB = primary[(primaryEdgeIndex + 1) % primary.length]!;
    for (let secondaryEdgeIndex = 0; secondaryEdgeIndex < secondary.length; secondaryEdgeIndex += 1) {
      const secondaryA = secondary[secondaryEdgeIndex]!;
      const secondaryB = secondary[(secondaryEdgeIndex + 1) % secondary.length]!;
      if (!pointsEqual(primaryA, secondaryB) || !pointsEqual(primaryB, secondaryA)) {
        continue;
      }
      const primaryPath = pathWithoutSharedEdge(primary, primaryEdgeIndex);
      const secondaryPath = pathWithoutSharedEdge(secondary, secondaryEdgeIndex);
      const merged = simplifyClosedPolygon([...primaryPath, ...secondaryPath.slice(1)]);
      return merged.length >= 3 ? merged : null;
    }
  }
  return null;
};

export const pointOnPolygonEdge = (point: Point, polygon: Point[], tolerance = 0.05) => {
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const projection = nearestPointOnSegment(point, a, b);
    if (distance(point, projection) <= tolerance) {
      return true;
    }
  }
  return false;
};
