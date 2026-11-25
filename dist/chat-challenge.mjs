const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const retryableChallengeErrors = new Set(["110600", "200500"]);
let scriptAttempt = 0;
let turnstileLoad;

function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    const readyCallback = "portfolioTurnstileReady" + ++scriptAttempt;
    const script = document.createElement("script");
    script.src = scriptUrl + "&onload=" + readyCallback;
    script.async = true;
    let settled = false;

    function finish(turnstile, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete window[readyCallback];
      script.onerror = null;
      if (turnstile) {
        resolve(turnstile);
      } else {
        script.remove();
        reject(error);
      }
    }

    function fail(message) {
      if (settled) return;
      console.warn("Portfolio visitor verification:", message);
      finish(null, new Error(message));
    }

    const timer = setTimeout(() => fail("Turnstile script did not become ready."), 20_000);
    window[readyCallback] = () => {
      const turnstile = window.turnstile;
      if (typeof turnstile?.render === "function") finish(turnstile);
      else fail("Turnstile API is unavailable after initialization.");
    };
    script.onerror = () => fail("Turnstile script could not load.");
    document.head.append(script);
  });
}

async function waitForTurnstile(signal) {
  signal.throwIfAborted();
  turnstileLoad ??= loadTurnstileScript().catch(error => {
    turnstileLoad = undefined;
    throw error;
  });

  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([turnstileLoad, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function getChallengeToken(container, sitekey, language, signal) {
  const turnstile = await waitForTurnstile(signal);
  signal.throwIfAborted();

  const selector = "#" + container.id;
  let deadline;
  let cancel;
  let widgetId;
  container.hidden = false;
  try {
    return await new Promise((resolve, reject) => {
      let retried = false;
      let interactive = false;

      function schedule(delay, callback) {
        clearTimeout(deadline);
        deadline = setTimeout(callback, delay);
      }

      function fail(message) {
        console.warn("Portfolio visitor verification:", message);
        reject(new Error(message));
      }

      function retryBackgroundCheck() {
        if (retried || interactive || !widgetId) {
          fail("Turnstile challenge timed out.");
          return;
        }
        retried = true;
        schedule(30_000, retryBackgroundCheck);
        try {
          turnstile.reset(widgetId);
        } catch (error) {
          reject(error);
        }
      }

      const widgetError = code => {
        const errorCode = String(code);
        if (!retried && !interactive && retryableChallengeErrors.has(errorCode)) {
          schedule(1500, retryBackgroundCheck);
        } else {
          fail(/^\d{6}$/.test(errorCode) ? "Turnstile error " + errorCode : "Turnstile challenge failed.");
        }
        return true;
      };
      cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
      schedule(30_000, retryBackgroundCheck);
      widgetId = turnstile.render(selector, {
        sitekey,
        language: language.toLowerCase(),
        action: "portfolio_chat",
        appearance: "execute",
        size: container.parentElement.clientWidth < 300 ? "compact" : "normal",
        theme: "dark",
        retry: "never",
        "response-field": false,
        callback: resolve,
        "before-interactive-callback": () => {
          interactive = true;
          schedule(90_000, () => fail("Turnstile interactive challenge timed out."));
        },
        "error-callback": widgetError,
        "expired-callback": () => fail("Turnstile challenge expired."),
        "timeout-callback": () => fail("Turnstile interactive challenge timed out."),
        "unsupported-callback": () => fail("Turnstile does not support this browser.")
      });
    });
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", cancel);
    container.hidden = true;
    if (widgetId) turnstile.remove(widgetId);
  }
}
