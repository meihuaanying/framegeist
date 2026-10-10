// Single source of truth for the app version.
//
// v1.5.0 audit: `app.js` and `sw.js` each hardcoded the version ("1.4.0" and
// "framegeist-1.4.0"). They are the two halves of the same fact -- the UI shows
// APP_VERSION in Settings/About, the service worker names its cache bucket after
// VERSION -- so a release that bumped one but not the other left the app
// reporting a version whose cache was never rotated (or the reverse, purging a
// cache that still matched). Keeping the literal here means one edit per
// release.
//
// This file is a classic script on purpose: the service worker cannot import an
// ES module (`sw.js` is registered without `{type:"module"}`), so it reaches the
// value through `importScripts`, while `app.js` reaches the same global through a
// side-effect import.
self.FG_VERSION = "1.4.0";