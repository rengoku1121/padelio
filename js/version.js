(function () {
  'use strict';

  /** Locked release — change only with an explicit product decision. */
  var PADELIO_VERSION = '1.6.16';

  window.PADELIO_VERSION = PADELIO_VERSION;

  function applyVersionLabels() {
    var versionLine = 'Version ' + PADELIO_VERSION;
    var whatsNewLine = 'What\u2019s new in ' + PADELIO_VERSION;
    var ids = ['app-version', 'about-app-version', 'spa-about-version'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = versionLine;
    });
    var whatsNew = document.getElementById('whats-new-version');
    if (whatsNew) whatsNew.textContent = whatsNewLine;
  }

  window.padelioApplyVersionLabels = applyVersionLabels;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersionLabels);
  } else {
    applyVersionLabels();
  }
})();
