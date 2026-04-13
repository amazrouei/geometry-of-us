(function () {
  "use strict";

  /**
   * StructuralDiagnosis
   * -------------------
   * Creates a short interpretive paragraph using:
   * - Symmetry level (High ≥ 70 / Moderate 40–69 / Low < 40)
   * - Shape dominance (Dominant if one shape ≥ 55%, otherwise Balanced)
   *
   * Narrative goal:
   * - Abstract, installation-oriented language
   * - Relational framing without sounding clinical
   * - Never frames an outcome as negative
   */
  class StructuralDiagnosis {
    constructor() {
      this.SYM_HIGH = 70;
      this.SYM_MOD = 40;
      this.DOMINANCE_THRESHOLD = 55;
    }

    /**
     * generate({ symmetryPercent, shapeData, harmonyScore, harmonyLabel })
     * @returns {{ text, symmetryLevel, shapeDominance }}
     */
    generate(input) {
      const symPct = Number(input?.symmetryPercent ?? 50);
      const shapeData = input?.shapeData || {};
      const harmScore = Number(input?.harmonyScore ?? 0);

      const dist = shapeData.distribution || { triangle: 0, square: 0, hexagon: 0 };
      const domShape = shapeData.dominantShape || "None";
      const total = Number(shapeData.totalClassified || 0);

      let symmetryLevel;
      if (symPct >= this.SYM_HIGH) symmetryLevel = "High";
      else if (symPct >= this.SYM_MOD) symmetryLevel = "Moderate";
      else symmetryLevel = "Low";

      const maxShare = Math.max(dist.triangle, dist.square, dist.hexagon);
      const shapeDominance =
        total > 0 && maxShare >= this.DOMINANCE_THRESHOLD ? "Dominant" : "Balanced";

      const sentences = [];
      sentences.push(this._symmetrySentence(symmetryLevel));
      sentences.push(this._shapeSentence(shapeDominance, domShape, dist, total));
      sentences.push(this._combinedSentence(symmetryLevel, shapeDominance, domShape));
      sentences.push(this._harmonySentence(harmScore));
      sentences.push(this._closingSentence(symmetryLevel));

      return {
        text: sentences.join(" "),
        symmetryLevel,
        shapeDominance,
      };
    }

    /* ---------- Sentence builders ---------- */

    _symmetrySentence(level) {
      switch (level) {
        case "High":
          return "The structure settles into a shared rhythm, where alignment appears almost effortlessly between you.";
        case "Moderate":
          return "The structure moves between alignment and variation, holding space for both agreement and difference.";
        default:
          return "The structure resists immediate alignment, forming instead through placement, adjustment, and intention.";
      }
    }

    _shapeSentence(dominance, domShape, dist, total) {
      if (total === 0) {
        return "The reading remains centered on the overall structure, where placement and relation become the primary language.";
      }

      if (dominance === "Balanced") {
        return "No single shape takes over, allowing the composition to remain open and responsive to multiple directions.";
      }

      return this._dominantShapeMeaning(domShape);
    }

    _dominantShapeMeaning(domShape) {
      switch (domShape) {
        case "Triangle":
          return "Triangles guide the structure, introducing a sense of movement and active balancing throughout the composition.";
        case "Square":
          return "Squares ground the structure, holding it in a state of stability and quiet order.";
        case "Hexagon":
          return "Hexagons bring the structure toward cohesion, drawing it closer to a unified and continuous form.";
        default:
          return "One geometric tendency quietly leads, giving the composition a clear structural direction.";
      }
    }

    _combinedSentence(symLevel, shapeDom, domShape) {
      if (symLevel === "High" && shapeDom === "Balanced") {
        return "Closeness appears as both shared and individual, where alignment exists without erasing difference.";
      }
      if (symLevel === "High" && shapeDom === "Dominant") {
        return "Closeness gathers around a shared center, where one structural tendency quietly guides both of you.";
      }
      if (symLevel === "Moderate" && shapeDom === "Balanced") {
        return "Closeness unfolds through negotiation, shaped by moments of alignment and moments of divergence.";
      }
      if (symLevel === "Moderate" && shapeDom === "Dominant") {
        return "A shared direction is present, though it leaves space for variation to remain visible.";
      }
      if (symLevel === "Low" && shapeDom === "Balanced") {
        return "Closeness emerges through exploration, built gradually through interaction rather than immediate agreement.";
      }
      return "The structure begins with distinct gestures, finding meaning through the act of building together.";
    }

    _harmonySentence(score) {
      const s = this._clamp01(score);
      const pct = Math.round(s * 100);

      if (s >= 0.75) {
        return `The composition settles into cohesion (${pct}%), where the structure feels resolved and held together.`;
      }
      if (s >= 0.45) {
        return `The composition holds (${pct}%), steady but still shifting in small and meaningful ways.`;
      }
      return `The composition remains open (${pct}%), still forming through visible choices and adjustments.`;
    }

    _closingSentence(symLevel) {
      if (symLevel === "High") {
        return "Connection appears here through alignment, a shared sense of where things fall into place.";
      }
      if (symLevel === "Moderate") {
        return "Connection appears here through response, a process of noticing, adjusting, and continuing.";
      }
      return "Connection appears here through construction, built slowly through interaction and presence.";
    }

    _clamp01(x) {
      return Math.max(0, Math.min(1, x));
    }
  }

  window.App = window.App || {};
  window.App.StructuralDiagnosis = StructuralDiagnosis;
})();