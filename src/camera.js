(function () {
  "use strict";

  class CameraManager {
    /*
      CameraManager
      - Purpose: Initialize and manage the webcam feed, and keep both the current frame and the previous frame.
      - Key idea: Every update() copies the current frame into prevFrame, then captures a new current frame into frame.
      - Important vars:
        - width/height: capture resolution (kept consistent across video + graphics buffers)
        - mirror: if true, horizontally flips the feed (more natural for users)
        - frame: current frame buffer (p5.Graphics)
        - prevFrame: previous frame buffer (p5.Graphics) used for motion/stability comparisons
        - ready: set true when webcam is available
        - facingMode: "user" (front) or "environment" (back)
        - _availableCameras: list of detected video input devices
    */
    constructor(options = {}) {
      const { width = 640, height = 480, mirror = true } = options;

      this.w = width;
      this.h = height;
      this.mirror = mirror;

      this.video = null;
      this.frame = null;
      this.prevFrame = null;

      this.ready = false;
      this._lastUpdateMs = 0;

      /* Camera switching support */
      this.facingMode = "user";         // "user" = front, "environment" = back
      this._availableCameras = [];
      this._currentDeviceIndex = 0;
      this._hasMultipleCameras = false;
    }

    /*
      init()
      - Sets up the webcam capture and two offscreen buffers.
      - Enumerates available cameras so switchCamera() can cycle.
    */
    init() {
      pixelDensity(1);

      this.frame = createGraphics(this.w, this.h);
      this.prevFrame = createGraphics(this.w, this.h);

      this.frame.pixelDensity(1);
      this.prevFrame.pixelDensity(1);

      this.frame.background(0);
      this.prevFrame.background(0);

      /* Enumerate cameras then start the default one */
      this._enumerateCameras().then(() => {
        this._startCamera();
      });
    }

    /*
      _enumerateCameras()
      - Lists available video input devices (front/back camera).
    */
    async _enumerateCameras() {
      try {
        /* Need initial permission for enumerateDevices to return labels */
        await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const devices = await navigator.mediaDevices.enumerateDevices();
        this._availableCameras = devices.filter(d => d.kind === "videoinput");
        this._hasMultipleCameras = this._availableCameras.length > 1;
      } catch (e) {
        this._availableCameras = [];
        this._hasMultipleCameras = false;
      }
    }

    /*
      _startCamera()
      - Stops any existing video and creates a new capture with current facingMode.
    */
    _startCamera() {
      this.ready = false;

      /* Stop existing tracks */
      if (this.video && this.video.elt && this.video.elt.srcObject) {
        this.video.elt.srcObject.getTracks().forEach(t => t.stop());
        this.video.remove();
        this.video = null;
      }

      const constraints = {
        audio: false,
        video: {
          width:  { ideal: this.w },
          height: { ideal: this.h },
          facingMode: { ideal: this.facingMode },
        },
      };

      this.video = createCapture(constraints, () => {
        this.ready = true;
      });

      this.video.size(this.w, this.h);
      this.video.hide();
    }

    /*
      switchCamera()
      - Toggles between front ("user") and back ("environment") camera.
      - On desktops with only one camera this is a no-op.
      - Returns true if a switch was initiated.
    */
    switchCamera() {
      if (!this._hasMultipleCameras) return false;

      this.facingMode = this.facingMode === "user" ? "environment" : "user";
      /* When switching to back camera, don't mirror; front camera mirrors */
      this.mirror = this.facingMode === "user";

      this._startCamera();
      return true;
    }

    /*
      hasMultipleCameras()
      - Returns whether the device has more than one camera.
    */
    hasMultipleCameras() {
      return this._hasMultipleCameras;
    }

    /*
      getFacingMode()
      - Returns current facing mode: "user" or "environment".
    */
    getFacingMode() {
      return this.facingMode;
    }

    /*
      update()
      - Refreshes the internal buffers:
        1) prevFrame gets the old frame
        2) frame captures the new webcam image (optionally mirrored)
      - This ordering is important for later modules that compare "current vs previous".
    */
    update() {
      if (!this.video || !this.ready) return;

      this.prevFrame.image(this.frame, 0, 0);

      this.frame.push();
      if (this.mirror) {
        this.frame.translate(this.w, 0);
        this.frame.scale(-1, 1);
      }
      this.frame.image(this.video, 0, 0, this.w, this.h);
      this.frame.pop();

      this._lastUpdateMs = Date.now();
    }

    /*
      getFrame()
      - Returns the current frame buffer (p5.Graphics).
      - Typically used as the input for preprocessing / detection.
    */
    getFrame() {
      return this.frame;
    }

    /*
      getPrevFrame()
      - Returns the previous frame buffer (p5.Graphics).
      - Useful for stability/motion checks (frame differencing).
    */
    getPrevFrame() {
      return this.prevFrame;
    }

    /*
      drawToCanvas(x, y, dw, dh)
      - Draws the current frame onto the main p5 canvas.
      - This keeps camera rendering separate from the analysis pipeline.
    */
    drawToCanvas(x, y, dw, dh) {
      if (!this.frame) return;
      image(this.frame, x, y, dw, dh);
    }
  }

  window.App = window.App || {};
  window.App.CameraManager = CameraManager;
})();
