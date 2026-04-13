(function () {
  "use strict";

  const Utils = {
    clamp(n, min, max) {
      return Math.max(min, Math.min(max, n));
    },

    assert(condition, message) {
      if (!condition) throw new Error(message || "Assertion failed");
    },
  };

  window.App = window.App || {};
  window.App.Utils = Utils;
})();
