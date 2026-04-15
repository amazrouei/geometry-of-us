(function () {
  "use strict";

  window.App = window.App || {};

  /* ═══════════════════════════════════════════════════════
     TouchUI — Full-screen DOM overlay manager
     States:  WELCOME → ARRANGING → PROCESSING → RESULTS
     ═══════════════════════════════════════════════════════ */

  var STATE = {
    WELCOME:    "WELCOME",
    ARRANGING:  "ARRANGING",
    PROCESSING: "PROCESSING",
    RESULTS:    "RESULTS",
  };

  function TouchUI() {
    this.state       = STATE.WELCOME;
    this._callbacks  = {};
    this._welcomeEl    = null;
    this._printBar     = null;
    this._processingEl = null;
    this._resultsEl    = null;
  }

  /* ── Public API ── */

  TouchUI.prototype.init = function (callbacks) {
    this._callbacks = callbacks || {};
    this._createWelcomeOverlay();
    this._createPrintBar();
    this._createProcessingOverlay();
    this._createResultsOverlay();
    this._transitionTo(STATE.WELCOME);
  };

  TouchUI.prototype.getState = function () {
    return this.state;
  };

  /** Show the results screen with the generated image, analysis text, and QR url */
  TouchUI.prototype.showResults = function (imageDataUrl, analysisHTML, qrUrl) {
    var imgEl = this._resultsEl.querySelector("#result-image");
    var qrEl  = this._resultsEl.querySelector("#result-qr");
    var qrSec = this._resultsEl.querySelector(".results-qr-section");

    if (imgEl) imgEl.src = imageDataUrl;

    /* Render QR code (only when server URL is available) */
    if (qrUrl && qrEl && typeof QRCode !== "undefined") {
      qrEl.innerHTML = "";
      var qrCanvas   = document.createElement("canvas");
      qrEl.appendChild(qrCanvas);
      QRCode.toCanvas(qrCanvas, qrUrl, {
        width:  180,
        margin: 2,
        color:  { dark: "#1e293b", light: "#ffffff" },
      });
      if (qrSec) qrSec.style.display = "block";
    } else {
      if (qrSec) qrSec.style.display = "none";
    }

    this._transitionTo(STATE.RESULTS);
  };

  /* ── State machine ── */

  TouchUI.prototype._transitionTo = function (newState) {
    this.state = newState;

    /* Hide all overlays first */
    this._welcomeEl.style.display    = "none";
    this._printBar.style.display     = "none";
    this._processingEl.style.display = "none";
    this._resultsEl.style.display    = "none";

    /* Grab shared page elements */
    var appEl    = document.getElementById("app");
    var headerEl = document.querySelector(".page-header");
    var hintsEl  = document.querySelector(".keyboard-hints");
    var footerEl = document.querySelector(".footer");
    var oldBar   = document.getElementById("button-bar");
    var camBtn   = document.getElementById("camera-switch-btn");

    switch (newState) {
      case STATE.WELCOME:
        this._welcomeEl.style.display = "flex";
        if (appEl)    appEl.style.display    = "none";
        if (headerEl) headerEl.style.display = "none";
        if (hintsEl)  hintsEl.style.display  = "none";
        if (footerEl) footerEl.style.display = "none";
        if (oldBar)   oldBar.style.display   = "none";
        if (camBtn)   camBtn.classList.remove("visible");
        break;

      case STATE.ARRANGING:
        this._printBar.style.display = "flex";
        if (appEl)    appEl.style.display    = "flex";
        if (headerEl) headerEl.style.display = "block";
        if (hintsEl)  hintsEl.style.display  = "none";
        if (footerEl) footerEl.style.display = "block";
        if (oldBar)   oldBar.style.display   = "none";
        /* Show camera switch button during arranging (if multi-cam) */
        if (camBtn && camBtn.dataset.multiCam === "true") camBtn.classList.add("visible");
        break;

      case STATE.PROCESSING:
        this._processingEl.style.display = "flex";
        if (appEl)    appEl.style.display    = "flex";
        if (headerEl) headerEl.style.display = "block";
        if (oldBar)   oldBar.style.display   = "none";
        if (camBtn)   camBtn.classList.remove("visible");
        break;

      case STATE.RESULTS:
        this._resultsEl.style.display = "flex";
        if (appEl)    appEl.style.display    = "none";
        if (headerEl) headerEl.style.display = "none";
        if (hintsEl)  hintsEl.style.display  = "none";
        if (footerEl) footerEl.style.display = "none";
        if (oldBar)   oldBar.style.display   = "none";
        if (camBtn)   camBtn.classList.remove("visible");
        break;
    }
  };

  /* ── DOM creation helpers ── */

  TouchUI.prototype._createWelcomeOverlay = function () {
    var self = this;
    var el   = document.createElement("div");
    el.id    = "welcome-overlay";
    el.innerHTML =
      '<div class="welcome-content">' +
        '<p class="welcome-eyebrow">The Geometry of Us</p>' +
        '<h1 class="welcome-title">What is your geometric<br>harmony to one another?</h1>' +
        '<button id="welcome-start-btn" class="welcome-btn">' +
          '<span class="welcome-btn-icon">&#9654;</span> Start' +
        '</button>' +
      '</div>';
    document.body.appendChild(el);
    this._welcomeEl = el;

    el.querySelector("#welcome-start-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      self._transitionTo(STATE.ARRANGING);
      if (self._callbacks.onStart) self._callbacks.onStart();
    });
  };

  TouchUI.prototype._createPrintBar = function () {
    var self = this;
    var el   = document.createElement("div");
    el.id    = "print-bar";
    el.innerHTML =
      '<p class="print-hint">Arrange your shapes on the table, then press <strong>Print</strong> when ready</p>' +
      '<button id="print-capture-btn" class="print-btn">\u2399 Print</button>';
    document.body.appendChild(el);
    this._printBar = el;

    el.querySelector("#print-capture-btn").addEventListener("click", function () {
      self._transitionTo(STATE.PROCESSING);
      /* Small delay so the processing overlay renders before the heavy pipeline runs */
      setTimeout(function () {
        if (self._callbacks.onPrint) self._callbacks.onPrint();
      }, 80);
    });
  };

  TouchUI.prototype._createProcessingOverlay = function () {
    var el = document.createElement("div");
    el.id  = "processing-overlay";
    el.innerHTML =
      '<div class="processing-content">' +
        '<div class="processing-spinner"></div>' +
        '<p class="processing-text">Analysing your arrangement&hellip;</p>' +
      '</div>';
    document.body.appendChild(el);
    this._processingEl = el;
  };

  TouchUI.prototype._createResultsOverlay = function () {
    var self = this;
    var el   = document.createElement("div");
    el.id    = "results-overlay";

    el.innerHTML =
      '<div class="results-scroll-wrap">' +
        '<div class="results-content">' +
          '<h2 class="results-title">Your Geometric Harmony</h2>' +

          '<div class="results-body" style="justify-content:center;">' +
            '<div class="results-left" style="max-width:1100px; width:100%; text-align:center;">' +
              '<img id="result-image" src="" alt="Your Geometric Harmony result" />' +

              '<div class="results-actions" style="justify-content:center; margin-top:18px;">' +
                '<button id="res-print-btn" class="res-btn res-btn-primary">\uD83D\uDDA8 Print</button>' +
              '</div>' +

              '<div class="results-qr-section" style="margin-top:14px; display:none;">' +
                '<p class="qr-label">Scan to download on your phone</p>' +
                '<div id="result-qr"></div>' +
              '</div>' +

            '</div>' +
          '</div>' +

          '<button id="res-new-session-btn" class="welcome-btn" style="margin-top:24px;">' +
            'Start New Session' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(el);
    this._resultsEl = el;

    /* Wire action buttons */
    el.querySelector("#res-print-btn").addEventListener("click", function () {
      if (self._callbacks.onResultPrint) self._callbacks.onResultPrint();
    });
    el.querySelector("#res-new-session-btn").addEventListener("click", function () {
      self._transitionTo(STATE.WELCOME);
      if (self._callbacks.onNewSession) self._callbacks.onNewSession();
    });
  };

  window.App.TouchUI = TouchUI;
})();