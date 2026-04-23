(function () {
  "use strict";

   
  let cam;
  let pre;
  let detector;
  let colorer;
  let stable;
  let scorer;           
  let interpreter;      

   let shapeClassifier;
  let geoHarmonyScorer;
  let diagnosis;
  let chromaticCtx;
  let resultsView;

   let canvasEl;

   let exportBtn     = null;
  let exportJsonBtn = null;
  let newCaptureBtn = null;

   let touchUI       = null;
  let outputManager = null;

   let debugEnabled  = false;
  let lastLiveShapes = [];

   let harmonyResult        = null;   
  let shapeClassResult     = null;    
  let geoHarmonyResult     = null;    
  let diagnosisResult      = null;    
  let chromaticResult      = null;   
  let interpretResult      = null;   

   let PALETTE_CFG    = null;
  let HARMONY_CFG    = null;
  let INTERPRET_CFG  = null;

   const C = {
    bg:          [255, 255, 255],
    cardBg:      [248, 250, 252],
    cardBorder:  [226, 232, 240],
    textPrimary: [30,  41,  59],
    textMuted:   [100, 116, 139],
    textDim:     [148, 163, 184],
    accentBlue:  [59,  130, 246],
    accentGold:  [245, 158, 11],
    barBg:       [241, 245, 249],
  };

   
  window.preload = function () {
    PALETTE_CFG   = loadJSON("./config/palette.json");
    HARMONY_CFG   = loadJSON("./config/harmony.json");
    INTERPRET_CFG = loadJSON("./config/interpretation.json");
  };

  
  function setupApp() {
     cam = new window.App.CameraManager({ width: 640, height: 480, mirror: true });
    cam.init();

     pre = new window.App.Preprocessor({
      inputW: 640,
      inputH: 480,
      downsample: 2,
      blurRadius: 2,
      mode: "sobel",
      autoThreshold: true,
      edgeK: 0.8,
      morph: { dilate: 1, erode: 0 },
    });
    pre.init();

     detector = new window.App.ShapeDetector({
      w: pre.getWidth(),
      h: pre.getHeight(),
      minArea: 120,
      maxAreaRatio: 0.65,
      maxShapes: 30,
      maxContourPoints: 200,
      use8Connectivity: true,
    });

     colorer = new window.App.ColorAnalyzer(PALETTE_CFG, {
      maxSamples: 350,
      graySatThresh: 0.12,
      blackValThresh: 0.12,
      whiteValThresh: 0.92,
    });

     stable = new window.App.StabilityTracker({
      w: 640,
      h: 480,
      sampleStep: 6,
      smoothWindow: 12,
      stableThreshold: 5,
      shapeStableThreshold: 1.4,
      maxShapeCountDelta: 0.25,
      shapeMatchRadius: 18,
      stableFrames: 80,
      holdFrames: 20,
      warnFrames: 12,
    });

     scorer = new window.App.HarmonyScorer(HARMONY_CFG, PALETTE_CFG);

     interpreter = new window.App.InterpretiveTextGenerator(INTERPRET_CFG);

     shapeClassifier  = new window.App.ShapeClassifier({ dpEpsilonRatio: 0.04 });
    geoHarmonyScorer = new window.App.GeometricalHarmonyScorer(HARMONY_CFG);
    diagnosis        = new window.App.StructuralDiagnosis();
    chromaticCtx     = new window.App.ChromaticContext(PALETTE_CFG);

     resultsView = new window.App.ResultsView({ w: 1200, h: 720, paletteCfg: PALETTE_CFG });

     outputManager = new window.App.OutputManager();
    touchUI       = new window.App.TouchUI();
  }

  
  function resetToLive() {
    stable.reset();
    harmonyResult    = null;
    shapeClassResult = null;
    geoHarmonyResult = null;
    diagnosisResult  = null;
    chromaticResult  = null;
    interpretResult  = null;
  }

  
  function initTouchUI() {
    if (!touchUI) return;
    touchUI.init({
      onStart:          function () { resetToLive(); },
      onPrint:          function () { performCapture(); },
      onResultPrint:    function () { outputManager.triggerPrint(); },
      onResultDownload: function () { outputManager.triggerDownload(); },
      onResultShare:    function () { outputManager.triggerShare(); },
      onNewSession:     function () { resetToLive(); },
    });
  }

  
  function performCapture() {
    if (!cam || !cam.ready) return;

     harmonyResult    = null;
    shapeClassResult = null;
    geoHarmonyResult = null;
    diagnosisResult  = null;
    chromaticResult  = null;
    interpretResult  = null;

     pre.update(cam.getFrame());
    var shapes = detector.detect(pre.getBinaryMask());
    colorer.update(
      cam.getFrame(), shapes, detector.getLabelMap(),
      pre.getWidth(), pre.getHeight()
    );

     stable.forceFreeze(cam.getFrame(), shapes, pre.getBinaryImage());

    var snap          = stable.getSnapshotFrame();
    var snapBin       = stable.getSnapshotBinary();
    var frozenShapes  = stable.getSnapshotShapes();
    var frozenPalette = stable.getSnapshotPalette();

     harmonyResult = scorer.compute({
      shapes:         frozenShapes,
      paletteDist:    frozenPalette,
      binarySnapshot: snapBin,
      wSmall:         pre.getWidth(),
      hSmall:         pre.getHeight(),
    });

     shapeClassResult = shapeClassifier.classify(frozenShapes);

     var sym01 = (harmonyResult.symmetryOnlyScore || 0) / 100;
    geoHarmonyResult = geoHarmonyScorer.compute(
      sym01,
      shapeClassResult.distribution,
      shapeClassResult.totalClassified
    );

     diagnosisResult = diagnosis.generate({
      symmetryPercent: harmonyResult.symmetryOnlyScore,
      shapeData:       shapeClassResult,
      harmonyScore:    geoHarmonyResult.score,
      harmonyLabel:    geoHarmonyResult.label,
    });

     chromaticResult = chromaticCtx.getContext(frozenPalette, frozenShapes);

     interpretResult = interpreter.generate({
      scores:      harmonyResult,
      shapes:      frozenShapes,
      paletteDist: frozenPalette,
      wSmall:      pre.getWidth(),
      hSmall:      pre.getHeight(),
    });

     var detectionData = {
      dominantShape:   shapeClassResult ? shapeClassResult.dominantShape  : "\u2014",
      symmetryPercent: harmonyResult    ? harmonyResult.symmetryOnlyScore : 0,
      dominantColor:   getDominantColorName(frozenPalette),
    };

    resultsView.render({
      snapshotFrame:      snap,
      detection:          detectionData,
      geometricalHarmony: geoHarmonyResult || {},
      shapeDistribution:  shapeClassResult ? shapeClassResult.distribution : {},
      diagnosis:          diagnosisResult  || {},
      chromaticContext:   chromaticResult  || {},
      paletteDist:        frozenPalette,
      timestampText:      formatTimestamp(Date.now()),
    });

     var analysisData = {
      detection:          detectionData,
      geometricalHarmony: geoHarmonyResult || {},
      diagnosis:          diagnosisResult  || {},
      chromaticContext:   chromaticResult  || {},
    };

    var output = outputManager.generate(resultsView.getGraphics(), analysisData);

     outputManager.saveToServer(function (err, url) {
      touchUI.showResults(
        output.imageDataUrl,
        output.analysisHTML,
        err ? null : url
      );
    });
  }

   
  function makeButtons() {
    var bar = document.getElementById("button-bar");

    newCaptureBtn = createButton("New Capture");
    newCaptureBtn.parent(bar);
    newCaptureBtn.addClass("btn-primary");
    newCaptureBtn.mousePressed(function () {
      resetToLive();
    });

    exportBtn = createButton("Export PNG");
    exportBtn.parent(bar);
    exportBtn.mousePressed(function () {
      if (stable.getState() !== "RESULT") return;
      var g = resultsView.getGraphics();
      saveCanvas(g.canvas, "geometry_of_us_results", "png");
    });

    exportJsonBtn = createButton("Export JSON");
    exportJsonBtn.parent(bar);
    exportJsonBtn.mousePressed(function () {
      exportFrozenAnalysisJSON();
    });
  }

  function updateButtonsPositionAndVisibility() {
    var bar = document.getElementById("button-bar");
    if (!bar) return;

    var state = stable.getState();
    if (state === "RESULT") {
      bar.classList.add("visible");
    } else {
      bar.classList.remove("visible");
    }
  }

  
  function exportFrozenAnalysisJSON() {
    if (stable.getState() !== "RESULT") return;

    var snapTime = stable.getSnapshotTimeMs();
    var palette  = stable.getSnapshotPalette() || { totalArea: 0, colors: [] };
    var shapes   = stable.getSnapshotShapes()  || [];

    var payload = {
      meta: {
        project: "The Geometry of Us",
        exportedAtMs: Date.now(),
        snapshotCapturedAtMs: snapTime || null,
        snapshotCapturedAtText: snapTime ? new Date(snapTime).toISOString() : null,
      },
      detection: {
        dominantShape:    shapeClassResult ? shapeClassResult.dominantShape   : null,
        symmetryPercent:  harmonyResult    ? harmonyResult.symmetryOnlyScore  : null,
        dominantColor:    chromaticResult  ? chromaticResult.color            : null,
      },
      geometricalHarmony: geoHarmonyResult || null,
      shapeDistribution:  shapeClassResult ? shapeClassResult.distribution   : null,
      diagnosis:          diagnosisResult  || null,
      chromaticContext:    chromaticResult  || null,
      summary: {
        totalShapes: shapes.length,
        paletteDistribution: palette,
        legacyScores: harmonyResult,
      },
      shapes: shapes,
    };

    saveJSON(payload, "snapshot_analysis.json");
  }

 

function drawPanel(x, y, w, h, title) {
  push();
  noStroke();
  fill(C.cardBg[0], C.cardBg[1], C.cardBg[2]);
  rect(x, y, w, h, 10);

  stroke(C.cardBorder[0], C.cardBorder[1], C.cardBorder[2]);
  strokeWeight(1);
  noFill();
  rect(x, y, w, h, 10);

  noStroke();
  fill(241, 245, 249, 220);
  rect(x + 1, y + 1, w - 2, 26, 9, 9, 0, 0);

  fill(0);
  textAlign(LEFT, CENTER);
  textSize(11);
  textStyle(BOLD);
  text(title, x + 14, y + 14);
  textStyle(NORMAL);
  pop();
}

  
  function drawLiveVideoPanel(layout) {
    var lx = layout.x, ly = layout.y, lw = layout.w, lh = layout.h;

    drawPanel(lx, ly, lw, lh, "Live Feed");

    var pad = 14;
    var vx = lx + pad;
    var vy = ly + 38;
    var vw = lw - pad * 2;
    var vh = lh - 52;

    push();
    noFill();
    stroke(C.cardBorder[0], C.cardBorder[1], C.cardBorder[2]);
    strokeWeight(1);
    rect(vx, vy, vw, vh, 8);
    pop();

    cam.drawToCanvas(vx, vy, vw, vh);

     if (debugEnabled && lastLiveShapes && lastLiveShapes.length) {
      var sx = vw / pre.getWidth();
      var sy = vh / pre.getHeight();

      push();
      translate(vx, vy);
      scale(sx, sy);

      for (var i = 0; i < lastLiveShapes.length; i++) {
        var s = lastLiveShapes[i];
        stroke(0, 255, 180);
        strokeWeight(1);
        noFill();
        rect(s.bbox.x, s.bbox.y, s.bbox.w, s.bbox.h);

        stroke(255, 80, 80);
        strokeWeight(2);
        ellipse(s.centroid.x, s.centroid.y, 4, 4);
      }
      pop();
    }
  }

 
  function drawRightPanelFromPrintView(dst, src) {
    var g = resultsView.getGraphics();
    image(g, dst.x, dst.y, dst.w, dst.h, src.x, src.y, src.w, src.h);
  }

  

  function drawLiveRightPlaceholder(layout) {
  drawPanel(layout.x, layout.y, layout.w, layout.h, "Analysis");

  var pct = Math.round(stable.getStableProgress() * 100);
  var cx  = layout.x + layout.w / 2;

  push();

  noFill();
  stroke(C.barBg[0], C.barBg[1], C.barBg[2]);
  strokeWeight(5);
  arc(cx, layout.y + 100, 70, 70, 0, TWO_PI);

  stroke(0);
  strokeWeight(5);
  strokeCap(ROUND);
  arc(cx, layout.y + 100, 70, 70, -HALF_PI, -HALF_PI + TWO_PI * (pct / 100));

  noStroke();
  fill(0);
  textAlign(CENTER, CENTER);
  textSize(18);
  textStyle(BOLD);
  text(pct + "%", cx, layout.y + 100);
  textStyle(NORMAL);

  fill(0);
  textSize(10);
  text("Stability", cx, layout.y + 142);

  var state = stable.getState();
  var statusText = state === "LIVE" ? "Detecting motion…" : "Stabilising…";
  fill(0);
  textSize(9);
  text(statusText, cx, layout.y + 162);

  var shapeCount = lastLiveShapes ? lastLiveShapes.length : 0;
  fill(0);
  textSize(9);
  text("Shapes detected: " + shapeCount, cx, layout.y + 178);

  fill(0);
  textSize(8);
  text("Hold the scene steady, or press F to force capture", cx, layout.y + 210);

  pop();
}

 
  function formatTimestamp(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    var hh = String(d.getHours()).padStart(2, "0");
    var mi = String(d.getMinutes()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd + "  " + hh + ":" + mi;
  }

  
      
  function getDominantColorName(paletteDist) {
    var colors = (paletteDist && paletteDist.colors) || [];
    for (var i = 0; i < colors.length; i++) {
      var n = String(colors[i].name || "").toLowerCase();
      if (n && n !== "unknown" && Number(colors[i].percent || 0) > 0) {
        return colors[i].name;
      }
    }
    return colors.length > 0 ? colors[0].name : "Unknown";
  }

  
  window.setup = function () {
    var dims = getResponsiveCanvasSize();
    canvasEl = createCanvas(dims.cw, dims.ch);
    canvasEl.parent("app");
    setupApp();
    makeButtons();
    initTouchUI();
    initCameraSwitchButton();
  };

  
  function getResponsiveCanvasSize() {
    var maxW, maxH;
    if (windowWidth <= 600) {
       maxW = windowWidth - 8;
      maxH = Math.min(windowHeight - 80, Math.floor(maxW * 0.75));
    } else if (windowWidth <= 1024) {
       maxW = Math.min(windowWidth - 20, 900);
      maxH = Math.min(windowHeight - 90, Math.floor(maxW * 0.65));
    } else {
       maxW = Math.min(windowWidth - 32, 1100);
      maxH = Math.min(windowHeight - 110, Math.floor(maxW * 0.58));
    }
    return { cw: maxW, ch: maxH };
  }

  window.windowResized = function () {
    var dims = getResponsiveCanvasSize();
    resizeCanvas(dims.cw, dims.ch);
  };

   function initCameraSwitchButton() {
    var btn = document.getElementById("camera-switch-btn");
    if (!btn) return;

     var checkInterval = setInterval(function () {
      if (cam && cam.hasMultipleCameras()) {
        btn.classList.add("visible");
        btn.dataset.multiCam = "true";
        clearInterval(checkInterval);
      }
    }, 500);

     setTimeout(function () { clearInterval(checkInterval); }, 4000);

    btn.addEventListener("click", function () {
      if (cam) {
        cam.switchCamera();
         btn.style.transform = "scale(0.9) rotate(180deg)";
        setTimeout(function () { btn.style.transform = ""; }, 300);
      }
    });
  }

  
  window.keyPressed = function () {
    if (key === "r" || key === "R") resetToLive();

    if (key === "f" || key === "F") {
      if (touchUI && touchUI.getState() === "ARRANGING") {
         performCapture();
      } else if (!touchUI) {
        harmonyResult    = null;
        shapeClassResult = null;
        geoHarmonyResult = null;
        diagnosisResult  = null;
        chromaticResult  = null;
        interpretResult  = null;

        if (cam.ready) {
          pre.update(cam.getFrame());
          var shapes = detector.detect(pre.getBinaryMask());
          colorer.update(cam.getFrame(), shapes, detector.getLabelMap(), pre.getWidth(), pre.getHeight());
          stable.forceFreeze(cam.getFrame(), shapes, pre.getBinaryImage());
        }
      }
    }

    if (key === "d" || key === "D") debugEnabled = !debugEnabled;
  };

   
  window.draw = function () {
    updateButtonsPositionAndVisibility();
    cam.update();

     background(C.bg[0], C.bg[1], C.bg[2]);

    var margin = width <= 500 ? 6 : (width <= 800 ? 12 : 20);
    var topY   = width <= 500 ? 36 : 54;
    var isNarrow = width < 680;

    var left, right;

    if (isNarrow) {
       var feedH = Math.floor((height - topY - 16) * 0.55);
      var gap   = 8;
      left  = { x: margin, y: topY, w: width - margin * 2, h: feedH };
      right = { x: margin, y: topY + feedH + gap, w: width - margin * 2, h: height - topY - feedH - gap - 8 };
    } else {
       var leftW  = Math.floor(width * 0.52);
      var gap    = 14;
      left  = { x: margin, y: topY, w: leftW, h: height - topY - 16 };
      right = {
        x: left.x + left.w + gap,
        y: topY,
        w: width - (left.x + left.w + gap) - margin,
        h: left.h,
      };
    }

     if (cam.ready) {
      drawLiveVideoPanel(left);
    } else {
      drawPanel(left.x, left.y, left.w, left.h, "Live Feed");
      fill(C.textMuted[0], C.textMuted[1], C.textMuted[2]);
      textAlign(CENTER, CENTER);
      textSize(13);
      text("Waiting for webcam permission\u2026", left.x + left.w / 2, left.y + left.h / 2);
    }

    var state = stable.getState();

     if (cam.ready && state !== "RESULT") {
      pre.update(cam.getFrame());
      var shapes = detector.detect(pre.getBinaryMask());
      colorer.update(cam.getFrame(), shapes, detector.getLabelMap(), pre.getWidth(), pre.getHeight());
      lastLiveShapes = shapes;
       if (!touchUI) {
        stable.update(cam.getFrame(), cam.getPrevFrame(), shapes, pre.getBinaryImage());
      }
    }

     if (state === "RESULT") {
      var snap          = stable.getSnapshotFrame();
      var snapBin       = stable.getSnapshotBinary();
      var frozenShapes  = stable.getSnapshotShapes();
      var frozenPalette = stable.getSnapshotPalette();

      if (!harmonyResult && stable.consumeFrozenEvent()) {
         harmonyResult = scorer.compute({
          shapes: frozenShapes,
          paletteDist: frozenPalette,
          binarySnapshot: snapBin,
          wSmall: pre.getWidth(),
          hSmall: pre.getHeight(),
        });

         shapeClassResult = shapeClassifier.classify(frozenShapes);

         var symmetry01 = (harmonyResult.symmetryOnlyScore || 0) / 100;
        geoHarmonyResult = geoHarmonyScorer.compute(
          symmetry01,
          shapeClassResult.distribution,
          shapeClassResult.totalClassified
        );

         diagnosisResult = diagnosis.generate({
          symmetryPercent: harmonyResult.symmetryOnlyScore,
          shapeData:       shapeClassResult,
          harmonyScore:    geoHarmonyResult.score,
          harmonyLabel:    geoHarmonyResult.label,
        });

         chromaticResult = chromaticCtx.getContext(frozenPalette, frozenShapes);

         interpretResult = interpreter.generate({
          scores:     harmonyResult,
          shapes:     frozenShapes,
          paletteDist: frozenPalette,
          wSmall:     pre.getWidth(),
          hSmall:     pre.getHeight(),
        });
      }

       resultsView.render({
        snapshotFrame:      snap,
        detection: {
          dominantShape:    shapeClassResult  ? shapeClassResult.dominantShape  : "—",
          symmetryPercent:  harmonyResult     ? harmonyResult.symmetryOnlyScore : 0,
          dominantColor:    getDominantColorName(frozenPalette),
        },
        geometricalHarmony: geoHarmonyResult || {},
        shapeDistribution:  shapeClassResult ? shapeClassResult.distribution : {},
        diagnosis:          diagnosisResult  || {},
        chromaticContext:    chromaticResult  || {},
        paletteDist:        frozenPalette,
        timestampText:      formatTimestamp(stable.getSnapshotTimeMs()),
      });

      var layout = resultsView.getLayout();
      drawRightPanelFromPrintView(
        right,
        { x: layout.rightX, y: layout.rightY, w: layout.rightW, h: layout.rightH }
      );
    } else {
      drawLiveRightPlaceholder(right);
    }

 noStroke();
fill(0);
textAlign(LEFT, CENTER);

var titleSize = width <= 500 ? 11 : 15;
textSize(titleSize);
textStyle(BOLD);

text("The Geometry of Us", margin, width <= 500 ? 12 : 20);
textStyle(NORMAL);

stroke(0, 40);
strokeWeight(1);
line(margin, width <= 500 ? 24 : 36, width - margin, width <= 500 ? 24 : 36);
noStroke();
  };
})();
