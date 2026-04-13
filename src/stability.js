(function () {
  "use strict";

  class StabilityTracker {
    /*
      StabilityTracker
      - Purpose: Decide when the camera feed is "stable enough" to freeze a snapshot.
      - Approach:
        - Measure pixel-level motion between current and previous frames (downsampled sampling)
        - Measure shape-level motion between consecutive shape sets (centroid matching)
        - If both motion signals stay under thresholds for enough consecutive frames,
          switch to RESULT and store a snapshot (frame + binary + shapes + palette summary)
      - Key vars:
        - pixelThreshold: max average RGB change to consider stable (lower = stricter)
        - smoothWindow: motion is averaged over recent frames to avoid jitter spikes
        - shapeThreshold: max average centroid movement (in pixels of the small analysis space)
        - maxShapeCountDelta: allows small shape count changes without breaking stability
        - stableFrames + holdFrames: total consecutive frames required to freeze
        - shapeMatchRadius: max distance allowed to match a current shape to a previous shape
    */
    constructor(opts) {
      this.w = opts.w;
      this.h = opts.h;
      this.sampleStep = opts.sampleStep ?? 6;
      this.smoothWindow = opts.smoothWindow ?? 12;

      this.pixelThreshold = opts.stableThreshold ?? 6;
      this.shapeThreshold = opts.shapeStableThreshold ?? 1.4;
      this.maxShapeCountDelta = opts.maxShapeCountDelta ?? 0.25;
      this.shapeMatchRadius = opts.shapeMatchRadius ?? 18;

      this.stableFrames = opts.stableFrames ?? 80;
      this.holdFrames = opts.holdFrames ?? 20;
      this.totalStableFrames = this.stableFrames + this.holdFrames;

      this.warnFrames = opts.warnFrames ?? 12;

      this.reset();
    }

    /*
      reset()
      - Returns tracker to LIVE state and clears all stored history/snapshots.
      - This is called on construction and whenever you want to restart the capture flow.
    */
    reset() {
      this.state = "LIVE";
      this.motionHist = [];
      this.motionAvg = 999;
      this.rawMotion = 999;

      this.shapeMotion = 999;
      this.shapeCountDelta = 1;

      this.consecStable = 0;

      this.snapshotFrame = null;
      this.snapshotBinary = null;
      this.snapshotShapes = [];
      this.snapshotPalette = { totalArea: 0, colors: [] };
      this.snapshotTimeMs = null;

      this.frozenEventPending = false;

      this.prevFrame = null;
      this.prevShapes = null;
    }

    getState() {
      return this.state;
    }

    getMotionAvg() {
      return this.motionAvg;
    }

    /*
      getStableProgress()
      - Returns a 0..1 progress value based on how many stable frames we have collected
        versus the required totalStableFrames.
      - Useful for UI progress rings/bars.
    */
    getStableProgress() {
      const p = this.totalStableFrames > 0 ? this.consecStable / this.totalStableFrames : 0;
      return Math.max(0, Math.min(1, p));
    }

    getSnapshotFrame() {
      return this.snapshotFrame;
    }

    getSnapshotBinary() {
      return this.snapshotBinary;
    }

    getSnapshotShapes() {
      return this.snapshotShapes;
    }

    getSnapshotPalette() {
      return this.snapshotPalette;
    }

    getSnapshotTimeMs() {
      return this.snapshotTimeMs;
    }

    /*
      consumeFrozenEvent()
      - Returns true exactly once after a freeze happens.
      - This lets the UI or pipeline trigger "on freeze" actions without repeating.
    */
    consumeFrozenEvent() {
      if (this.frozenEventPending) {
        this.frozenEventPending = false;
        return true;
      }
      return false;
    }

    /*
      forceFreeze(frame, shapes, binaryImage)
      - Manual override: immediately freezes the current analysis result.
      - Useful for debug tools or an explicit "capture" button.
    */
    forceFreeze(frame, shapes, binaryImage) {
      this._freeze(frame, shapes, binaryImage);
    }

    /*
      update(currFrame, prevFrame, shapes, binaryImage)
      - Main tick function called once per frame.
      - Inputs:
        - currFrame/prevFrame: p5.Graphics or p5.Image with matching dimensions
        - shapes: current detected shapes (from ShapeDetector + ColorAnalyzer)
        - binaryImage: binary p5.Image (optional; stored for result view)
      - Behavior:
        - If stable long enough => freeze and switch state to RESULT
        - If not stable => stay LIVE or STABILIZING and keep tracking
    */
    update(currFrame, prevFrame, shapes, binaryImage) {
      if (!currFrame || !prevFrame) {
        this.prevFrame = currFrame ? currFrame.get() : null;
        this.prevShapes = Array.isArray(shapes) ? this._cloneShapes(shapes) : null;
        return;
      }

      if (this.state === "RESULT") {
        return;
      }

      this.rawMotion = this._pixelMotion(currFrame, prevFrame);
      this._pushMotion(this.rawMotion);
      this.motionAvg = this._mean(this.motionHist);

      const currentShapes = Array.isArray(shapes) ? shapes : [];
      const prevShapesLocal = Array.isArray(this.prevShapes) ? this.prevShapes : [];
      this.shapeMotion = this._shapeMotion(currentShapes, prevShapesLocal, this.shapeMatchRadius);
      this.shapeCountDelta = this._shapeCountDelta(currentShapes, prevShapesLocal);

      const hasShapes = currentShapes.length > 0 || prevShapesLocal.length > 0;

      const stableNow =
        this.motionAvg < this.pixelThreshold &&
        (!hasShapes ||
          (this.shapeMotion < this.shapeThreshold &&
            this.shapeCountDelta < this.maxShapeCountDelta));

      if (stableNow) {
        this.consecStable += 1;
        if (this.consecStable >= this.totalStableFrames) {
          this._freeze(currFrame, currentShapes, binaryImage);
        } else {
          this.state = "STABILIZING";
        }
      } else {
        this.consecStable = 0;
        this.state = "LIVE";
      }

      // Keep copies for next-frame comparisons (avoid mutating references).
      this.prevFrame = currFrame.get();
      this.prevShapes = this._cloneShapes(currentShapes);
    }

    /*
      _freeze(frame, shapes, binaryImage)
      - Stores the final snapshot and switches the tracker to RESULT state.
      - Also computes a palette summary from the shape areas + dominantColorName.
    */
    _freeze(frame, shapes, binaryImage) {
      this.state = "RESULT";
      this.snapshotFrame = frame.get();
      this.snapshotBinary = binaryImage ? binaryImage.get() : null;
      this.snapshotShapes = this._cloneShapes(shapes || []);
      this.snapshotPalette = this._computePalette(this.snapshotShapes);
      this.snapshotTimeMs = Date.now();
      this.frozenEventPending = true;
    }

    /*
      _pixelMotion(a, b)
      - Computes average absolute RGB difference between two frames.
      - Uses sampleStep to avoid processing every pixel (performance).
      - Returns a motion value where smaller means more stable.
    */
    _pixelMotion(a, b) {
      a.loadPixels();
      b.loadPixels();

      const pa = a.pixels;
      const pb = b.pixels;

      if (!pa || !pb || pa.length !== pb.length) return 999;

      const step = Math.max(1, this.sampleStep);
      const w = a.width;
      const h = a.height;

      let sum = 0;
      let n = 0;

      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const idx = 4 * (y * w + x);
          const dr = Math.abs(pa[idx] - pb[idx]);
          const dg = Math.abs(pa[idx + 1] - pb[idx + 1]);
          const db = Math.abs(pa[idx + 2] - pb[idx + 2]);
          sum += (dr + dg + db) / 3;
          n += 1;
        }
      }

      return n > 0 ? sum / n : 999;
    }

    /*
      _pushMotion(v)
      - Adds the newest motion value and keeps only the last smoothWindow values.
      - This creates a stable moving average for decision-making.
    */
    _pushMotion(v) {
      this.motionHist.push(v);
      const maxLen = Math.max(1, this.smoothWindow);
      while (this.motionHist.length > maxLen) this.motionHist.shift();
    }

    _mean(arr) {
      if (!arr || !arr.length) return 999;
      let s = 0;
      for (let i = 0; i < arr.length; i++) s += arr[i];
      return s / arr.length;
    }

    /*
      _shapeCountDelta(curr, prev)
      - Measures how much the shape count changed relative to previous frame.
      - This helps treat sudden appearance/disappearance as instability.
    */
    _shapeCountDelta(curr, prev) {
      const a = (curr && curr.length) ? curr.length : 0;
      const b = (prev && prev.length) ? prev.length : 0;
      const denom = Math.max(1, b);
      return Math.abs(a - b) / denom;
    }

    /*
      _shapeMotion(currShapes, prevShapes, radius)
      - Matches current shapes to previous shapes by nearest centroid.
      - Returns the average matched distance (pixels in the small analysis space).
      - If no matches can be made, returns 999 to force instability.
    */
    _shapeMotion(currShapes, prevShapes, radius) {
      const a = currShapes ? currShapes.length : 0;
      const b = prevShapes ? prevShapes.length : 0;

      if (a === 0 && b === 0) return 0;
      if (a === 0 || b === 0) return 999;

      const usedPrev = new Array(prevShapes.length).fill(false);
      let sum = 0;
      let matches = 0;

      for (let i = 0; i < currShapes.length; i++) {
        const c = currShapes[i]?.centroid;
        if (!c) continue;

        let bestJ = -1;
        let bestD = Infinity;

        for (let j = 0; j < prevShapes.length; j++) {
          if (usedPrev[j]) continue;
          const p = prevShapes[j]?.centroid;
          if (!p) continue;

          const dx = c.x - p.x;
          const dy = c.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);

          if (d < bestD) {
            bestD = d;
            bestJ = j;
          }
        }

        if (bestJ >= 0 && bestD <= radius) {
          usedPrev[bestJ] = true;
          sum += bestD;
          matches += 1;
        }
      }

      if (matches === 0) return 999;
      return sum / matches;
    }

    /*
      _cloneShapes(shapes)
      - Creates a safe copy of shape objects so future mutations do not affect history/snapshots.
      - Keeps only the fields needed for stability and result rendering.
    */
    _cloneShapes(shapes) {
      const out = [];
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i] || {};
        const contour = Array.isArray(s.contour)
          ? s.contour.map((p) => ({ x: p.x, y: p.y }))
          : [];

        out.push({
          id: s.id,
          contour: contour,
          centroid: s.centroid ? { x: s.centroid.x, y: s.centroid.y } : null,
          area: s.area,
          perimeter: s.perimeter,
          bbox: s.bbox ? { x: s.bbox.x, y: s.bbox.y, w: s.bbox.w, h: s.bbox.h } : null,
          orientationDeg: (typeof s.orientationDeg === "number" ? s.orientationDeg : s.orientation),
          complexity: s.complexity,
          dominantColorName: s.dominantColorName,
          dominantColorRGB: s.dominantColorRGB || null,
          dominantColorHSV: s.dominantColorHSV || null,
          colorConfidence: s.colorConfidence
        });
      }
      return out;
    }

    /*
      _computePalette(shapes)
      - Aggregates total area by dominantColorName and converts it to percent shares.
      - Output is sorted by area descending for easy "top colors" display.
    */
    _computePalette(shapes) {
      const map = Object.create(null);
      let tot = 0;

      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        const a = Math.max(0, Number(s.area || 0));
        if (!a) continue;
        const name = s.dominantColorName || "Unknown";
        map[name] = (map[name] || 0) + a;
        tot += a;
      }

      const colors = Object.keys(map)
        .map((name) => ({
          name,
          area: map[name],
          percent: tot > 0 ? (map[name] / tot) * 100 : 0,
        }))
        .sort((a, b) => b.area - a.area);

      return { totalArea: tot, colors };
    }
  }

  window.App = window.App || {};
  window.App.StabilityTracker = StabilityTracker;
})();
