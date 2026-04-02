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

const polygonSignedArea = (polygon: Point[]) => {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
};

const ensureCounterClockwise = (polygon: Point[]) =>
  polygonSignedArea(polygon) >= 0 ? [...polygon] : [...polygon].reverse();

const pointKey = (point: Point) => `${point[0].toFixed(4)}:${point[1].toFixed(4)}`;

const pointOnSegment = (point: Point, a: Point, b: Point, tolerance = 0.02) => {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = point[0] - a[0];
  const apy = point[1] - a[1];
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared <= 1e-9) {
    return distance(point, a) <= tolerance;
  }
  const cross = Math.abs(apx * aby - apy * abx) / Math.sqrt(lengthSquared);
  if (cross > tolerance) {
    return false;
  }
  const dot = apx * abx + apy * aby;
  return dot >= -tolerance && dot <= lengthSquared + tolerance;
};

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

export const mergePolygonsBySharedEdge = (primary: Point[], secondary: Point[]): Point[] | null => {
  type Segment = { a: Point; b: Point };

  const polygons = [ensureCounterClockwise(primary), ensureCounterClockwise(secondary)];
  const allVertices = polygons.flat();

  const splitPolygonIntoSegments = (polygon: Point[]): Segment[] => {
    const segments: Segment[] = [];

    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index]!;
      const b = polygon[(index + 1) % polygon.length]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared <= 1e-9) continue;

      const splitPoints = allVertices
        .filter((point) => pointOnSegment(point, a, b))
        .map((point) => ({
          point,
          t: ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared,
        }))
        .filter(({ t }) => t >= -1e-6 && t <= 1 + 1e-6)
        .sort((left, right) => left.t - right.t)
        .reduce<Array<{ point: Point; t: number }>>((acc, entry) => {
          const last = acc[acc.length - 1];
          if (!last || !pointsEqual(last.point, entry.point, 0.001)) {
            acc.push(entry);
          }
          return acc;
        }, []);

      for (let splitIndex = 0; splitIndex < splitPoints.length - 1; splitIndex += 1) {
        const start = splitPoints[splitIndex]!.point;
        const end = splitPoints[splitIndex + 1]!.point;
        if (!pointsEqual(start, end, 0.001)) {
          segments.push({ a: start, b: end });
        }
      }
    }

    return segments;
  };

  const remaining = new Map<string, Segment[]>();
  for (const segment of polygons.flatMap(splitPolygonIntoSegments)) {
    const reverseKey = `${pointKey(segment.b)}->${pointKey(segment.a)}`;
    const reverseMatches = remaining.get(reverseKey);
    if (reverseMatches && reverseMatches.length > 0) {
      reverseMatches.pop();
      if (reverseMatches.length === 0) {
        remaining.delete(reverseKey);
      }
      continue;
    }

    const key = `${pointKey(segment.a)}->${pointKey(segment.b)}`;
    remaining.set(key, [...(remaining.get(key) ?? []), segment]);
  }

  const boundarySegments = [...remaining.values()].flat();
  if (boundarySegments.length < 3) {
    return null;
  }

  const adjacency = new Map<string, Segment[]>();
  for (const segment of boundarySegments) {
    const key = pointKey(segment.a);
    adjacency.set(key, [...(adjacency.get(key) ?? []), segment]);
  }

  let startSegment = boundarySegments[0]!;
  for (const segment of boundarySegments) {
    if (
      segment.a[0] < startSegment.a[0] ||
      (Math.abs(segment.a[0] - startSegment.a[0]) <= 1e-6 && segment.a[1] < startSegment.a[1])
    ) {
      startSegment = segment;
    }
  }

  const merged: Point[] = [startSegment.a];
  let current = startSegment;
  let guard = 0;

  while (guard < boundarySegments.length + 5) {
    guard += 1;
    merged.push(current.b);
    const nextSegments = adjacency.get(pointKey(current.b)) ?? [];
    const next = nextSegments.find((segment) => !pointsEqual(segment.b, current.a, 0.001));
    if (!next) {
      break;
    }
    current = next;
    if (pointsEqual(current.a, startSegment.a, 0.001)) {
      break;
    }
  }

  const simplified = simplifyClosedPolygon(merged);
  return simplified.length >= 3 ? simplified : null;
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
