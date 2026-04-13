(function () {
  "use strict";

  /**
   * ShapeClassifier
   * ───────────────
   * Classifies detected shapes into Triangle / Square / Hexagon using:
   *   1. Convex-hull computation  (Andrew's monotone-chain)
   *   2. Polygon simplification   (closed-polygon Douglas–Peucker)
   *   3. Vertex counting → classification
   *   4. Complexity fallback for ambiguous cases
   *
   * Public API:
   *   classify(shapes)  →  { shapes, distribution, dominantShape, counts, totalClassified }
   */
  class ShapeClassifier {
    constructor(options = {}) {
      // Douglas–Peucker epsilon as a fraction of the hull perimeter.
      this.dpEpsilonRatio = Number(options.dpEpsilonRatio || 0.04);
      this.minContourPoints = Math.max(3, Number(options.minContourPoints || 5));
    }

    /* ──────────────── PUBLIC ──────────────── */

    /**
     * classify(shapes)
     * Adds a `shapeType` field ("Triangle" | "Square" | "Hexagon") to each shape
     * and returns the area-weighted distribution + dominant shape.
     */
    classify(shapes) {
      if (!shapes || !shapes.length) {
        return {
          shapes: [],
          distribution: { triangle: 0, square: 0, hexagon: 0 },
          dominantShape: "None",
          counts: { triangle: 0, square: 0, hexagon: 0 },
          totalClassified: 0,
        };
      }

      let tArea = 0, sArea = 0, hArea = 0;
      let tCount = 0, sCount = 0, hCount = 0;

      for (const shape of shapes) {
        const type = this._classifyShape(shape);
        shape.shapeType = type;

        const area = Math.max(0, Number(shape.area || 0));
        switch (type) {
          case "Triangle": tCount++; tArea += area; break;
          case "Square":   sCount++; sArea += area; break;
          case "Hexagon":  hCount++; hArea += area; break;
        }
      }

      const totalArea = tArea + sArea + hArea;
      const distribution = {
        triangle: totalArea > 0 ? (tArea / totalArea) * 100 : 0,
        square:   totalArea > 0 ? (sArea / totalArea) * 100 : 0,
        hexagon:  totalArea > 0 ? (hArea / totalArea) * 100 : 0,
      };

      let dominantShape = "Triangle";
      if (distribution.square >= distribution.triangle && distribution.square >= distribution.hexagon) {
        dominantShape = "Square";
      } else if (distribution.hexagon >= distribution.triangle && distribution.hexagon >= distribution.square) {
        dominantShape = "Hexagon";
      }

      return {
        shapes,
        distribution,
        dominantShape,
        counts: { triangle: tCount, square: sCount, hexagon: hCount },
        totalClassified: tCount + sCount + hCount,
      };
    }

    /* ──────────────── INTERNAL ──────────────── */

    _classifyShape(shape) {
      const contour = shape.contour;
      const complexity = Number(shape.complexity || 1);

      if (!contour || contour.length < this.minContourPoints) {
        return this._classifyByComplexity(complexity);
      }

      const hull = this._convexHull(contour);
      if (hull.length < 3) return this._classifyByComplexity(complexity);

      const perim = this._polygonPerimeter(hull);
      const epsilon = this.dpEpsilonRatio * perim;
      const simplified = this._simplifyClosedPolygon(hull, epsilon);

      const v = simplified.length;

      if (v <= 3)  return "Triangle";
      if (v === 4) return "Square";
      if (v <= 6)  return "Hexagon";

      return this._classifyByComplexity(complexity);
    }

    _classifyByComplexity(c) {
      if (c > 1.35) return "Triangle";
      if (c > 1.15) return "Square";
      return "Hexagon";
    }

    /* ─── Convex hull (Andrew's monotone chain) ─── */
    _convexHull(points) {
      const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
      if (pts.length <= 2) return pts.slice();

      const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);

      const lower = [];
      for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }

      const upper = [];
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }

      lower.pop();
      upper.pop();
      return lower.concat(upper);
    }

    /* ─── Polygon perimeter ─── */
    _polygonPerimeter(pts) {
      let perim = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        perim += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      }
      return perim;
    }

    /* ─── Closed-polygon Douglas–Peucker simplification ─── */
    _simplifyClosedPolygon(points, epsilon) {
      if (points.length <= 3) return points.slice();

      // Find two farthest-apart vertices as fixed anchors.
      let maxD = 0, idxA = 0, idxB = 0;
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const d = (points[i].x - points[j].x) ** 2 + (points[i].y - points[j].y) ** 2;
          if (d > maxD) { maxD = d; idxA = i; idxB = j; }
        }
      }

      const half1 = this._extractChain(points, idxA, idxB);
      const half2 = this._extractChain(points, idxB, idxA);

      const s1 = this._dpOpen(half1, epsilon);
      const s2 = this._dpOpen(half2, epsilon);

      return s1.slice(0, -1).concat(s2.slice(0, -1));
    }

    _extractChain(pts, from, to) {
      const chain = [];
      const n = pts.length;
      for (let i = from; ; i = (i + 1) % n) {
        chain.push(pts[i]);
        if (i === to) break;
        if (chain.length > n + 1) break; // safety
      }
      return chain;
    }

    /* ─── Standard open-polyline Douglas–Peucker ─── */
    _dpOpen(pts, epsilon) {
      if (pts.length <= 2) return pts.slice();

      let dmax = 0, idx = 0;
      const last = pts.length - 1;

      for (let i = 1; i < last; i++) {
        const d = this._perpDist(pts[i], pts[0], pts[last]);
        if (d > dmax) { dmax = d; idx = i; }
      }

      if (dmax > epsilon) {
        const left  = this._dpOpen(pts.slice(0, idx + 1), epsilon);
        const right = this._dpOpen(pts.slice(idx), epsilon);
        return left.slice(0, -1).concat(right);
      }

      return [pts[0], pts[last]];
    }

    _perpDist(P, A, B) {
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-10) return Math.sqrt((P.x - A.x) ** 2 + (P.y - A.y) ** 2);
      return Math.abs(dy * P.x - dx * P.y + B.x * A.y - B.y * A.x) / len;
    }
  }

  window.App = window.App || {};
  window.App.ShapeClassifier = ShapeClassifier;
})();
