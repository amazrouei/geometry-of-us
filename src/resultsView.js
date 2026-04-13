(function () {
  "use strict";

  /**
   * ResultsView  (Phase 2 — Geometrical Harmony)
   * ──────────────────────────────────────────────
   * Renders the RESULT screen into an offscreen p5.Graphics canvas (1200 × 720).
   *
   * Layout
   * ------
   * Left  54 %  — Captured Mosaic
   * Right 46 %  — 4 stacked cards:
   *   1. Detection Panel        (objective data)
   *   2. Geometrical Harmony    (score + shape distribution bars)
   *   3. Structural Diagnosis   (poetic-academic paragraph)
   *   4. Chromatic Context       (non-scored)
   *
   * Dark-theme colour scheme (matches index.html).
   */

  /* ── Palette constants ── */
const C = {
  bg:          [255, 255, 255],
  cardBg:      [248, 248, 248],
  cardBorder:  [200, 200, 200],
  cardHeader:  [230, 230, 230],

  textPrimary: [0,   0,   0],
  textMuted:   [80,  80,  80],
  textDim:     [130, 130, 130],

  accentBlue:   [0,   0,   0],
  accentGold:   [60,  60,  60],
  accentGreen:  [90,  90,  90],
  accentRed:    [40,  40,  40],
  accentPurple: [120, 120, 120],

  barBg:       [230, 230, 230],

  barTriangle: [40,  40,  40],
  barSquare:   [100, 100, 100],
  barHexagon:  [160, 160, 160],

  white:       [255, 255, 255],
};

  class ResultsView {
    constructor({ w, h, paletteCfg }) {
      this.w = w;
      this.h = h;
      this.paletteCfg = paletteCfg || {};
      this.g = createGraphics(this.w, this.h);
      this.g.pixelDensity(1);

      this.layout = {
        margin:    30,
        topY:      80,
        gap:       20,
        leftRatio: 0.54,
        bottomPad: 30,
      };
    }

    getGraphics() { return this.g; }

    getLayout() {
      const m = this.layout.margin;
      const topY = this.layout.topY;
      const leftW  = Math.floor(this.w * this.layout.leftRatio);
      const leftX  = m;
      const leftY  = topY;
      const leftH  = this.h - topY - this.layout.bottomPad;
      const rightX = leftX + leftW + this.layout.gap;
      const rightY = topY;
      const rightW = this.w - rightX - m;
      const rightH = leftH;
      return { leftX, leftY, leftW, leftH, rightX, rightY, rightW, rightH };
    }

    /* ═══════════════════════════════════════════════
       render(data)  — Main entry point
       ═══════════════════════════════════════════════ */
    render(data) {
      const g = this.g;
      const snapshot         = data?.snapshotFrame      || null;
      const detection        = data?.detection          || {};
      const geoHarmony       = data?.geometricalHarmony || {};
      const shapeDist        = data?.shapeDistribution  || {};
      const diagnosis        = data?.diagnosis          || {};
      const chromatic        = data?.chromaticContext    || {};
      const paletteDist      = data?.paletteDist        || { totalArea: 0, colors: [] };
      const timestampText    = data?.timestampText      || "";

      // ── Background ──
      g.background(C.bg[0], C.bg[1], C.bg[2]);

      // ── Header ──
      this._drawHeader(g, timestampText);

      const L = this.getLayout();

      // ── Left: Captured Mosaic ──
      this._drawSnapshotPanel(g, L, snapshot);

      // ── Right: 4 stacked sections ──
      const sectionW = L.rightW;
      let curY = L.rightY;

    const detH   = 104;
const harmH  = 176;
const secGap = 10;

// Fill the rest of the right column with Diagnosis
const diagH = Math.max(144, L.rightH - detH - harmH - secGap * 2);

      // 1. Detection Panel
      this._drawDetectionPanel(g, L.rightX, curY, sectionW, detH, detection);
      curY += detH + secGap;

      // 2. Geometrical Harmony
      this._drawHarmonyPanel(g, L.rightX, curY, sectionW, harmH, geoHarmony, shapeDist);
      curY += harmH + secGap;

      // 3. Structural Diagnosis
      this._drawDiagnosisPanel(g, L.rightX, curY, sectionW, diagH, diagnosis);
      curY += diagH + secGap;

      // 4. Chromatic Context
      // this._drawChromaticPanel(g, L.rightX, curY, sectionW, chromH, chromatic);
    }

/* ═══════════════════════════════════════════════
   HEADER
   ═══════════════════════════════════════════════ */
_drawHeader(g, timestamp) {
  g.noStroke();
  g.fill(0);
  g.textAlign(g.LEFT, g.CENTER);
  g.textSize(17);
  g.textStyle(g.BOLD);

  const title1 = "The Geometry of Us";
  g.text(title1, 30, 28);

  g.textStyle(g.NORMAL);
  if (timestamp) {
    g.fill(0);
    g.textSize(10);
    g.text("Captured: " + timestamp, 30, 48);
  }

  g.stroke(0, 40);
  g.strokeWeight(1);
  g.line(30, 62, this.w - 30, 62);
  g.noStroke();
}
    /* ═══════════════════════════════════════════════
       LEFT PANEL — Captured Mosaic
       ═══════════════════════════════════════════════ */
    _drawSnapshotPanel(g, L, snapshot) {
      this._card(g, L.leftX, L.leftY, L.leftW, L.leftH);
      this._cardTitle(g, L.leftX, L.leftY, L.leftW, "Captured Mosaic");

      const pad = 14;
      const imgX = L.leftX + pad;
      const imgY = L.leftY + 38;
      const imgW = L.leftW - pad * 2;
      const imgH = L.leftH - 52;

      if (snapshot) {
        const sW = snapshot.width  || 1;
        const sH = snapshot.height || 1;
        const sc = Math.min(imgW / sW, imgH / sH);
        const dw = sW * sc;
        const dh = sH * sc;
        const cx = imgX + (imgW - dw) / 2;
        const cy = imgY + (imgH - dh) / 2;

        // Subtle frame
        g.push();
        g.noFill();
        g.stroke(C.cardBorder[0], C.cardBorder[1], C.cardBorder[2]);
        g.strokeWeight(1);
        g.rect(cx - 1, cy - 1, dw + 2, dh + 2, 6);
        g.pop();

        g.image(snapshot, cx, cy, dw, dh);
      } else {
        g.fill(C.textMuted[0], C.textMuted[1], C.textMuted[2]);
        g.textAlign(g.CENTER, g.CENTER);
        g.textSize(13);
        g.text("No captured snapshot available.", L.leftX + L.leftW / 2, L.leftY + L.leftH / 2);
      }
    }

    /* ═══════════════════════════════════════════════
       SECTION 1 — Detection Panel
       ═══════════════════════════════════════════════ */
    _drawDetectionPanel(g, x, y, w, h, detection) {
      this._card(g, x, y, w, h);
      this._cardTitle(g, x, y, w, "Detection Panel");

      const pad   = 16;
      const lx    = x + pad;
      const valX  = x + w - pad;
      let   row   = y + 42;
      const rowH  = 20;

      // Dominant Shape
      this._shapeIcon(g, lx, row - 5, 10, detection.dominantShape);
      this._detRow(g, lx + 16, row, valX, "Dominant Shape", detection.dominantShape || "\u2014");
      row += rowH;

      // Symmetry
      this._detRow(g, lx + 16, row, valX, "Symmetry", Math.round(detection.symmetryPercent || 0) + "%");
      row += rowH;
    }

    _detRow(g, lx, y, rx, label, value) {
      g.fill(C.textMuted[0], C.textMuted[1], C.textMuted[2]);
      g.textAlign(g.LEFT, g.CENTER);
      g.textSize(11);
      g.textStyle(g.NORMAL);
      g.text(label, lx, y);

      g.fill(C.textPrimary[0], C.textPrimary[1], C.textPrimary[2]);
      g.textAlign(g.RIGHT, g.CENTER);
      g.textSize(11);
      g.textStyle(g.BOLD);
      g.text(String(value), rx, y);
      g.textStyle(g.NORMAL);
    }

    /* ═══════════════════════════════════════════════
       SECTION 2 — Geometrical Harmony
       ═══════════════════════════════════════════════ */
    _drawHarmonyPanel(g, x, y, w, h, harmony, distribution) {
      this._card(g, x, y, w, h);
      this._cardTitle(g, x, y, w, "Geometrical Harmony");

      const pad = 16;
      const score   = Number(harmony.score       ?? 0);
      const pct     = Number(harmony.scorePercent ?? 0);
      const label   = harmony.label              || "\u2014";

      g.fill(C.textPrimary[0], C.textPrimary[1], C.textPrimary[2]);
g.textAlign(g.LEFT, g.BASELINE);
g.textSize(28);
g.textStyle(g.BOLD);

g.text(pct + "%", x + pad, y + 66);

      // Classification badge
      var badgeColor = this._labelColor(label);
      g.textSize(11);
      g.textStyle(g.BOLD);
      var labelTextW = g.textWidth(label);
      var badgeW = labelTextW + 18;
      var badgeX = x + w - pad - badgeW;

      g.fill(badgeColor[0], badgeColor[1], badgeColor[2], 25);
      g.noStroke();
      g.rect(badgeX, y + 49, badgeW, 22, 6);

      g.fill(badgeColor[0], badgeColor[1], badgeColor[2]);
      g.textAlign(g.CENTER, g.CENTER);
      g.text(label, badgeX + badgeW / 2, y + 60);
      g.textStyle(g.NORMAL);

      // Shape distribution bars
      var barY  = y + 100;
      var barW  = w - pad * 2;
      var barH  = 14;
      var barGap = 22;

      var dist = distribution || {};
      this._distBar(g, x + pad, barY, barW, barH, "Triangle", Math.round(dist.triangle || 0), C.barTriangle);
      barY += barGap;
      this._distBar(g, x + pad, barY, barW, barH, "Square",   Math.round(dist.square   || 0), C.barSquare);
      barY += barGap;
      this._distBar(g, x + pad, barY, barW, barH, "Hexagon",  Math.round(dist.hexagon  || 0), C.barHexagon);
    }

    _distBar(g, x, y, w, h, label, pct, col) {
      // Label
      g.fill(C.textMuted[0], C.textMuted[1], C.textMuted[2]);
      g.textAlign(g.LEFT, g.CENTER);
      g.textSize(10);
      g.text(label, x, y + h / 2 - 1);

      var labelW = 62;
      var barX = x + labelW;
      var barW = w - labelW - 38;

      // Track
      g.noStroke();
      g.fill(C.barBg[0], C.barBg[1], C.barBg[2]);
      g.rect(barX, y, barW, h, 4);

      // Fill
      var fillW = Math.max(0, (barW * Math.min(pct, 100)) / 100);
      if (fillW > 0) {
        g.fill(col[0], col[1], col[2]);
        g.rect(barX, y, fillW, h, 4);
      }

      // Percentage
      g.fill(C.textPrimary[0], C.textPrimary[1], C.textPrimary[2]);
      g.textAlign(g.RIGHT, g.CENTER);
      g.textSize(10);
      g.textStyle(g.BOLD);
      g.text(pct + "%", x + w, y + h / 2 - 1);
      g.textStyle(g.NORMAL);
    }

    /* ═══════════════════════════════════════════════
       SECTION 3 — Structural Diagnosis
       ═══════════════════════════════════════════════ */
    _drawDiagnosisPanel(g, x, y, w, h, diagnosis) {
      this._card(g, x, y, w, h);
      this._cardTitle(g, x, y, w, "Structural Diagnosis");

      var pad  = 16;
      var text = String(diagnosis.text || "No diagnostic data available.");

      // Meta tags
      var symLvl  = diagnosis.symmetryLevel  || "\u2014";
      var shapDom = diagnosis.shapeDominance || "\u2014";

      g.fill(C.textDim[0], C.textDim[1], C.textDim[2]);
      g.textAlign(g.LEFT, g.CENTER);
      g.textSize(9);
      g.text("Symmetry: " + symLvl + "  \u00B7  Shape Profile: " + shapDom, x + pad, y + 38);

      // Paragraph wrapped
      g.fill(C.textMuted[0], C.textMuted[1], C.textMuted[2]);
      g.textAlign(g.LEFT, g.TOP);
      g.textSize(10.5);

      var maxW = w - pad * 2;
      var lines = this._wrapText(g, text, maxW);
      var startY = y + 52;
      var lineH  = 14;
      var maxLines = Math.min(lines.length, 6);

      for (var i = 0; i < maxLines; i++) {
        g.text(lines[i], x + pad, startY + i * lineH);
      }
    }

    /* ═══════════════════════════════════════════════
       SECTION 4 — Chromatic Context (Non-scored)
       ═══════════════════════════════════════════════ */
    _drawChromaticPanel(g, x, y, w, h, chromatic) {
      this._card(g, x, y, w, h);
      this._cardTitle(g, x, y, w, "Chromatic Context (Non-scored)");

      var pad = 16;

      var colorName = chromatic.color || "Unknown";
      var meanings  = chromatic.meanings || [];
      var rgb       = chromatic.rgb || { r: 120, g: 120, b: 120 };

      // Color swatch
      g.push();
      g.fill(rgb.r, rgb.g, rgb.b);
      g.rect(x + pad, y + 38, 14, 14, 4);
      g.pop();

      // Color name
      g.fill(C.textPrimary[0], C.textPrimary[1], C.textPrimary[2]);
      g.textAlign(g.LEFT, g.CENTER);
      g.textSize(12);
      g.textStyle(g.BOLD);
      g.text(colorName, x + pad + 22, y + 45);
      g.textStyle(g.NORMAL);

      // Meanings
      if (meanings.length) {
        g.fill(C.accentPurple[0], C.accentPurple[1], C.accentPurple[2]);
        g.textSize(10);
        g.text(meanings.join("  \u00B7  "), x + pad, y + 63);
      }

      // Disclaimer
      g.fill(C.textDim[0], C.textDim[1], C.textDim[2]);
      g.textSize(8.5);
      g.text("Color detection does not influence structural harmony.", x + pad, y + 79);
    }

    /* ═══════════════════════════════════════════════
       SHARED DRAWING HELPERS
       ═══════════════════════════════════════════════ */

    _card(g, x, y, w, h) {
      g.push();
      // Subtle shadow
      g.noStroke();
      g.fill(0, 0, 0, 8);
      g.rect(x + 1, y + 2, w, h, 10);
      // Card bg
      g.fill(C.cardBg[0], C.cardBg[1], C.cardBg[2]);
      g.rect(x, y, w, h, 10);

      g.stroke(C.cardBorder[0], C.cardBorder[1], C.cardBorder[2]);
      g.strokeWeight(1);
      g.noFill();
      g.rect(x, y, w, h, 10);
      g.pop();
    }

   _cardTitle(g, x, y, w, title) {
  g.push();
  g.noStroke();
  g.fill(C.cardHeader[0], C.cardHeader[1], C.cardHeader[2], 220);
  g.rect(x + 1, y + 1, w - 2, 26, 9, 9, 0, 0);
  g.pop();

  g.fill(0);
  g.textAlign(g.LEFT, g.CENTER);
  g.textSize(11);
  g.textStyle(g.BOLD);
  g.text(title, x + 14, y + 14);
  g.textStyle(g.NORMAL);
}

    _shapeIcon(g, x, y, size, shapeType) {
      g.push();
      g.noFill();
      g.strokeWeight(1.5);

      var type = String(shapeType || "").toLowerCase();
      var cx = x + size / 2;
      var cy = y + size / 2;
      var r  = size / 2;

      if (type === "triangle") {
        g.stroke(C.barTriangle[0], C.barTriangle[1], C.barTriangle[2]);
        g.triangle(cx, cy - r, cx - r, cy + r, cx + r, cy + r);
      } else if (type === "square") {
        g.stroke(C.barSquare[0], C.barSquare[1], C.barSquare[2]);
        g.rect(cx - r * 0.8, cy - r * 0.8, size * 0.8, size * 0.8);
      } else if (type === "hexagon") {
        g.stroke(C.barHexagon[0], C.barHexagon[1], C.barHexagon[2]);
        g.beginShape();
        for (var i = 0; i < 6; i++) {
          var a = (Math.PI / 3) * i - Math.PI / 2;
          g.vertex(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        g.endShape(g.CLOSE);
      }
      g.pop();
    }

    _labelColor(label) {
      switch (label) {
        case "Structurally Unified": return C.accentGreen;
        case "Balanced":             return C.accentBlue;
        case "Transitional":         return C.accentGold;
        case "Fragmented":           return C.accentRed;
        case "Abstract":             return C.accentPurple;
        default:                     return C.textMuted;
      }
    }

    _wrapText(g, text, maxW) {
      var words = String(text || "").split(/\s+/).filter(Boolean);
      if (!words.length) return [""];
      var lines = [];
      var cur = words[0];
      for (var i = 1; i < words.length; i++) {
        var next = cur + " " + words[i];
        if (g.textWidth(next) <= maxW) cur = next;
        else { lines.push(cur); cur = words[i]; }
      }
      lines.push(cur);
      return lines;
    }

    _getPaletteRGB(name) {
      if (!name) return null;
      var n = String(name).toLowerCase();
      var palette = this.paletteCfg?.colors || [];
      for (var c of palette) {
        if (String(c.name || "").toLowerCase() === n) {
          if (c.rgb && Array.isArray(c.rgb)) return { r: c.rgb[0], g: c.rgb[1], b: c.rgb[2] };
        }
      }
      if (n === "unknown") return { r: 120, g: 120, b: 120 };
      if (n === "black")   return { r: 25,  g: 25,  b: 25 };
      if (n === "white")   return { r: 245, g: 245, b: 245 };
      return null;
    }
  }

  window.App = window.App || {};
  window.App.ResultsView = ResultsView;
})();
