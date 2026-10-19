/**
 * Safe areas for the iPhone "Add to Home Screen" app.
 *
 * Installed web apps on iOS 26 draw the page under the status bar and blur the
 * top edge. Normally env(safe-area-inset-top) tells us how much room to leave,
 * but some iOS 26 releases report 0 there (WebKit bug 301994), so the top bar
 * ends up under the blur. This measures the real inset, falls back to a safe
 * status-bar height when iOS reports 0 while the page covers the whole screen,
 * and adds a little clearance for the blur. The result goes into --safe-top /
 * --safe-bottom, which the stylesheet uses instead of raw env() values.
 */

const STATUS_BAR_FALLBACK = 54; // covers notch and Dynamic Island iPhones
// The iOS 26 blur reaches well below the status bar: on a Dynamic Island iPhone it
// fades out about 100pt from the top, so start content below that.
const BLUR_CLEARANCE = 36;
const HOME_INDICATOR_FALLBACK = 21;

function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true
  );
}

function measureEnv(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  return { top, bottom };
}

function apply() {
  const root = document.documentElement;
  const { top, bottom } = measureEnv();
  if (!isStandalone()) {
    root.style.removeProperty('--safe-top');
    root.style.removeProperty('--safe-bottom');
    root.classList.remove('standalone');
    return;
  }
  root.classList.add('standalone');
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  // Does the page reach the very top of the screen (i.e. sit under the status bar)?
  const coversScreen = Math.abs(window.innerHeight - window.screen.height) < 2 || window.innerHeight > window.screen.height - 20;
  const portrait = window.innerHeight >= window.innerWidth;
  let safeTop = top;
  let safeBottom = bottom;
  if (isIOS && coversScreen && portrait) {
    if (safeTop < 20) safeTop = STATUS_BAR_FALLBACK;
    if (safeBottom < 10 && window.screen.height >= 812) safeBottom = HOME_INDICATOR_FALLBACK;
  }
  root.style.setProperty('--safe-top', `${safeTop + (safeTop > 0 ? BLUR_CLEARANCE : 0)}px`);
  root.style.setProperty('--safe-bottom', `${safeBottom}px`);
}

export function installSafeAreas() {
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 150));
  // iOS settles the viewport a moment after launch
  setTimeout(apply, 300);
}
