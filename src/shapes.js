(function () {
  "use strict";

  class ShapeDetector {
    /*
      ShapeDetector
      - Purpose: Find connected components (shapes) inside a binary mask (0/1),
        and compute basic geometry features for each detected shape.
      - Approach:
        - Scan the mask; when an unvisited "1" pixel is found, flood-fill that component
        - During flood-fill, compute area, centroid sums, bounding box, perimeter, and boundary points
        - After flood-fill, compute orientation (from covariance) and complexity (compactness)
        - Return a list of shape objects ready for later steps (color assignment, scoring, etc.)
      - Key tuning vars:
        - minArea: ignore tiny noise components
        - maxAreaRatio: ignore components that are too large (usually background blobs)
        - maxShapes: safety limit to keep runtime stable
        - maxContourPoints: boundary sampling limit for drawing / later algorithms
        - use8Connectivity: if true, diagonals connect (8-neighbor); otherwise 4-neighbor only
    */
    constructor(options = {}) {
      const {
        w,
        h,
        minArea = 120,
        maxAreaRatio = 0.65,
        maxShapes = 30,
        maxContourPoints = 200,
        use8Connectivity = true,
      } = options;

      if (!w || !h) throw new Error("ShapeDetector requires w and h");

      this.w = w;
      this.h = h;
      this.size = w * h;

      this.minArea = Math.max(1, Math.floor(minArea));
      this.maxArea = Math.floor(this.size * maxAreaRatio);
      this.maxShapes = Math.max(1, Math.floor(maxShapes));
      this.maxContourPoints = Math.max(20, Math.floor(maxContourPoints));
      this.use8 = !!use8Connectivity;

      // Preallocated buffers to avoid per-frame allocations.
      this.vis = new Uint8Array(this.size);
      this.labels = new Int32Array(this.size);
      this.stack = new Int32Array(this.size);
    }

    /*
      detect(bin)
      - Input: bin is a flat Uint8Array mask of length w*h with values 0 or 1.
      - Output: array of shape objects (geometry only; color fields are left empty here).
      - Note: labels[] is filled with component ids for optional visualization/debugging.
    */
    detect(bin) {
      if (!bin || bin.length !== this.size) return [];

      this.vis.fill(0);
      this.labels.fill(0);

      const shapes = [];
      let idCounter = 1;

      for (let i = 0; i < this.size; i++) {
        if (bin[i] !== 1 || this.vis[i] === 1) continue;

        const shape = this._floodComponent(bin, i, idCounter);
        if (shape) {
          shapes.push(shape);
          idCounter++;
          if (shapes.length >= this.maxShapes) break;
        } else {
        }
      }

      return shapes;
    }

    /*
      getLabelMap()
      - Returns the label buffer (w*h) where 0 means background,
        and >0 is the detected shape id.
    */
    getLabelMap() {
      return this.labels;
    }

    /*
      _floodComponent(bin, startIdx, id)
      - Flood-fills one connected component starting from startIdx.
      - Computes:
        - area and centroid (via sums)
        - bounding box
        - perimeter approximation (edge exposure to background)
        - boundary points (for contour sampling / drawing)
        - orientation via second moments (covariance matrix)
        - complexity (perimeter^2 / (4π area)), where ~1 is circle-like, larger is more irregular
      - Returns null if component is rejected by min/max area.
    */
    _floodComponent(bin, startIdx, id) {
      let sp = 0;

      this.stack[sp++] = startIdx;
      this.vis[startIdx] = 1;
      this.labels[startIdx] = id;

      let area = 0;

      let sumX = 0, sumY = 0;
      let sumXX = 0, sumYY = 0, sumXY = 0;

      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;

      let perimeter = 0;

      const boundary = [];

      const w = this.w, h = this.h;

      while (sp > 0) {
        const idx = this.stack[--sp];
        const x = idx % w;
        const y = (idx / w) | 0;

        area++;
        sumX += x;
        sumY += y;
        sumXX += x * x;
        sumYY += y * y;
        sumXY += x * y;

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;

        let isBoundary = false;

        // Perimeter is approximated by counting exposed 4-neighbor edges.
        if (x === 0 || bin[idx - 1] === 0) { perimeter++; isBoundary = true; }
        if (x === w - 1 || bin[idx + 1] === 0) { perimeter++; isBoundary = true; }
        if (y === 0 || bin[idx - w] === 0) { perimeter++; isBoundary = true; }
        if (y === h - 1 || bin[idx + w] === 0) { perimeter++; isBoundary = true; }

        if (isBoundary) boundary.push({ x, y });

        // Connectivity controls how pixels are grouped: 8-connect includes diagonals.
        if (this.use8) {
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= h) continue;

            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              if (nx < 0 || nx >= w) continue;

              const nidx = ny * w + nx;
              if (bin[nidx] === 1 && this.vis[nidx] === 0) {
                this.vis[nidx] = 1;
                this.labels[nidx] = id;
                this.stack[sp++] = nidx;
              }
            }
          }
        } else {
          const n1 = idx - 1, n2 = idx + 1, n3 = idx - w, n4 = idx + w;
          if (x > 0 && bin[n1] === 1 && this.vis[n1] === 0) { this.vis[n1] = 1; this.labels[n1] = id; this.stack[sp++] = n1; }
          if (x < w - 1 && bin[n2] === 1 && this.vis[n2] === 0) { this.vis[n2] = 1; this.labels[n2] = id; this.stack[sp++] = n2; }
          if (y > 0 && bin[n3] === 1 && this.vis[n3] === 0) { this.vis[n3] = 1; this.labels[n3] = id; this.stack[sp++] = n3; }
          if (y < h - 1 && bin[n4] === 1 && this.vis[n4] === 0) { this.vis[n4] = 1; this.labels[n4] = id; this.stack[sp++] = n4; }
        }

        // Hard safety check: if something goes wrong, stop before overflowing the stack.
        if (sp >= this.stack.length) break;
      }

      if (area < this.minArea) return null;
      if (area > this.maxArea) return null;

      const cx = sumX / area;
      const cy = sumY / area;

      // Second moments -> covariance matrix for orientation estimation.
      const exx = sumXX / area;
      const eyy = sumYY / area;
      const exy = sumXY / area;

      const covXX = exx - cx * cx;
      const covYY = eyy - cy * cy;
      const covXY = exy - cx * cy;

      const angleRad = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
      const orientationDeg = angleRad * (180 / Math.PI);

      const complexity = (perimeter * perimeter) / (4 * Math.PI * area);

      const contour = this._sampleBoundary(boundary, this.maxContourPoints);

      return {
        id,
        contour,
        centroid: { x: cx, y: cy },
        area,
        perimeter,
        orientation: orientationDeg,
        complexity,
        bbox: { x: minX, y: minY, w: (maxX - minX + 1), h: (maxY - minY + 1) },

        dominantColorName: null,
        dominantColorRGB: null,
        dominantColorHSV: null,
        colorConfidence: 0,
      };
    }

    /*
      _sampleBoundary(boundary, maxPts)
      - Keeps the contour lightweight by sampling points uniformly.
      - This is mainly for drawing and downstream logic that does not need all points.
    */
    _sampleBoundary(boundary, maxPts) {
      if (boundary.length <= maxPts) return boundary;

      const step = boundary.length / maxPts;
      const sampled = [];
      for (let i = 0; i < maxPts; i++) {
        const idx = Math.floor(i * step);
        sampled.push(boundary[idx]);
      }
      return sampled;
    }
  }

  window.App = window.App || {};
  window.App.ShapeDetector = ShapeDetector;
})();
