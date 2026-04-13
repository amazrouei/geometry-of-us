(function () {
  "use strict";

  class ColorAnalyzer {
    /*
      ColorAnalyzer
      - Purpose: Assign a dominant color (name + RGB + HSV + confidence) to each detected shape.
      - Approach:
        - For each shape, sample pixels inside its labeled region (optionally only interior pixels)
        - Convert sampled pixels to HSV and compute a robust mean hue (circular mean)
        - Decide the final color name using either:
          a) hue bins (fast and stable), or
          b) nearest palette color in HSV space
        - Compute a confidence score using hue fit, hue consistency, and number of samples
      - Key tuning vars:
        - maxSamples: sampling cap per shape (keeps runtime stable)
        - innerMargin: requires a pixel to have same label in a margin neighborhood (avoids boundary bleed)
        - minSatSample / maxValSample: filters to ignore low-saturation pixels or overly bright pixels
        - graySatThresh / blackValThresh / whiteValThresh: neutral handling (gray/black/white)
        - useHueBins: if true, color name is chosen by hue ranges; otherwise by palette distance
    */
    constructor(paletteConfig, options = {}) {
      const {
        maxSamples = 600,
        graySatThresh = 0.12,
        blackValThresh = 0.12,
        whiteValThresh = 0.92,

        useHueBins = true,
        innerMargin = 2,
        minSatSample = 0.06,
        maxValSample = 1.0,

        hueBins = [
          { name: "Red", min: 335, max: 9 },
          { name: "Orange", min: 10, max: 32 },
          { name: "Yellow", min: 32, max: 75 },
          { name: "Green", min: 75, max: 165 },
          { name: "Cyan", min: 165, max: 195 },
          { name: "Blue", min: 195, max: 255 },
          { name: "Purple", min: 255, max: 300 },
          { name: "Pink", min: 300, max: 335 },
        ],
      } = options;

      this.maxSamples = Math.max(50, Math.floor(maxSamples));
      this.graySatThresh = graySatThresh;
      this.blackValThresh = blackValThresh;
      this.whiteValThresh = whiteValThresh;

      this.useHueBins = !!useHueBins;
      this.innerMargin = Math.max(0, Math.floor(innerMargin));
      this.minSatSample = minSatSample;
      this.maxValSample = maxValSample;
      this.hueBins = hueBins;

      this.palette = [];
      this._palByName = {};
      this._setPalette(paletteConfig);
    }

    /*
      _setPalette(paletteConfig)
      - Converts the palette config into internal {name, rgb, hsv} entries.
      - Also keeps quick lookups for common neutral colors (white/black/gray).
    */
    _setPalette(paletteConfig) {
      const colors = paletteConfig?.colors;
      if (!Array.isArray(colors) || colors.length === 0) {
        throw new Error("paletteConfig.colors is missing or empty");
      }

      this.palette = colors.map((c) => {
        const rgb = c.rgb;
        if (!rgb || rgb.length !== 3) throw new Error("Each palette color needs rgb:[r,g,b]");
        const hsv = this._rgbToHsv(rgb[0], rgb[1], rgb[2]);
        return {
          name: c.name,
          rgb: [rgb[0], rgb[1], rgb[2]],
          hsv,
        };
      });

      this._palByName = {};
      for (const p of this.palette) this._palByName[p.name.toLowerCase()] = p;

      this._palWhite = this.palette.find((p) => p.name.toLowerCase() === "white") || null;
      this._palBlack = this.palette.find((p) => p.name.toLowerCase() === "black") || null;
    }

    /*
      update(sourceFrame, shapes, labelMap, wSmall, hSmall)
      - For each shape, samples pixels from the original (full-res) frame and assigns:
        dominantColorName, dominantColorRGB, dominantColorHSV, colorConfidence
      - labelMap is the component id map produced by ShapeDetector (size wSmall*hSmall).
      - wSmall/hSmall define the analysis resolution; sx/sy map those coords to full-res pixels.
    */
    update(sourceFrame, shapes, labelMap, wSmall, hSmall) {
      if (!sourceFrame || !Array.isArray(shapes) || shapes.length === 0) return;
      if (!labelMap || labelMap.length !== wSmall * hSmall) return;

      const wFull = sourceFrame.width;
      const hFull = sourceFrame.height;

      const sx = wFull / wSmall;
      const sy = hFull / hSmall;

      sourceFrame.loadPixels();
      const px = sourceFrame.pixels;

      for (const s of shapes) {
        const result = this._dominantColorForShape(
          s,
          labelMap,
          wSmall,
          hSmall,
          px,
          wFull,
          hFull,
          sx,
          sy
        );
        s.dominantColorName = result.name;
        s.dominantColorRGB = result.rgb;
        s.dominantColorHSV = result.hsv;
        s.colorConfidence = result.confidence;
      }
    }

    /*
      _dominantColorForShape(...)
      - Samples inside the shape region (using labelMap) and aggregates color:
        - Hue: circular mean (sin/cos) to avoid issues near 0/360 boundary
        - Saturation/Value: arithmetic mean
        - RGB: arithmetic mean for reporting/debugging
      - Then maps the mean HSV to a named color and calculates confidence.
    */
    _dominantColorForShape(shape, labelMap, wSmall, hSmall, px, wFull, hFull, sx, sy) {
      const id = shape.id;
      const bbox = shape.bbox;

      const target = this.maxSamples;
      const area = Math.max(1, shape.area);
      const step = Math.max(1, Math.floor(Math.sqrt(area / target)));

      let n = 0;

      let sumSin = 0, sumCos = 0, sumW = 0;
      let sumS = 0, sumV = 0;
      let sumR = 0, sumG = 0, sumB = 0;

      const m = this.innerMargin;

      for (let y = bbox.y; y < bbox.y + bbox.h; y += step) {
        if (y < 0 || y >= hSmall) continue;

        for (let x = bbox.x; x < bbox.x + bbox.w; x += step) {
          if (x < 0 || x >= wSmall) continue;

          const idxSmall = y * wSmall + x;
          if (labelMap[idxSmall] !== id) continue;

          // Interior-only sampling reduces background bleeding at edges.
          if (m > 0 && !this._isInterior(x, y, id, labelMap, wSmall, hSmall, m)) continue;

          const xf = Math.min(wFull - 1, Math.max(0, Math.floor((x + 0.5) * sx)));
          const yf = Math.min(hFull - 1, Math.max(0, Math.floor((y + 0.5) * sy)));

          const p = (yf * wFull + xf) * 4;
          const r = px[p];
          const g = px[p + 1];
          const b = px[p + 2];

          const hsv = this._rgbToHsv(r, g, b);

          // Ignore weak color samples (near-gray) and overly bright samples (glare/white).
          if (hsv.s < this.minSatSample) continue;
          if (hsv.v > this.maxValSample) continue;

          // Hue weight favors higher saturation samples for a cleaner hue estimate.
          const wHue = Math.max(0.15, hsv.s);
          const rad = (hsv.h * Math.PI) / 180;

          sumSin += Math.sin(rad) * wHue;
          sumCos += Math.cos(rad) * wHue;
          sumW += wHue;

          sumS += hsv.s;
          sumV += hsv.v;

          sumR += r; sumG += g; sumB += b;

          n++;
          if (n >= target) break;
        }
        if (n >= target) break;
      }

      if (n === 0) {
        return { name: "Unknown", rgb: [0, 0, 0], hsv: { h: 0, s: 0, v: 0 }, confidence: 0 };
      }

      const meanH = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
      const h = (meanH + 360) % 360;
      const s = sumS / n;
      const v = sumV / n;

      const domHSV = { h, s, v };

      const domRGB = [
        Math.round(sumR / n),
        Math.round(sumG / n),
        Math.round(sumB / n),
      ];

      // R (0..1) measures how consistent the sampled hues are (higher means tighter cluster).
      const R = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / Math.max(1e-6, sumW);
      const consistency = this._clamp(isFinite(R) ? R : 0, 0, 1);

      // Low saturation means the color is neutral; map by value (black/gray/white).
      if (domHSV.s < this.graySatThresh) {
        const neutral = this._mapNeutral(domHSV);
        const confNeutral = this._clamp(0.55 + 0.45 * (1 - Math.abs(domHSV.v - 0.5) * 2), 0, 1);
        return { name: neutral.name, rgb: neutral.rgb, hsv: domHSV, confidence: confNeutral };
      }

      // Hue bins provide a stable mapping when the palette is grouped by hue families.
      if (this.useHueBins) {
        const { best, bin } = this._pickByHueBins(domHSV);

        let hueScore = 0.75;
        if (bin) {
          const c = this._binCenter(bin.min, bin.max);
          const half = this._binHalfWidth(bin.min, bin.max);
          const dh = this._hueDiff(domHSV.h, c);
          hueScore = this._clamp(1 - dh / half, 0, 1);
        }

        const sampleScore = this._clamp(n / 120, 0, 1);
        const confidence = this._clamp(0.50 * hueScore + 0.30 * consistency + 0.20 * sampleScore, 0, 1);

        return { name: best.name, rgb: domRGB, hsv: domHSV, confidence };
      }

      // Fallback mapping: choose the nearest palette color in HSV space.
      const { best, distNorm } = this._mapToPalette(domHSV);
      const distScore = 1 - distNorm;

      const sampleScore = this._clamp(n / 120, 0, 1);
      const confidence = this._clamp(0.55 * distScore + 0.30 * consistency + 0.15 * sampleScore, 0, 1);

      return { name: best.name, rgb: domRGB, hsv: domHSV, confidence };
    }

    /*
      _mapNeutral(hsv)
      - Handles near-gray colors using V (brightness).
      - Prefers exact palette entries for Black/White/Gray if available.
    */
    _mapNeutral(hsv) {
      if (hsv.v <= this.blackValThresh && this._palBlack) return this._palBlack;
      if (hsv.v >= this.whiteValThresh && this._palWhite) return this._palWhite;

      const pGray = this._palByName["gray"] || null;
      if (pGray) return pGray;

      return this._mapToPalette(hsv).best;
    }

    /*
      _pickByHueBins(hsv)
      - Chooses a palette color by checking which hue bin the hue falls into.
      - If no bin matches, falls back to palette-distance mapping.
    */
    _pickByHueBins(hsv) {
      const h = hsv.h;

      for (const b of this.hueBins) {
        if (this._inHueRange(h, b.min, b.max)) {
          const p = this._palByName[b.name.toLowerCase()];
          if (p) return { best: p, bin: b };
        }
      }

      return { best: this._mapToPalette(hsv).best, bin: null };
    }

    // Supports wrap-around bins like Red: [335..360) U [0..9).
    _inHueRange(h, min, max) {
      if (min <= max) return h >= min && h < max;
      return h >= min || h < max;
    }

    // Center of a hue bin, supports wrap-around bins.
    _binCenter(min, max) {
      if (min <= max) return (min + max) * 0.5;
      return ((min + (max + 360)) * 0.5) % 360;
    }

    // Half-width of a hue bin, used to score how close hue is to the bin center.
    _binHalfWidth(min, max) {
      const w = (min <= max) ? (max - min) : ((max + 360) - min);
      return Math.max(1, w * 0.5);
    }

    /*
      _isInterior(x, y, id, labelMap, w, h, m)
      - Returns true if all pixels in an m-radius square around (x,y)
        have the same label id.
      - This avoids sampling pixels that are close to the shape boundary.
    */
    _isInterior(x, y, id, labelMap, w, h, m) {
      for (let dy = -m; dy <= m; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) return false;

        for (let dx = -m; dx <= m; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) return false;
          if (labelMap[yy * w + xx] !== id) return false;
        }
      }
      return true;
    }

    /*
      _mapToPalette(hsv)
      - Finds the closest palette entry in HSV space with weighted distance.
      - Weights prioritize hue, then saturation, then value (value is kept small to reduce lighting bias).
    */
    _mapToPalette(hsv) {
      const wh = 1.15, ws = 0.65, wv = 0.05;
      const maxD = Math.sqrt(wh * wh + ws * ws + wv * wv);

      let best = this.palette[0];
      let bestD = 1e9;

      for (const p of this.palette) {
        const d = this._hsvDistance(hsv, p.hsv, wh, ws, wv);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }

      return { best, distNorm: this._clamp(bestD / maxD, 0, 1) };
    }

    _hsvDistance(a, b, wh, ws, wv) {
      const dh = this._hueDiff(a.h, b.h) / 180;
      const ds = Math.abs(a.s - b.s);
      const dv = Math.abs(a.v - b.v);
      return Math.sqrt((wh * dh) ** 2 + (ws * ds) ** 2 + (wv * dv) ** 2);
    }

    // Circular hue distance in degrees (0..180).
    _hueDiff(h1, h2) {
      const d = Math.abs(h1 - h2);
      return Math.min(d, 360 - d);
    }

    /*
      _rgbToHsv(r, g, b)
      - Converts RGB (0..255) to HSV:
        - h in degrees [0..360)
        - s and v in [0..1]
      - HSV is used because hue is more stable for naming colors than raw RGB.
    */
    _rgbToHsv(r, g, b) {
      const rf = r / 255, gf = g / 255, bf = b / 255;
      const max = Math.max(rf, gf, bf);
      const min = Math.min(rf, gf, bf);
      const d = max - min;

      let h = 0;
      if (d !== 0) {
        if (max === rf) h = ((gf - bf) / d) % 6;
        else if (max === gf) h = (bf - rf) / d + 2;
        else h = (rf - gf) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }

      const s = max === 0 ? 0 : d / max;
      const v = max;

      return { h, s, v };
    }

    _clamp(n, a, b) {
      return Math.max(a, Math.min(b, n));
    }
  }

  window.App = window.App || {};
  window.App.ColorAnalyzer = ColorAnalyzer;
})();
