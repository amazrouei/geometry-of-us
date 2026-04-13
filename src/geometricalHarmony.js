(function () {
  "use strict";

  /**
   * GeometricalHarmonyScorer
   * ─────────────────────────
   * Computes the Geometrical Harmony score (0–1) from:
   *   • Symmetry score        (weight 0.6)
   *   • Shape Balance Score   (weight 0.4)
   *
   * Color is intentionally EXCLUDED from this score.
   *
   * Shape Balance Score is derived from the variance of the
   * Triangle / Square / Hexagon area-distribution.
   *   – Perfect balance [33.3%, 33.3%, 33.3%] → 1.0
   *   – Complete dominance [100%, 0%, 0%]      → 0.0
   *
   * Classification labels (decimal):
   *   0.80–1.00  Structurally Unified
   *   0.60–0.79  Balanced
   *   0.40–0.59  Transitional
   *   0.20–0.39  Fragmented
   *   0.00–0.19  Abstract
   */
  class GeometricalHarmonyScorer {
    constructor(config) {
      const gh = config?.geometricalHarmony || {};
      this.wSym   = Number(gh.symmetryWeight     ?? 0.60);
      this.wShape = Number(gh.shapeBalanceWeight  ?? 0.40);

      // Normalise so weights sum to 1.
      const s = this.wSym + this.wShape;
      if (s > 0) { this.wSym /= s; this.wShape /= s; }

      // Maximum variance for 3 categories summing to 100.
      // Occurs at [100, 0, 0]: var = ((66.67² + 33.33² + 33.33²) / 3) ≈ 2222.22
      this.MAX_VARIANCE = 2222.2222;
    }

    /**
     * compute(symmetryScore01, distribution, totalClassified)
     * @param {number}  symmetryScore01   Normalised mirror-symmetry (0–1).
     * @param {object}  distribution      { triangle: %, square: %, hexagon: % }  (sums to ~100).
     * @param {number}  totalClassified   Number of shapes that were classified.
     * @returns {object}  { score, scorePercent, label, shapeBalanceScore,
     *                      symmetryComponent, shapeComponent, distribution }
     */
    compute(symmetryScore01, distribution, totalClassified) {
      const S = this._clamp01(Number(symmetryScore01 || 0));

      const T = Number(distribution?.triangle || 0);
      const Q = Number(distribution?.square   || 0);
      const H = Number(distribution?.hexagon  || 0);

      const shapeBalance = this._shapeBalanceScore(T, Q, H, totalClassified);

      const raw = this.wSym * S + this.wShape * shapeBalance;
      const score = this._clamp01(raw);
      const scorePercent = Math.round(score * 100);

      return {
        score:               parseFloat(score.toFixed(4)),
        scorePercent,
        label:               this._classify(score),
        shapeBalanceScore:   parseFloat(shapeBalance.toFixed(4)),
        symmetryInput:       parseFloat(S.toFixed(4)),
        symmetryComponent:   parseFloat((this.wSym * S).toFixed(4)),
        shapeComponent:      parseFloat((this.wShape * shapeBalance).toFixed(4)),
        distribution:        { triangle: Math.round(T), square: Math.round(Q), hexagon: Math.round(H) },
      };
    }

    /* ──────────────── INTERNAL ──────────────── */

    /**
     * Shape Balance Score = 1 − (variance / MAX_VARIANCE)
     * where variance = mean of squared deviations from the 33.33% ideal.
     */
    _shapeBalanceScore(T, Q, H, total) {
      if (!total || total === 0) return 0.5; // no data → neutral

      const mean = (T + Q + H) / 3;
      const variance = ((T - mean) ** 2 + (Q - mean) ** 2 + (H - mean) ** 2) / 3;

      return this._clamp01(1 - variance / this.MAX_VARIANCE);
    }

_classify(score) {
  if (score >= 0.80) return "Deeply Connected";
  if (score >= 0.60) return "Strongly Connected";
  if (score >= 0.40) return "Moderately Connected";
  if (score >= 0.20) return "Distant";
  return "Disconnected";
}

    _clamp01(x) {
      return Math.max(0, Math.min(1, x));
    }
  }

  window.App = window.App || {};
  window.App.GeometricalHarmonyScorer = GeometricalHarmonyScorer;
})();
