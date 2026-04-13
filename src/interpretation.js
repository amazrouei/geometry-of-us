(function () {
  "use strict";

  class InterpretiveTextGenerator {
    /*
      InterpretiveTextGenerator
      - Purpose: Turn numeric analysis results (scores + shapes + palette stats) into short,
        human-readable interpretation lines and a small set of tags.
      - Approach:
        - Derive a few signals (balance, hue-contrast, effective palette size, dominant color share)
        - Classify the composition using thresholds (high/mid/low)
        - Produce up to 4 clean lines + tags for UI display
      - Key variables:
        - TH_HIGH / TH_MID / TH_LOW: thresholds for score interpretation (0..100)
        - CONTRAST_HIGH: threshold for "strong hue contrast" (0..1)
        - BAL_HIGH: threshold for "centered weight" (0..100)
        - SCATTER_EFF_COLORS / DOM_MIN_SHARE: rules to detect "scattered palette"
    */
    constructor(interpretationConfig) {
      const t = interpretationConfig?.thresholds || {};
      this.TH_HIGH = Number(t.high ?? 75);
      this.TH_MID = Number(t.mid ?? 55);
      this.TH_LOW = Number(t.low ?? 40);

      const c = interpretationConfig?.contrast || {};
      this.CONTRAST_HIGH = Number(c.high ?? 0.55);

      const b = interpretationConfig?.balance || {};
      this.BAL_HIGH = Number(b.high ?? 70);

      const p = interpretationConfig?.palette || {};
      this.SCATTER_EFF_COLORS = Number(p.scatteredEffColors ?? 5);
      this.DOM_MIN_SHARE = Number(p.dominantMinShare ?? 0.45);
    }

    /*
      generate(input)
      - Inputs:
        - scores: { symmetryBalanceScore, colorHarmonyScore, formalCohesionScore, creativeHarmonyScore }
        - shapes: list of detected shapes with area, centroid, dominantColorHSV, colorConfidence
        - paletteDist: palette distribution summary (percent per named color)
        - wSmall/hSmall: analysis canvas size (used for balance calculation)
      - Output:
        - lines: up to 4 markdown-ready sentences
        - tags: limited set for UI filters ("Unity", "Tension", "Rhythm", "Balance")
        - meta: the computed signals (debug/telemetry)
    */
    generate(input) {
      const scores = input?.scores || {};
      const shapes = input?.shapes || [];
      const paletteDist = input?.paletteDist || { totalArea: 0, colors: [] };
      const wSmall = Number(input?.wSmall || 0);
      const hSmall = Number(input?.hSmall || 0);

      const SB = Number(scores.symmetryBalanceScore ?? 0);
      const CH = Number(scores.colorHarmonyScore ?? 0);
      const FC = Number(scores.formalCohesionScore ?? 0);
      const FINAL = Number(scores.creativeHarmonyScore ?? 0);

      const bal = this._balanceScore(shapes, wSmall, hSmall);
      const contrast = this._hueContrast01(shapes);
      const effColors = this._effectiveColors(paletteDist);
      const dominantShare = this._dominantShare(paletteDist);

      // "Scattered" means several colors contribute and no single color dominates.
      const scattered = effColors >= this.SCATTER_EFF_COLORS && dominantShare < this.DOM_MIN_SHARE;

      const structuredUnity = (SB >= this.TH_HIGH && FC >= this.TH_HIGH);
      const controlledAsym = (SB <= this.TH_LOW && FC >= this.TH_HIGH);
      const intentionalTension = (contrast >= this.CONTRAST_HIGH && bal >= this.BAL_HIGH);
      const exploratoryVariation = (FC <= this.TH_LOW && scattered);

      const lines = [];
      const tags = new Set();

      if (structuredUnity) {
        lines.push("This composition reads as **structured unity**: the arrangement holds together with clear balance and alignment.");
        tags.add("Unity");
        tags.add("Balance");
      } else if (controlledAsym) {
        lines.push("This composition reads as **controlled asymmetry**: it avoids strict mirroring but still feels deliberately organized.");
        tags.add("Unity");
        tags.add("Rhythm");
      } else if (exploratoryVariation) {
        lines.push("This composition reads as **exploratory variation**: many elements pull in different directions, keeping the image open and unsettled.");
        tags.add("Rhythm");
      } else {
        lines.push("This composition reads as a **mix of unity and variety**: parts align, while other parts introduce contrast and movement.");
        tags.add("Rhythm");
      }

      if (intentionalTension) {
        lines.push("Color relationships suggest **intentional tension**: strong contrast is present, but the overall weight stays reasonably centered.");
        tags.add("Tension");
        tags.add("Balance");
      } else if (CH >= this.TH_HIGH && contrast < this.CONTRAST_HIGH) {
        lines.push("Color relationships feel **harmonized**: hues cluster into a readable family rather than competing evenly.");
        tags.add("Unity");
      } else if (CH <= this.TH_LOW && scattered) {
        lines.push("Color relationships feel **wide-ranging**: the palette is distributed across several groups without a single dominant pull.");
        tags.add("Tension");
      } else {
        lines.push("Color relationships sit **between harmony and contrast**, allowing both agreement and difference to remain visible.");
      }

      // Summary line helps explain "why" the text was chosen (useful for debugging and client clarity).
      lines.push(
        `Signals used: Symmetry/Balance ${SB}%, Cohesion ${FC}%, Color ${CH}% (contrast ${Math.round(contrast * 100)}%, balance ${Math.round(bal)}%).`
      );

      const outLines = lines.slice(0, 4);

      const allowed = new Set(["Unity", "Tension", "Rhythm", "Balance"]);
      const outTags = Array.from(tags).filter((t) => allowed.has(t));

      return { lines: outLines, tags: outTags, meta: { balance: bal, contrast, effColors, dominantShare } };
    }

    /*
      _balanceScore(shapes, wSmall, hSmall)
      - Measures how centered the visual "weight" is.
      - Weight = area * (0.7 + 0.3 * colorConfidence) so uncertain colors contribute slightly less.
      - Returns 0..100 where 100 means center-of-mass is near the image center.
    */
    _balanceScore(shapes, wSmall, hSmall) {
      if (!shapes || shapes.length === 0 || !wSmall || !hSmall) return 50;

      let sumW = 0, sumX = 0, sumY = 0;

      for (const s of shapes) {
        const area = Math.max(0, Number(s.area || 0));
        if (!area) continue;

        const cx = Number(s.centroid?.x ?? 0);
        const cy = Number(s.centroid?.y ?? 0);

        const conf = this._clamp01(Number(s.colorConfidence ?? 1));
        const w = area * (0.7 + 0.3 * conf);

        sumW += w;
        sumX += w * cx;
        sumY += w * cy;
      }

      if (sumW <= 0) return 50;

      const comX = sumX / sumW;
      const comY = sumY / sumW;

      const centerX = wSmall / 2;
      const centerY = hSmall / 2;

      const dx = comX - centerX;
      const dy = comY - centerY;

      const dist = Math.sqrt(dx * dx + dy * dy);
      const diag = Math.sqrt(wSmall * wSmall + hSmall * hSmall);

      const norm = diag > 0 ? dist / (diag / 2) : 0.5;
      return 100 * this._clamp01(1 - norm);
    }

    /*
      _hueContrast01(shapes)
      - Computes how spread out the hues are, using circular statistics.
      - R is the length of the mean hue vector (0..1):
        - R ~ 1 means hues cluster (low contrast)
        - R ~ 0 means hues are spread (high contrast)
      - Returns 1 - R, clamped to 0..1.
    */
    _hueContrast01(shapes) {
      if (!shapes || shapes.length === 0) return 0;

      let sumSin = 0, sumCos = 0, sumW = 0;

      for (const s of shapes) {
        const hsv = s.dominantColorHSV;
        if (!hsv || typeof hsv.h !== "number") continue;

        const area = Math.max(0, Number(s.area || 0));
        if (!area) continue;

        const conf = this._clamp01(Number(s.colorConfidence ?? 1));
        const w = area * (0.4 + 0.6 * conf);

        const rad = (((hsv.h % 360) + 360) % 360) * Math.PI / 180;
        sumSin += Math.sin(rad) * w;
        sumCos += Math.cos(rad) * w;
        sumW += w;
      }

      if (sumW <= 0) return 0;

      const R = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / sumW;
      return this._clamp01(1 - R);
    }

    /*
      _effectiveColors(paletteDist)
      - Estimates "how many colors are meaningfully present" using a concentration measure.
      - If one color dominates, effective colors will be closer to 1.
      - If colors are evenly spread, effective colors increases.
    */
    _effectiveColors(paletteDist) {
      const list = paletteDist?.colors || [];
      if (!list.length) return 1;

      let sumP = 0;
      let sumP2 = 0;

      for (const c of list) {
        if (String(c.name).toLowerCase() === "unknown") continue;
        const p = Math.max(0, Number(c.percent || 0)) / 100;
        sumP += p;
        sumP2 += p * p;
      }

      if (sumP <= 0) return 1;

      const normP2 = sumP2 / (sumP * sumP);
      return normP2 > 0 ? 1 / normP2 : 1;
    }

    /*
      _dominantShare(paletteDist)
      - Returns the share (0..1) of the most dominant named color.
      - If "unknown" is first, it is skipped in favor of the next real color.
    */
    _dominantShare(paletteDist) {
      const list = paletteDist?.colors || [];
      if (!list.length) return 0;

      if (String(list[0].name).toLowerCase() === "unknown" && list.length > 1) {
        return this._clamp01(Number(list[1].percent || 0) / 100);
      }

      return this._clamp01(Number(list[0].percent || 0) / 100);
    }

    // Clamp to [0..1] to keep derived signals stable and predictable.
    _clamp01(x) {
      return Math.max(0, Math.min(1, x));
    }
  }

  window.App = window.App || {};
  window.App.InterpretiveTextGenerator = InterpretiveTextGenerator;
})();
