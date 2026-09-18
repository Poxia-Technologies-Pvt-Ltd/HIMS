// Extracted from index.html so script-src doesn't need 'unsafe-inline' — a
// strict CSP (VAPT #22) can't allowlist an inline <script> block, only
// same-origin files and specific external hosts.
function googleTranslateElementInit() {
  new google.translate.TranslateElement({
    pageLanguage: 'en',
    autoDisplay: false
  }, 'google_translate_element');
}
