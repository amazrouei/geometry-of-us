(function () {
  "use strict";

  class Preprocessor {
    /*
      Preprocessor
      - Purpose: Convert a camera frame into useful CV buffers:
        1) grayscale image
        2) edge magnitude image (Sobel) OR contrast mask
        3) binary mask (0/1) for shape detection
      - Main approach:
        - Downsample for speed
        - Convert RGB -> luminance grayscale (Rec.709 weights)
        - Optional blur to reduce noise
        - Either:
          a) Sobel edges -> threshold -> binary, or
          b) Contrast threshold on grayscale -> binary
        - Optional morphology (dilate/erode) to clean the mask
      - Key tuning vars:
        - ds: downsample factor
        - blurRadius: denoise strength
        - edgeK / grayK: threshold sensitivity (autoThreshold uses mean + K*std)
        - morph.dilate / morph.erode: mask cleanup iterations
    */
    constructor(options = {}) {
      const {
        inputW,
        inputH,
        downsample = 2,
        blurRadius = 2,
        mode = "sobel",
        autoThreshold = true,
        edgeK = 0.8,
        grayK = 0.3,
        morph = { dilate: 1, erode: 0 },
      } = options;

      if (!inputW || !inputH) {
        throw new Error("Preprocessor requires inputW and inputH");
      }

      this.inputW = inputW;
      this.inputH = inputH;

      this.ds = Math.max(1, Math.floor(downsample));
      this.w = Math.max(1, Math.floor(inputW / this.ds));
      this.h = Math.max(1, Math.floor(inputH / this.ds));

      this.blurRadius = Math.max(0, Math.floor(blurRadius));
      this.mode = mode;
      this.autoThreshold = !!autoThreshold;
      this.edgeK = edgeK;
      this.grayK = grayK;

      this.morph = {
        dilate: Math.max(0, Math.floor(morph?.dilate ?? 1)),
        erode: Math.max(0, Math.floor(morph?.erode ?? 0)),
      };

      this.dsFrame = null;

      this.grayImg = null;
      this.edgeImg = null;
      this.binaryImg = null;

      this.gray = new Float32Array(this.w * this.h);
      this.blur = new Float32Array(this.w * this.h);
      this.tmp = new Float32Array(this.w * this.h);
      this.edge = new Float32Array(this.w * this.h);
      this.bin = new Uint8Array(this.w * this.h);
      this.bin2 = new Uint8Array(this.w * this.h);

      this.ready = false;
    }

    /*
      init()
      - Allocates the downsample buffer and debug images (gray / edge / binary).
      - pixelDensity(1) keeps pixel indexing stable across devices.
    */
    init() {
      this.dsFrame = createGraphics(this.w, this.h);
      this.dsFrame.pixelDensity(1);

      this.grayImg = createImage(this.w, this.h);
      this.edgeImg = createImage(this.w, this.h);
      this.binaryImg = createImage(this.w, this.h);

      this.ready = true;
    }

    /*
      update(sourceFrame)
      - Runs the full preprocessing pipeline on the provided frame.
      - Output is stored internally and accessible via getters:
        getGrayImage(), getEdgeImage(), getBinaryImage(), getBinaryMask()
    */
    update(sourceFrame) {
      if (!this.ready || !sourceFrame) return;

      this.dsFrame.image(sourceFrame, 0, 0, this.w, this.h);

      this.dsFrame.loadPixels();
      const px = this.dsFrame.pixels;

      // RGB -> grayscale using Rec.709 luminance weights (stable for human-perceived brightness).
      for (let i = 0, p = 0; i < this.gray.length; i++, p += 4) {
        const r = px[p];
        const g = px[p + 1];
        const b = px[p + 2];
        this.gray[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }

      // Blur reduces noise before edge/threshold steps.
      if (this.blurRadius > 0) {
        this._boxBlurSeparable(this.gray, this.blur, this.tmp, this.w, this.h, this.blurRadius);
      } else {
        this.blur.set(this.gray);
      }

      // Two supported modes:
      // - "sobel": detect edges first, then threshold edges
      // - "contrast": threshold grayscale contrast directly (useful for strong light/dark shapes)
      if (this.mode === "contrast") {
        this._thresholdContrastToBinary();
        this.edge.fill(0);
      } else {
        this._sobelEdges(this.blur, this.edge, this.w, this.h);
        this._thresholdEdgesToBinary();
      }

      // Morphology cleans the binary mask (fills small gaps or removes speckles).
      for (let k = 0; k < this.morph.dilate; k++) this._dilate(this.bin, this.bin2, this.w, this.h);
      for (let k = 0; k < this.morph.erode; k++) this._erode(this.bin, this.bin2, this.w, this.h);

      this._writeGrayImage();
      this._writeEdgeImage();
      this._writeBinaryImage();
    }

    getGrayImage() { return this.grayImg; }
    getEdgeImage() { return this.edgeImg; }
    getBinaryImage() { return this.binaryImg; }

    // Returns the raw 0/1 mask used by later detectors (fast to read, no image conversion needed).
    getBinaryMask() { return this.bin; }

    getWidth() { return this.w; }
    getHeight() { return this.h; }

    /*
      _stats(arr)
      - Returns mean and standard deviation.
      - Used for auto-thresholding: threshold = mean + K * std
        (K controls sensitivity; higher K => fewer pixels marked as "on")
    */
    _stats(arr) {
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i];
      const mean = sum / arr.length;

      let varSum = 0;
      for (let i = 0; i < arr.length; i++) {
        const d = arr[i] - mean;
        varSum += d * d;
      }
      const std = Math.sqrt(varSum / arr.length) || 1;
      return { mean, std };
    }

    /*
      _boxBlurSeparable(src, dst, tmp, w, h, r)
      - Fast blur using two 1D passes (horizontal then vertical).
      - Separable blur is cheaper than a full 2D kernel for the same radius.
    */
    _boxBlurSeparable(src, dst, tmp, w, h, r) {
      for (let y = 0; y < h; y++) {
        let sum = 0;
        const row = y * w;

        for (let x = -r; x <= r; x++) {
          const xx = Math.max(0, Math.min(w - 1, x));
          sum += src[row + xx];
        }

        for (let x = 0; x < w; x++) {
          tmp[row + x] = sum / (2 * r + 1);

          const xRemove = x - r;
          const xAdd = x + r + 1;

          const xr = Math.max(0, Math.min(w - 1, xRemove));
          const xa = Math.max(0, Math.min(w - 1, xAdd));

          sum += src[row + xa] - src[row + xr];
        }
      }

      for (let x = 0; x < w; x++) {
        let sum = 0;

        for (let y = -r; y <= r; y++) {
          const yy = Math.max(0, Math.min(h - 1, y));
          sum += tmp[yy * w + x];
        }

        for (let y = 0; y < h; y++) {
          dst[y * w + x] = sum / (2 * r + 1);

          const yRemove = y - r;
          const yAdd = y + r + 1;

          const yr = Math.max(0, Math.min(h - 1, yRemove));
          const ya = Math.max(0, Math.min(h - 1, yAdd));

          sum += tmp[ya * w + x] - tmp[yr * w + x];
        }
      }
    }

    /*
      _sobelEdges(gray, edge, w, h)
      - Computes edge magnitude using Sobel operator.
      - Output is not binary; it is a "strength" map that will be thresholded later.
    */
    _sobelEdges(gray, edge, w, h) {
      edge.fill(0);

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;

          const tl = gray[(y - 1) * w + (x - 1)];
          const tc = gray[(y - 1) * w + x];
          const tr = gray[(y - 1) * w + (x + 1)];
          const ml = gray[y * w + (x - 1)];
          const mr = gray[y * w + (x + 1)];
          const bl = gray[(y + 1) * w + (x - 1)];
          const bc = gray[(y + 1) * w + x];
          const br = gray[(y + 1) * w + (x + 1)];

          const gx = (-1 * tl) + (1 * tr) + (-2 * ml) + (2 * mr) + (-1 * bl) + (1 * br);
          const gy = (-1 * tl) + (-2 * tc) + (-1 * tr) + (1 * bl) + (2 * bc) + (1 * br);

          edge[i] = Math.sqrt(gx * gx + gy * gy);
        }
      }
    }

    /*
      _thresholdEdgesToBinary()
      - Converts the edge strength map into a 0/1 mask.
      - Auto-threshold uses mean + edgeK * std over the whole edge map.
    */
    _thresholdEdgesToBinary() {
      let thr;
      if (this.autoThreshold) {
        const { mean, std } = this._stats(this.edge);
        thr = mean + this.edgeK * std;
      } else {
        thr = 80;
      }

      for (let i = 0; i < this.bin.length; i++) {
        this.bin[i] = this.edge[i] > thr ? 1 : 0;
      }
    }

    /*
      _thresholdContrastToBinary()
      - Creates a mask from grayscale brightness.
      - By default, marks "darker-than-threshold" pixels as 1 (foreground),
        which is useful if shapes are darker than the background.
    */
    _thresholdContrastToBinary() {
      let thr;
      if (this.autoThreshold) {
        const { mean, std } = this._stats(this.blur);
        thr = mean + this.grayK * std;
      } else {
        thr = 128;
      }

      for (let i = 0; i < this.bin.length; i++) {
        this.bin[i] = this.blur[i] < thr ? 1 : 0;
      }
    }

    /*
      _dilate(src, tmp, w, h)
      - Expands white pixels (1s) to nearby neighbors.
      - Helps connect broken edges and close small gaps.
    */
    _dilate(src, tmp, w, h) {
      tmp.fill(0);

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const on =
            src[i] ||
            src[i - 1] || src[i + 1] ||
            src[i - w] || src[i + w] ||
            src[i - w - 1] || src[i - w + 1] ||
            src[i + w - 1] || src[i + w + 1];

          tmp[i] = on ? 1 : 0;
        }
      }
      src.set(tmp);
    }

    /*
      _erode(src, tmp, w, h)
      - Shrinks white pixels (1s) by requiring all neighbors to be on.
      - Removes small noise dots and thin artifacts.
    */
    _erode(src, tmp, w, h) {
      tmp.fill(0);

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const on =
            src[i] &&
            src[i - 1] && src[i + 1] &&
            src[i - w] && src[i + w] &&
            src[i - w - 1] && src[i - w + 1] &&
            src[i + w - 1] && src[i + w + 1];

          tmp[i] = on ? 1 : 0;
        }
      }
      src.set(tmp);
    }

    /*
      _writeGrayImage()
      - Writes the grayscale float buffer into a p5.Image for debugging/preview.
    */
    _writeGrayImage() {
      this.grayImg.loadPixels();
      const out = this.grayImg.pixels;

      for (let i = 0, p = 0; i < this.gray.length; i++, p += 4) {
        const v = Math.max(0, Math.min(255, this.gray[i]));
        out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
      }
      this.grayImg.updatePixels();
    }

    /*
      _writeEdgeImage()
      - Converts edge magnitudes to 0..255 for visualization.
      - Scaling uses mean + 3*std to avoid a few strong edges dominating the view.
    */
    _writeEdgeImage() {
      this.edgeImg.loadPixels();
      const out = this.edgeImg.pixels;

      const { mean, std } = this._stats(this.edge);
      const scale = 255 / (mean + 3 * std + 1);

      for (let i = 0, p = 0; i < this.edge.length; i++, p += 4) {
        const v = Math.max(0, Math.min(255, this.edge[i] * scale));
        out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
      }
      this.edgeImg.updatePixels();
    }

    /*
      _writeBinaryImage()
      - Writes the 0/1 mask to a p5.Image (0 = black, 1 = white).
    */
    _writeBinaryImage() {
      this.binaryImg.loadPixels();
      const out = this.binaryImg.pixels;

      for (let i = 0, p = 0; i < this.bin.length; i++, p += 4) {
        const v = this.bin[i] ? 255 : 0;
        out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
      }
      this.binaryImg.updatePixels();
    }
  }

  window.App = window.App || {};
  window.App.Preprocessor = Preprocessor;
})();
