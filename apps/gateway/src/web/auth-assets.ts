export const authStyles = `
:root{color-scheme:dark;--bg:#0b0d0c;--panel:#111412;--panel-raised:#171b18;--line:#282e2a;--line-strong:#39423c;--text:#f1f5f2;--muted:#98a39c;--subtle:#707b74;--accent:#b8f36a;--accent-strong:#96d84b;--accent-ink:#10150d;--danger:#ff8b82;--focus:#8fd7ff;--radius:12px;--shadow:0 28px 90px rgba(0,0,0,.42);font-family:"SF Pro Text","Segoe UI Variable","Segoe UI",system-ui,sans-serif;font-synthesis:none}
*{box-sizing:border-box}html{min-height:100%;background:var(--bg)}body{min-height:100vh;margin:0;background:radial-gradient(circle at 18% 12%,rgba(184,243,106,.08),transparent 28rem),linear-gradient(180deg,#0c0f0d 0%,#090b0a 100%);color:var(--text)}button,input{font:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.62}a{color:inherit}.auth-frame{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(360px,.72fr);width:min(1180px,calc(100% - 48px));min-height:calc(100vh - 48px);margin:24px auto;border:1px solid var(--line);border-radius:18px;background:rgba(13,16,14,.88);box-shadow:var(--shadow);overflow:hidden}.auth-context{display:flex;flex-direction:column;min-height:680px;padding:42px 48px;border-right:1px solid var(--line);background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:32px 32px}.brand{display:inline-flex;align-items:center;gap:11px;width:max-content;color:var(--text);font-size:15px;font-weight:720;letter-spacing:-.02em;text-decoration:none}.brand-mark{display:grid;width:32px;height:32px;place-items:center;border-radius:9px;background:var(--accent);color:var(--accent-ink);font-size:14px;font-weight:850}.context-copy{margin:auto 0;max-width:620px}.context-label,.auth-kicker{margin:0 0 16px;color:var(--accent);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.context-copy h1{max-width:640px;margin:0;font-size:clamp(46px,6vw,82px);font-weight:610;letter-spacing:-.065em;line-height:.96}.context-copy>p:last-child{max-width:560px;margin:28px 0 0;color:var(--muted);font-size:17px;line-height:1.65}.context-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin:0;border:1px solid var(--line);border-radius:10px;background:var(--line);overflow:hidden}.context-facts div{padding:16px;background:#0e110f}.context-facts dt{color:var(--subtle);font-size:11px}.context-facts dd{margin:5px 0 0;color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.auth-card{display:flex;flex-direction:column;justify-content:center;padding:54px clamp(30px,5vw,64px);background:rgba(17,20,18,.92)}.auth-heading h2{margin:0;font-size:30px;letter-spacing:-.045em}.auth-heading>p:last-child{margin:10px 0 0;color:var(--muted);font-size:14px}.provider-options{display:grid;gap:10px;margin-top:32px}.provider-button{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:0 16px;border:1px solid var(--line-strong);border-radius:10px;background:var(--panel-raised);color:var(--text);font-weight:680;text-align:left;transition:border-color .18s ease,background .18s ease,transform .18s ease}.provider-button:hover{border-color:#566159;background:#1b201d}.provider-button:active{transform:translateY(1px)}.provider-button:focus-visible,.text-button:focus-visible,.back-button:focus-visible,.primary-button:focus-visible,input:focus-visible{outline:2px solid var(--focus);outline-offset:2px}.provider-mark{display:grid;width:28px;height:28px;place-items:center;border:1px solid var(--line-strong);border-radius:7px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:800}.github .provider-mark{border-color:#566159;background:#e8efea;color:#101310}.email-panel{margin-top:26px}.back-button{display:inline-flex;align-items:center;gap:7px;padding:0;border:0;background:transparent;color:var(--muted);font-size:12px}.back-button:hover{color:var(--text)}.email-heading{margin:28px 0 22px}.email-heading h3{margin:0;font-size:22px;letter-spacing:-.03em}.email-heading p{margin:6px 0 0;color:var(--muted);font-size:13px}.field{display:grid;gap:8px;margin-top:16px}.field label{font-size:12px;font-weight:680}.field-label-row{display:flex;align-items:center;justify-content:space-between;gap:16px}input{width:100%;height:46px;padding:0 13px;border:1px solid var(--line-strong);border-radius:9px;background:#0d100e;color:var(--text);outline:none}input:hover{border-color:#566159}input::placeholder{color:#68726b}.primary-button{width:100%;height:48px;margin-top:20px;border:0;border-radius:9px;background:var(--accent);color:var(--accent-ink);font-weight:800;transition:background .18s ease,transform .18s ease}.primary-button:hover{background:var(--accent-strong)}.primary-button:active{transform:translateY(1px)}.text-button{padding:0;border:0;background:transparent;color:var(--muted);font-size:12px}.text-button:hover{color:var(--text)}.text-button.strong{color:var(--accent)}.form-message{min-height:20px;margin:14px 0 -4px;color:var(--danger);font-size:12px;line-height:1.5}.form-message[data-kind="success"]{color:var(--accent)}.account-switch{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:20px;color:var(--muted);font-size:12px}.security-note{margin:30px 0 0;padding-top:20px;border-top:1px solid var(--line);color:var(--subtle);font-size:11px;line-height:1.55}[hidden]{display:none!important}@media(max-width:860px){.auth-frame{grid-template-columns:1fr;width:min(620px,calc(100% - 24px));min-height:auto;margin:12px}.auth-context{min-height:auto;padding:28px;border-right:0;border-bottom:1px solid var(--line)}.context-copy{margin:64px 0}.context-copy h1{font-size:clamp(42px,11vw,64px)}.context-copy>p:last-child{font-size:15px}.context-facts{grid-template-columns:1fr}.auth-card{padding:38px 28px 44px}}@media(max-width:460px){.auth-frame{width:100%;margin:0;border:0;border-radius:0}.auth-context{padding:24px 20px 34px}.context-copy{margin:48px 0}.context-copy h1{font-size:42px}.auth-card{padding:32px 20px 40px}.auth-heading h2{font-size:27px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important}}
`;

export const authScript = `
(() => {
  const body = document.body;
  const returnTo = body?.dataset.returnTo || "/dashboard";
  const required = (selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) throw new Error("Missing authentication UI");
    return element;
  };
  const options = required("#provider-options");
  const emailButton = required("#email-button");
  const githubButton = required("#github-button");
  const panel = required("#email-panel");
  const backButton = required("#back-button");
  const form = required("#email-form");
  const nameField = required("#name-field");
  const nameInput = required("#name");
  const emailInput = required("#email");
  const passwordInput = required("#password");
  const submitButton = required("#email-submit");
  const message = required("#form-message");
  const title = required("#email-title");
  const subtitle = required("#email-subtitle");
  const modeHint = required("#mode-hint");
  const modeButton = required("#mode-button");
  const forgotButton = required("#forgot-button");
  let mode = "signin";
  let busy = false;

  const setMessage = (value, kind = "error") => {
    message.textContent = value;
    message.dataset.kind = kind;
  };
  const setBusy = (value) => {
    busy = value;
    githubButton.disabled = value;
    submitButton.disabled = value;
    modeButton.disabled = value;
    forgotButton.disabled = value;
  };
  const setMode = (next) => {
    mode = next;
    const signup = mode === "signup";
    title.textContent = signup ? "Create your account" : "Email and password";
    subtitle.textContent = signup ? "Start with a private team of one." : "Use your account credentials.";
    nameField.hidden = !signup;
    nameInput.required = signup;
    submitButton.textContent = signup ? "Create account" : "Continue";
    passwordInput.autocomplete = signup ? "new-password" : "current-password";
    modeHint.textContent = signup ? "Already have an account?" : "New to Artifact Sync?";
    modeButton.textContent = signup ? "Sign in" : "Create account";
    forgotButton.hidden = signup;
    setMessage("");
  };
  const showEmail = () => {
    options.hidden = true;
    panel.hidden = false;
    emailButton.setAttribute("aria-expanded", "true");
    emailInput.focus();
  };
  const showProviders = () => {
    panel.hidden = true;
    options.hidden = false;
    emailButton.setAttribute("aria-expanded", "false");
    githubButton.focus();
  };
  const parseResponse = async (response) => {
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "Authentication could not be completed.");
    return data;
  };

  emailButton.addEventListener("click", showEmail);
  backButton.addEventListener("click", showProviders);
  modeButton.addEventListener("click", () => setMode(mode === "signin" ? "signup" : "signin"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    const payload = {
      email: emailInput.value.trim(),
      password: passwordInput.value,
      callbackURL: returnTo,
    };
    if (mode === "signup") payload.name = nameInput.value.trim();
    try {
      const response = await fetch("/__api/auth/" + (mode === "signup" ? "sign-up/email" : "sign-in/email"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseResponse(response);
      if (mode === "signup" && !data.token) {
        setMessage("Check your inbox to verify the account, then return to sign in.", "success");
        form.reset();
        return;
      }
      location.assign(returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication could not be completed.");
    } finally {
      setBusy(false);
    }
  });

  githubButton.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/__api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "github", callbackURL: returnTo }),
      });
      const data = await parseResponse(response);
      if (!data.url) throw new Error("GitHub sign-in is unavailable.");
      location.assign(data.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitHub sign-in is unavailable.");
      setBusy(false);
    }
  });

  forgotButton.addEventListener("click", async () => {
    if (busy) return;
    const email = emailInput.value.trim();
    if (!email) {
      setMessage("Enter your email address first.");
      emailInput.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/__api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo: returnTo }),
      });
      if (!response.ok) throw new Error("Password reset could not be requested.");
      setMessage("If the account exists, a password-reset link is on its way.", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Password reset could not be requested.");
    } finally {
      setBusy(false);
    }
  });
})();
`;
