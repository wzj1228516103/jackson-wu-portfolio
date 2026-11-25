const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
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

  const verification = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const selector = "#" + container.id;
  let cancel;
  let widgetId;
  container.hidden = false;
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new Error("Visitor verification did not complete"));
      const widgetError = code => {
        if (/^\d{6}$/.test(String(code))) console.warn("Portfolio visitor verification: Turnstile error " + code);
        fail();
        return true;
      };
      cancel = () => reject(verification.reason);
      verification.addEventListener("abort", cancel, { once: true });
      widgetId = turnstile.render(selector, {
        sitekey,
        language: language.toLowerCase(),
        action: "portfolio_chat",
        execution: "execute",
        appearance: "interaction-only",
        size: container.parentElement.clientWidth < 300 ? "compact" : "normal",
        theme: "dark",
        retry: "never",
        "response-field": false,
        callback: resolve,
        "error-callback": widgetError,
        "expired-callback": fail,
        "timeout-callback": fail
      });
      turnstile.execute(selector);
    });
  } finally {
    verification.removeEventListener("abort", cancel);
    container.hidden = true;
    if (widgetId) turnstile.remove(widgetId);
  }
}
