(function () {
  "use strict";

  class HarmonyScorer {
    /*
      HarmonyScorer (MOST IMPORTANT MODULE)
      - Purpose: Compute the overall “Creative Harmony” score (0..100) for the detected composition.
      - Inputs to compute():
        - shapes[]: detected shapes with geometry + dominantColorHSV + colorConfidence
        - paletteDist: summary of color areas (from StabilityTracker snapshot palette)
        - binarySnapshot: binary image (white=shape, black=background) used for mirror symmetry
        - wSmall/hSmall: analysis space dimensions (same space used for shapes / labelMap)
      - Outputs:
        - symmetryBalanceScore: structure score combining mirror symmetry + center-of-mass balance
        - colorHarmonyScore: how “organized” or “intentional” the color relationships look
        - formalCohesionScore: how cohesive the layout is (spacing + repetition + variety)
        - creativeHarmonyScore: weighted final score from the three components

      HOW THE FINAL SCORE IS BUILT (TOP LEVEL LOGIC)
      1) Compute three component scores (0..100):
         A) symmetryBalanceScore
         B) colorHarmonyScore
         C) formalCohesionScore
      2) Combine them using configurable weights:
         finalRaw = wSym * symmetryBalanceScore + wColor * colorHarmonyScore + wCoh * formalCohesionScore
         creativeHarmonyScore = clamp(finalRaw, 0, 100)

      NOTE FOR CLIENT RESEARCH
      - “Harmony” here is a designed metric, not a universal standard.
      - The score is based on measurable signals (pixel symmetry, center-of-mass balance,
        hue distribution, spacing, size/orientation consistency, and color repetition).
      - If you want a different definition of harmony, adjust these signals and weights.
    */
    constructor(harmonyConfig, paletteConfig) {
      this.cfg = harmonyConfig || {};
      this.paletteCfg = paletteConfig || {};

      const w = this.cfg.weights || {};
      this.wSym = this._clamp01(Number(w.symmetryBalance ?? 0.4));
      this.wColor = this._clamp01(Number(w.colorHarmony ?? 0.35));
      this.wCoh = this._clamp01(Number(w.formalCohesion ?? 0.25));

      // Normalize weights so they always sum to 1 (stable behavior when tuning config).
      const sum = this.wSym + this.wColor + this.wCoh;
      if (sum > 0) {
        this.wSym /= sum;
        this.wColor /= sum;
        this.wCoh /= sum;
      }

      const sCfg = this.cfg.symmetry || {};
      this.useTB = !!sCfg.useTopBottom;
      this.symW = this._clamp01(Number(sCfg.symmetryWeight ?? 0.6));
      this.balW = this._clamp01(Number(sCfg.balanceWeight ?? 0.4));

      // These thresholds classify the “symmetry style” label (Symmetrical / Mixed / Random).
      this.symStrong = this._clamp(Number(sCfg.strongThreshold ?? 82), 0, 100);
      this.symRandom = this._clamp(Number(sCfg.randomThreshold ?? 62), 0, 100);
      if (this.symRandom > this.symStrong) {
        const t = this.symRandom;
        this.symRandom = this.symStrong;
        this.symStrong = t;
      }

      const c = this.cfg.color || {};
      // analogousWindowDeg: hue window around dominant hue treated as “analogous group”.
      this.analogWinDeg = Math.max(10, Number(c.analogousWindowDeg ?? 30));
      // unknownPenalty: reduces score if many pixels/shapes had unknown color.
      this.unknownPenalty = this._clamp01(Number(c.unknownPenalty ?? 0.15));

      const coh = this.cfg.cohesion || {};
      // proxTarget: desired average nearest-neighbor distance (normalized); smaller => tighter clustering.
      this.proxTarget = Math.max(0.05, Number(coh.proximityTargetNorm ?? 0.25));
      // areaCVMax: how much size variation is tolerated before “size consistency” drops.
      this.areaCVMax = Math.max(0.2, Number(coh.areaCVMax ?? 1.0));
    }

    /*
      compute(input)
      - Main scoring entry point.
      - It computes three sub-scores, then combines them into Creative Harmony.
      - Important detail: symmetryBalanceScore is itself a blend:
          symmetryBalanceScore = symW * symmetryOnlyScore + balW * balanceOnlyScore
        This is where “two shapes” or “many shapes” still contribute consistently:
          - symmetryOnlyScore uses the binary image pixels (not shape count)
          - balanceOnlyScore uses shape centroids + areas (all shapes contribute as mass)
    */
    compute(input) {
      const shapes = input?.shapes || [];
      const paletteDist = input?.paletteDist || { totalArea: 0, colors: [] };
      const binarySnapshot = input?.binarySnapshot || null;
      const wSmall = Number(input?.wSmall || 0);
      const hSmall = Number(input?.hSmall || 0);

      // (1) Structure score is split into:
      // - mirror symmetry from the binary image
      // - balance from center-of-mass of shapes
      const symmetryOnlyScore = this._computeMirrorSymmetry(binarySnapshot, wSmall, hSmall);
      const balanceOnlyScore = this._computeBalance(shapes, wSmall, hSmall);
      const symmetryBalanceScore =
        100 * this._clamp01(
          this.symW * (symmetryOnlyScore / 100) + this.balW * (balanceOnlyScore / 100)
        );

      // (2) Color harmony: how the hue distribution behaves (clustered, complementary pairs, dominance).
      const colorHarmonyScore = this._computeColorHarmony(shapes, paletteDist);

      // (3) Formal cohesion: how the shapes relate in spacing, repetition, and controlled variety.
      const formalCohesionScore = this._computeFormalCohesion(shapes, paletteDist, wSmall, hSmall);

      // (4) Final weighted harmony score.
      const finalRaw =
        this.wSym * symmetryBalanceScore +
        this.wColor * colorHarmonyScore +
        this.wCoh * formalCohesionScore;

      const creativeHarmonyScore = this._clamp(finalRaw, 0, 100);

      // Classification label is based mainly on mirror symmetry (pixel-based),
      // then scaled by symmetryBalanceScore for confidence.
      const symClass = this._classifySymmetry(symmetryOnlyScore, symmetryBalanceScore);

      const explanation = this._makeExplanation({
        symmetryBalanceScore,
        colorHarmonyScore,
        formalCohesionScore,
        creativeHarmonyScore,
        paletteDist,
        shapesCount: shapes.length,
        symmetryOnlyScore,
        balanceOnlyScore,
        symmetryLabel: symClass.label,
        symmetryConfidence: symClass.confidence
      });

      return {
        symmetryBalanceScore: Math.round(symmetryBalanceScore),
        colorHarmonyScore: Math.round(colorHarmonyScore),
        formalCohesionScore: Math.round(formalCohesionScore),
        creativeHarmonyScore: Math.round(creativeHarmonyScore),
        symmetryOnlyScore: Math.round(symmetryOnlyScore),
        balanceOnlyScore: Math.round(balanceOnlyScore),
        symmetryLabel: symClass.label,
        symmetryConfidence: Math.round(symClass.confidence * 100),
        weights: { symmetryBalance: this.wSym, colorHarmony: this.wColor, formalCohesion: this.wCoh },
        explanation
      };
    }

    /*
      _classifySymmetry(symmetryOnlyScore, symmetryBalanceScore)
      - Label rules:
        - Symmetrical: symmetryOnlyScore >= symStrong
        - Random:      symmetryOnlyScore <= symRandom
        - Mixed:       between those thresholds
      - Confidence:
        - Based on how far the score is from the decision boundary (d)
        - Multiplied by a small factor of the combined structure score (sb)
    */
    _classifySymmetry(symmetryOnlyScore, symmetryBalanceScore) {
      const s = this._clamp(symmetryOnlyScore, 0, 100);
      const sb = this._clamp(symmetryBalanceScore, 0, 100);

      let label;
      if (s >= this.symStrong) label = "Symmetrical";
      else if (s <= this.symRandom) label = "Random";
      else label = "Mixed";

      let d;
      if (label === "Symmetrical") d = (s - this.symStrong) / Math.max(1, 100 - this.symStrong);
      else if (label === "Random") d = (this.symRandom - s) / Math.max(1, this.symRandom);
      else d =
        1 -
        Math.abs(s - (this.symRandom + this.symStrong) * 0.5) /
          Math.max(1, (this.symStrong - this.symRandom) * 0.5);

      const conf = this._clamp01(0.25 + 0.75 * this._clamp01(d)) * (0.75 + 0.25 * (sb / 100));

      return { label, confidence: this._clamp01(conf) };
    }

    /*
      _computeMirrorSymmetry(binarySnapshot, wSmall, hSmall)
      - What it measures:
        - Pixel-level mirror agreement of the binary image (shape vs background).
      - Left-Right symmetry:
        - For each (x,y), compare binary(x,y) with binary(mirrorX,y)
        - mismatch ratio => symmetry = 1 - mismatch/total
      - Optional Top-Bottom symmetry:
        - Same idea with y mirrored to (x, mirrorY)
      - Output:
        - Score in 0..100 where 100 is perfectly mirrored.

      HOW “TWO SHAPES” AFFECT SYMMETRY:
      - Symmetry is computed from pixels, not from shape count.
      - If two shapes are placed as left-right mirrors, many pixel pairs match => high score.
      - If two shapes are on one side only, many pixel pairs mismatch => low score.
    */
    _computeMirrorSymmetry(binarySnapshot, wSmall, hSmall) {
      if (!binarySnapshot || !wSmall || !hSmall) return 50;

      binarySnapshot.loadPixels();
      const px = binarySnapshot.pixels;

      const ww = binarySnapshot.width;
      const hh = binarySnapshot.height;

      let totalLR = 0;
      let mismatchLR = 0;

      for (let y = 0; y < hh; y++) {
        for (let x = 0; x < (ww / 2) | 0; x++) {
          const xr = ww - 1 - x;

          const p1 = (y * ww + x) * 4;
          const p2 = (y * ww + xr) * 4;

          const v1 = px[p1];
          const v2 = px[p2];

          const b1 = v1 > 128 ? 1 : 0;
          const b2 = v2 > 128 ? 1 : 0;

          totalLR++;
          if (b1 !== b2) mismatchLR++;
        }
      }

      const lr = totalLR > 0 ? 1 - mismatchLR / totalLR : 0.5;

      if (!this.useTB) return 100 * lr;

      let totalTB = 0;
      let mismatchTB = 0;

      for (let y = 0; y < (hh / 2) | 0; y++) {
        const yb = hh - 1 - y;
        for (let x = 0; x < ww; x++) {
          const p1 = (y * ww + x) * 4;
          const p2 = (yb * ww + x) * 4;

          const v1 = px[p1];
          const v2 = px[p2];

          const b1 = v1 > 128 ? 1 : 0;
          const b2 = v2 > 128 ? 1 : 0;

          totalTB++;
          if (b1 !== b2) mismatchTB++;
        }
      }

      const tb = totalTB > 0 ? 1 - mismatchTB / totalTB : 0.5;

      return 100 * ((lr + tb) / 2);
    }

    /*
      _computeBalance(shapes, wSmall, hSmall)
      - What it measures:
        - How close the weighted center-of-mass (COM) of all shapes is to the image center.
      - Weight per shape:
        - w = area * (0.7 + 0.3 * colorConfidence)
        - area makes large shapes “heavier”
        - colorConfidence slightly increases weight for shapes with reliable color
      - Steps:
        1) COM = Σ(w*cx)/Σ(w), Σ(w*cy)/Σ(w)
        2) Compute distance from COM to image center
        3) Normalize by half-diagonal so it fits 0..1
        4) Score = 100 * (1 - normalizedDistance)

      HOW “TWO SHAPES” AFFECT BALANCE:
      - If two equal shapes are opposite each other around the center, COM stays near center => high score.
      - If both shapes are on the same side, COM shifts => lower score.
    */
    _computeBalance(shapes, wSmall, hSmall) {
      if (!shapes || shapes.length === 0 || !wSmall || !hSmall) return 50;

      let sumW = 0;
      let sumX = 0;
      let sumY = 0;

      for (const s of shapes) {
        const area = Math.max(0, Number(s.area || 0));
        if (!area) continue;

        const cx = Number(s.centroid?.x ?? 0);
        const cy = Number(s.centroid?.y ?? 0);

        const cw = this._clamp01(Number(s.colorConfidence ?? 1));
        const w = area * (0.7 + 0.3 * cw);

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
      const score = 100 * this._clamp01(1 - norm);

      return score;
    }

    /*
      _computeColorHarmony(shapes, paletteDist)
      - What it measures:
        - If the hue distribution looks organized (few clusters, clear dominance, meaningful pairs)
          versus scattered (many unrelated hues).
      - Key ideas used:
        1) Hue weighting:
           - Each shape contributes hue weight: w = area * (0.4 + 0.6 * colorConfidence)
        2) 12-bin histogram:
           - Hue is bucketed into 12 bins of 30 degrees each.
        3) Entropy (randomness):
           - entropyNorm is high when hues are spread evenly across bins (random / scattered)
           - cohesion = 1 - entropyNorm (clustered hues => higher cohesion)
        4) Analogous group:
           - Find dominant hue (weighted circular mean).
           - analogous = share of hue weight within analogWinDeg of dominant hue.
        5) Complementary pair:
           - Find the best two-bin pair close to 180° apart.
           - Score increases if:
             - their hue distance is close to 180°
             - their weights are balanced
             - together they cover a meaningful fraction of the image
        6) Dominance:
           - dominance = weight of the strongest bin / total weight
           - two-color case: if two bins dominate strongly, dominance is high.

      HOW “TWO COLORS” AFFECT COLOR HARMONY:
      - If two colors are close in hue (analogous):
          - analogous becomes high (many weights inside analog window)
          - entropy becomes lower (distribution concentrated) => cohesion high
      - If two colors are opposite (complementary):
          - complementary pair score becomes high (near 180°, balanced weights)
      - If two colors are unrelated and spread out:
          - entropy increases (more “randomness”) and analogous/complementary may be weak

      IMPORTANT: Unknown colors
      - unknownFrac = unknownArea / totalArea
      - Score is multiplied by (1 - unknownPenalty * unknownFrac)
        so unreliable color detection reduces the final color harmony.
    */
    _computeColorHarmony(shapes, paletteDist) {
      if (!shapes || shapes.length === 0) return 0;

      let totalArea = 0;
      let unknownArea = 0;

      const hueList = [];
      const binCount = 12;
      const bins = new Float32Array(binCount);

      for (const s of shapes) {
        const a = Math.max(0, Number(s.area || 0));
        if (!a) continue;

        const hsv = s.dominantColorHSV;

        totalArea += a;

        if (!hsv || typeof hsv.h !== "number") {
          unknownArea += a;
          continue;
        }

        const conf = this._clamp01(Number(s.colorConfidence ?? 1));
        const w = a * (0.4 + 0.6 * conf);

        hueList.push({ h: (hsv.h + 360) % 360, w });

        const bi = Math.floor(((hsv.h + 360) % 360) / 30) % binCount;
        bins[bi] += w;
      }

      if (totalArea <= 0) return 0;

      const unknownFrac = unknownArea / totalArea;

      // If we have no valid hue values, fallback to “dominance from paletteDist”.
      if (hueList.length === 0) {
        const dom = this._dominanceFromPalette(paletteDist);
        const base = 100 * dom;
        return this._clamp(base * (1 - this.unknownPenalty * unknownFrac), 0, 100);
      }

      const entropyNorm = this._entropyNorm(bins);
      const cohesion = this._clamp01(1 - entropyNorm);

      const domHue = this._weightedHueMean(hueList);

      let analogArea = 0;
      let totalW = 0;

      for (const it of hueList) {
        totalW += it.w;
        const d = this._hueDiff(domHue, it.h);
        if (d <= this.analogWinDeg) analogArea += it.w;
      }

      const analogous = totalW > 0 ? this._clamp01(analogArea / totalW) : 0;
      const complementary = this._bestComplementaryPairScore(bins);

      const topBin = this._maxValue(bins);
      const dominance = totalW > 0 ? this._clamp01(topBin / totalW) : 0;

      // pattern prefers either:
      // - a strong analogous cluster (amplified if one bin dominates),
      // - or a strong complementary pair.
      const pattern = Math.max(analogous * (0.65 + 0.35 * dominance), complementary);
      const score01 = this._clamp01(0.55 * pattern + 0.30 * cohesion + 0.15 * dominance);
      const score = 100 * score01;

      return this._clamp(score * (1 - this.unknownPenalty * unknownFrac), 0, 100);
    }

    _dominanceFromPalette(paletteDist) {
      const list = paletteDist?.colors || [];
      if (!list.length) return 0;
      const top = list[0].percent / 100;
      return this._clamp01(top);
    }

    /*
      _entropyNorm(bins)
      - Entropy is used as a “randomness” indicator for color distribution.
      - If weights spread across many bins => entropy high => cohesion low.
      - If weights concentrated in a few bins => entropy low => cohesion high.
      - Returns 0..1 (normalized by max entropy for N bins).
    */
    _entropyNorm(bins) {
      let sum = 0;
      for (let i = 0; i < bins.length; i++) sum += bins[i];
      if (sum <= 0) return 1;

      let H = 0;

      for (let i = 0; i < bins.length; i++) {
        const p = bins[i] / sum;
        if (p > 1e-9) H -= p * Math.log(p);
      }

      const maxH = Math.log(bins.length);
      return maxH > 0 ? this._clamp01(H / maxH) : 1;
    }

    /*
      _bestComplementaryPairScore(bins)
      - Searches all bin pairs and scores them as a potential complementary scheme.
      - A good complementary pair means:
        - hue distance close to 180 degrees (closeness)
        - weights are similar (balance)
        - together cover a decent part of the composition (pairCover)
      - Returns 0..1.
    */
    _bestComplementaryPairScore(bins) {
      let total = 0;
      for (let i = 0; i < bins.length; i++) total += bins[i];
      if (total <= 0) return 0;

      let best = 0;
      const n = bins.length;

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const wi = bins[i];
          const wj = bins[j];
          if (wi <= 0 || wj <= 0) continue;

          const hi = (i * 30 + 15) % 360;
          const hj = (j * 30 + 15) % 360;

          const dist = this._hueDiff(hi, hj);
          const closeness = 1 - Math.abs(dist - 180) / 180;

          const pairCover = (wi + wj) / total;
          const balance = 1 - Math.abs(wi - wj) / (wi + wj);

          const score =
            this._clamp01(closeness) *
            this._clamp01(balance) *
            this._clamp01(pairCover);

          if (score > best) best = score;
        }
      }

      return this._clamp01(0.85 * best + 0.15);
    }

    _maxValue(arr) {
      let m = 0;
      for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
      return m;
    }

    /*
      _weightedHueMean(list)
      - Computes dominant hue via circular mean:
        hueMean = atan2(Σ sin(h)*w, Σ cos(h)*w)
      - This avoids errors around hue wrap-around (e.g., 359° and 1° are close).
    */
    _weightedHueMean(list) {
      let sumSin = 0;
      let sumCos = 0;
      let sumW = 0;

      for (const it of list) {
        const rad = (it.h * Math.PI) / 180;
        sumSin += Math.sin(rad) * it.w;
        sumCos += Math.cos(rad) * it.w;
        sumW += it.w;
      }

      if (sumW <= 0) return 0;

      const ang = Math.atan2(sumSin, sumCos) * (180 / Math.PI);
      return (ang + 360) % 360;
    }

    /*
      _computeFormalCohesion(shapes, paletteDist, wSmall, hSmall)
      - What it measures:
        - Whether the arrangement feels “cohesive” as a system of forms.
      - Signals:
        1) proximity:
           - mean nearest-neighbor distance (normalized by diagonal)
           - score goes up when shapes are closer than proxTarget
        2) similarity:
           - sizeConsistency from CV(area)  (low CV => consistent sizing)
           - orientConsistency from circular consistency of orientations
           - repetition from topColorShare (strong repeated color adds cohesion)
        3) variety:
           - varietySize peaks at a “middle” amount of size variation
           - varietyColor peaks around a few effective colors (not 1, not too many)

      HOW “TWO SHAPES” AFFECT COHESION:
      - With only two shapes, nearest-neighbor distance equals their separation.
      - If they are extremely far apart => low proximity score.
      - If they are reasonably close => higher proximity.
      - Size/orientation consistency can be very high if the two shapes match.
    */
    _computeFormalCohesion(shapes, paletteDist, wSmall, hSmall) {
      if (!shapes || shapes.length < 2 || !wSmall || !hSmall) return 40;

      const nn = this._meanNearestNeighborNorm(shapes, wSmall, hSmall);
      const proximity = this._clamp01(1 - (nn / this.proxTarget));

      const cvArea = this._cvOfArea(shapes);
      const sizeConsistency = this._clamp01(1 - (cvArea / this.areaCVMax));

      const orientConsistency = this._orientationConsistency(shapes);

      const topColorShare = this._topColorShare(paletteDist);
      const repetition = this._clamp01(topColorShare);

      const similarity = this._clamp01(0.45 * sizeConsistency + 0.25 * orientConsistency + 0.30 * repetition);

      const varietySize = this._varietyPeakScore(cvArea, 0.60, 0.60);
      const effColors = this._effectiveColors(paletteDist);
      const varietyColor = this._varietyPeakScore(effColors, 3.5, 3.0);
      const variety = this._clamp01(0.5 * varietySize + 0.5 * varietyColor);

      const score01 = this._clamp01(0.45 * proximity + 0.35 * similarity + 0.20 * variety);
      return 100 * score01;
    }

    /*
      _meanNearestNeighborNorm(shapes, wSmall, hSmall)
      - For each shape centroid, find the closest other centroid distance.
      - Average those distances and normalize by the image diagonal.
      - Returns 0..1 where smaller means tighter grouping.
    */
    _meanNearestNeighborNorm(shapes, wSmall, hSmall) {
      const pts = shapes.map((s) => ({
        x: Number(s.centroid?.x ?? 0),
        y: Number(s.centroid?.y ?? 0),
      }));

      const diag = Math.sqrt(wSmall * wSmall + hSmall * hSmall);
      if (diag <= 0) return 1;

      let sum = 0;

      for (let i = 0; i < pts.length; i++) {
        let best = Infinity;
        const a = pts[i];

        for (let j = 0; j < pts.length; j++) {
          if (i === j) continue;
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < best) best = d;
        }

        if (!isFinite(best)) best = diag;
        sum += best;
      }

      const mean = sum / pts.length;
      return mean / diag;
    }

    /*
      _cvOfArea(shapes)
      - CV (coefficient of variation) = std(area) / mean(area)
      - 0 means same size; higher means more size variety.
    */
    _cvOfArea(shapes) {
      let n = 0;
      let sum = 0;

      for (const s of shapes) {
        const a = Math.max(0, Number(s.area || 0));
        if (!a) continue;
        sum += a;
        n++;
      }

      if (n <= 1) return 0;

      const mean = sum / n;
      let varSum = 0;

      for (const s of shapes) {
        const a = Math.max(0, Number(s.area || 0));
        if (!a) continue;
        const d = a - mean;
        varSum += d * d;
      }

      const std = Math.sqrt(varSum / (n - 1));
      return mean > 0 ? std / mean : 0;
    }

    /*
      _orientationConsistency(shapes)
      - Uses circular consistency of orientations (in degrees):
        R = sqrt((Σ sin(theta)*w)^2 + (Σ cos(theta)*w)^2) / Σ w
      - Returns 0..1 where 1 means all shapes share the same orientation.
    */
    _orientationConsistency(shapes) {
      let sumSin = 0;
      let sumCos = 0;
      let sumW = 0;

      for (const s of shapes) {
        const a = Math.max(0, Number(s.area || 0));
        if (!a) continue;

        const deg = Number(s.orientation || 0);
        const rad = (deg * Math.PI) / 180;

        sumSin += Math.sin(rad) * a;
        sumCos += Math.cos(rad) * a;
        sumW += a;
      }

      if (sumW <= 0) return 0.5;

      const R = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / sumW;
      return this._clamp01(R);
    }

    _topColorShare(paletteDist) {
      const list = paletteDist?.colors || [];
      if (!list.length) return 0;

      if (String(list[0].name).toLowerCase() === "unknown" && list.length > 1) {
        return this._clamp01(list[1].percent / 100);
      }

      return this._clamp01(list[0].percent / 100);
    }

    /*
      _effectiveColors(paletteDist)
      - Computes “effective number of colors” (diversity):
        eff = 1 / Σ(p_i^2)  (Simpson / inverse Herfindahl style)
      - Examples:
        - One dominant color: p≈1 => eff≈1
        - Two equal colors: p=0.5/0.5 => eff=1/(0.25+0.25)=2
        - Many equal colors => eff grows
      - This is how “two colors appear” gets quantified as a single number.
    */
    _effectiveColors(paletteDist) {
      const list = paletteDist?.colors || [];
      if (!list.length) return 1;

      let sumP2 = 0;
      let sumP = 0;

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

    // Peak-shaped scoring: best when x is near "peak", decreases as it moves away.
    _varietyPeakScore(x, peak, range) {
      const d = Math.abs(x - peak);
      return this._clamp01(1 - d / range);
    }

    /*
      _makeExplanation(r)
      - Builds a short human-readable text for UI.
      - Keeps the explanation compact while reflecting the computed scores.
    */
    _makeExplanation(r) {
      const sb = r.symmetryBalanceScore;
      const ch = r.colorHarmonyScore;
      const fc = r.formalCohesionScore;
      const fin = r.creativeHarmonyScore;

      const paletteTop = (r.paletteDist?.colors || []).slice(0, 3).map((c) => `${c.name} ${Math.round(c.percent)}%`);
      const paletteLine = paletteTop.length ? `Palette trend: ${paletteTop.join(", ")}.` : `Palette trend: not enough color data.`;

      const tone = (score) => {
        if (score >= 80) return "strong";
        if (score >= 60) return "good";
        if (score >= 40) return "mixed";
        return "tense";
      };

      const sbText = `Structure is ${tone(sb)} (symmetry/balance: ${Math.round(sb)}).`;
      const chText = `Color relationship is ${tone(ch)} (color harmony: ${Math.round(ch)}).`;
      const fcText = `Arrangement feels ${tone(fc)} (formal cohesion: ${Math.round(fc)}).`;

      const symLine = `Symmetry: ${r.symmetryLabel} (${Math.round(r.symmetryOnlyScore)}) · Confidence ${Math.round(r.symmetryConfidence * 100)}%.`;

      let overall;
      if (fin >= 80) overall = "Creative Harmony is high — unified with readable structure and color flow.";
      else if (fin >= 60) overall = "Creative Harmony is solid — mostly unified with some intentional contrast.";
      else if (fin >= 40) overall = "Creative Harmony is moderate — a mix of unity and visual tension.";
      else overall = "Creative Harmony is low — composition reads as highly varied or unsettled (which can be intentional).";

      return `${overall} ${symLine} ${sbText} ${chText} ${fcText} ${paletteLine}`;
    }

    _hueDiff(h1, h2) {
      const d = Math.abs(h1 - h2);
      return Math.min(d, 360 - d);
    }

    _clamp(n, a, b) {
      return Math.max(a, Math.min(b, n));
    }

    _clamp01(x) {
      return this._clamp(x, 0, 1);
    }
  }

  window.App = window.App || {};
  window.App.HarmonyScorer = HarmonyScorer;
})();
