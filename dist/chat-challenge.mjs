const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(signal) {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      script.onload = script.onerror = null;
      if (!signal.aborted && window.turnstile) {
        resolve(window.turnstile);
      } else {
        script.remove();
        reject(signal.reason ?? new Error("Visitor verification unavailable"));
      }
    }

    const timer = setTimeout(finish, 10_000);
    script.onload = script.onerror = finish;
    signal.addEventListener("abort", finish, { once: true });
    document.head.append(script);
  });
}

export async function getChallengeToken(container, sitekey, language, signal) {
  signal.throwIfAborted();
  const turnstile = await loadTurnstile(signal);
  signal.throwIfAborted();

  const verification = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const selector = "#" + container.id;
  let cancel;
  let widgetId;
  container.hidden = false;
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new Error("Visitor verification did not complete"));
      cancel = () => reject(verification.reason);
      verification.addEventListener("abort", cancel, { once: true });
      widgetId = turnstile.render(selector, {
        sitekey,
        language,
        action: "portfolio_chat",
        execution: "execute",
        appearance: "interaction-only",
        size: container.parentElement.clientWidth < 300 ? "compact" : "normal",
        theme: "dark",
        retry: "never",
        "response-field": false,
        callback: resolve,
        "error-callback": fail,
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
