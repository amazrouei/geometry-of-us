(function () {
  "use strict";

  /**
   * ChromaticContext
   * ─────────────────
   * Provides perceptual / psychological associations for the dominant color.
   * This data is displayed under the "Chromatic Context (Non-scored)" section.
   *
   * IMPORTANT:  Color does NOT influence the Geometrical Harmony score.
   * This module exists purely for interpretive context.
   */
  class ChromaticContext {
    constructor(paletteConfig) {
      this.paletteCfg = paletteConfig || {};

      // Perceptual meanings mapped by colour name (lowercase key).
      this.meanings = {
        red:     { meanings: ["vitality", "aggression", "attraction"],           description: "Associated with vitality, aggression, and attraction — a colour that demands attention and stirs visceral response." },
        orange:  { meanings: ["warmth", "creativity", "energy"],                 description: "Evokes warmth, creativity, and sustained energy — a hue positioned between caution and invitation." },
        yellow:  { meanings: ["optimism", "intellect", "caution"],               description: "Carries connotations of optimism, intellect, and precaution — luminous yet alert in temperament." },
        green:   { meanings: ["growth", "harmony", "renewal"],                   description: "Speaks to growth, harmony, and renewal — a chromatic anchor in the natural spectrum." },
        cyan:    { meanings: ["clarity", "calm", "freshness"],                   description: "Suggests clarity, calm, and freshness — an intermediary between the depth of blue and the vibrancy of green." },
        blue:    { meanings: ["depth", "trust", "tranquility"],                  description: "Resonates with depth, trust, and tranquility — a perceptually receding hue that invites contemplation." },
        purple:  { meanings: ["mystery", "spirituality", "luxury"],              description: "Conveys mystery, spirituality, and a sense of rarity — historically rare in nature and therefore coded as precious." },
        pink:    { meanings: ["tenderness", "playfulness", "compassion"],        description: "Communicates tenderness, playfulness, and compassion — a softened variant of red's intensity." },
        white:   { meanings: ["purity", "space", "openness"],                    description: "Embodies purity, spatial openness, and potential — the perceptual ground against which other hues define themselves." },
        black:   { meanings: ["authority", "elegance", "void"],                  description: "Projects authority, elegance, and absence — both the container and the negation of visible light." },
        unknown: { meanings: ["ambiguity", "transition", "indeterminacy"],       description: "No dominant chromatic signal was resolved — the palette remains ambiguous or transitional." },
      };
    }

    /**
     * getContext(paletteDist, shapes)
     * @returns {{ color, rgb, meanings[], description, disclaimer }}
     */
    getContext(paletteDist, shapes) {
      const colors = paletteDist?.colors || [];
      let dominant = null;

      // Pick the first colour that is not "Unknown".
      for (const c of colors) {
        const n = String(c.name || "").toLowerCase();
        if (n && n !== "unknown" && Number(c.percent || 0) > 0) {
          dominant = c;
          break;
        }
      }

      if (!dominant && colors.length > 0) dominant = colors[0];

      const name = dominant ? String(dominant.name || "Unknown") : "Unknown";
      const key  = name.toLowerCase();
      const entry = this.meanings[key] || this.meanings["unknown"];

      const rgb = this._resolveRGB(name);

      return {
        color:       name,
        rgb:         rgb,
        meanings:    entry.meanings,
        description: entry.description,
        disclaimer:  "Chromatic context is provided for perceptual reference only. Color does not influence the structural harmony score.",
      };
    }

    _resolveRGB(name) {
      const n = name.toLowerCase();
      const palette = this.paletteCfg?.colors || [];

      for (const c of palette) {
        if (String(c.name || "").toLowerCase() === n) {
          if (c.rgb && Array.isArray(c.rgb)) return { r: c.rgb[0], g: c.rgb[1], b: c.rgb[2] };
        }
      }

      if (n === "black") return { r: 25, g: 25, b: 25 };
      if (n === "white") return { r: 245, g: 245, b: 245 };
      return { r: 120, g: 120, b: 120 };
    }
  }

  window.App = window.App || {};
  window.App.ChromaticContext = ChromaticContext;
})();
