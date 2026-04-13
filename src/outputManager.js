(function () {
  "use strict";

  window.App = window.App || {};

  /* ═══════════════════════════════════════════════════════
     OutputManager — Result generation, print, download,
     share (Web Share API) and QR-code server upload.
     ═══════════════════════════════════════════════════════ */

  function OutputManager() {
    this._lastImageDataUrl = null;
    this._lastAnalysisHTML = "";
    this._lastQrUrl        = null;
  }

  /* ── Getters ── */
  OutputManager.prototype.getLastImageDataUrl = function () {
    return this._lastImageDataUrl;
  };
  OutputManager.prototype.getLastAnalysisHTML = function () {
    return this._lastAnalysisHTML;
  };
  OutputManager.prototype.getQrUrl = function () {
    return this._lastQrUrl;
  };

  /* ═══════════════════════════════════════════════
     generate()  — Build output from ResultsView graphics
     ═══════════════════════════════════════════════ */
  OutputManager.prototype.generate = function (resultsGraphics, analysisData) {
    this._lastImageDataUrl = resultsGraphics.canvas.toDataURL("image/png");
    this._lastAnalysisHTML = this._buildAnalysisHTML(analysisData);

    return {
      imageDataUrl: this._lastImageDataUrl,
      analysisHTML: this._lastAnalysisHTML,
    };
  };

  OutputManager.prototype._buildAnalysisHTML = function (data) {
    var lines = [];

    if (data.detection) {
      lines.push("<strong>Dominant Shape:</strong> " + (data.detection.dominantShape || "\u2014"));
      lines.push("<strong>Symmetry:</strong> " + (data.detection.symmetryPercent || 0) + "%");
      lines.push("<strong>Dominant Colour:</strong> " + (data.detection.dominantColor || "\u2014"));
    }

    if (data.geometricalHarmony && data.geometricalHarmony.label) {
      lines.push(
        "<strong>Harmony:</strong> " +
        data.geometricalHarmony.label +
        " (" + (data.geometricalHarmony.scorePercent || 0) + "%)"
      );
    }

    if (data.diagnosis && data.diagnosis.text) {
      lines.push("<br><em>" + data.diagnosis.text + "</em>");
    }

    if (data.chromaticContext && data.chromaticContext.description) {
      lines.push("<br><strong>Chromatic Context:</strong> " + data.chromaticContext.description);
    }

    return lines.join("<br>");
  };

  /* ═══════════════════════════════════════════════
     saveToServer()  — POST image + analysis, get QR URL
     Works only when served through server.js;
     fails gracefully when opened via file://.
     ═══════════════════════════════════════════════ */
  OutputManager.prototype.saveToServer = function (callback) {
    var self = this;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/save-result", true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.timeout = 8000;

      xhr.ontimeout = function () {
        callback(new Error("Server timeout"), null);
      };
      xhr.onerror = function () {
        callback(new Error("Network error"), null);
      };
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 200) {
          try {
            var resp = JSON.parse(xhr.responseText);
            self._lastQrUrl = resp.url;
            callback(null, resp.url);
          } catch (e) {
            callback(e, null);
          }
        } else {
          callback(new Error("Server " + xhr.status), null);
        }
      };

      xhr.send(JSON.stringify({
        image:    this._lastImageDataUrl,
        analysis: this._lastAnalysisHTML,
      }));
    } catch (e) {
      callback(e, null);
    }
  };

  /* ═══════════════════════════════════════════════
     triggerPrint()  — In-page browser print
     Uses a hidden #print-content div + @media print CSS.
     ═══════════════════════════════════════════════ */
  OutputManager.prototype.triggerPrint = function () {
    var printDiv = document.getElementById("print-content");
    if (printDiv) {
      printDiv.innerHTML =
        '<img src="' + this._lastImageDataUrl + '" style="max-width:100%;border-radius:8px;" />' +
        '<div style="margin-top:16px;font-size:14px;line-height:1.7;color:#1e293b;">' +
          this._lastAnalysisHTML +
        '</div>';
    }
    window.print();
  };

  /* ═══════════════════════════════════════════════
     triggerDownload()  — Direct PNG download
     ═══════════════════════════════════════════════ */
  OutputManager.prototype.triggerDownload = function () {
    if (!this._lastImageDataUrl) return;
    var a      = document.createElement("a");
    a.href     = this._lastImageDataUrl;
    a.download = "geometry_of_us_" + Date.now() + ".png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /* ═══════════════════════════════════════════════
     triggerShare()  — Web Share API (AirDrop / mobile)
     Falls back to download if unsupported.
     ═══════════════════════════════════════════════ */
  OutputManager.prototype.triggerShare = function () {
    var self = this;

    if (!navigator.share || !this._lastImageDataUrl) {
      this.triggerDownload();
      return;
    }

    fetch(this._lastImageDataUrl)
      .then(function (res) { return res.blob(); })
      .then(function (blob) {
        var file = new File([blob], "geometry_of_us.png", { type: "image/png" });
        return navigator.share({
          title: "The Geometry of Us",
          text:  "My Geometric Harmony result",
          files: [file],
        });
      })
      .catch(function () {
        /* User cancelled or share failed — fall back to download */
        self.triggerDownload();
      });
  };

  window.App.OutputManager = OutputManager;
})();
