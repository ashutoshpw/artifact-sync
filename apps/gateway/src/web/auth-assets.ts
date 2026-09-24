export const authStyles = `
:root{
  color-scheme:dark;
  --bg:#0b0d0c;
  --panel:#111412;
  --panel-raised:#171b18;
  --well:#0d100e;
  --line:#272d29;
  --line-strong:#39423c;
  --line-hover:#5a665e;
  --text:#f1f5f2;
  --muted:#98a39c;
  --subtle:#7e8982;
  --accent:#b8f36a;
  --accent-strong:#96d84b;
  --accent-ink:#10150d;
  --danger:#ff8b82;
  --focus:#8fd7ff;
  --radius-frame:16px;
  --radius-card:12px;
  --radius-control:10px;
  --radius-mark:9px;
  --font-display:"SF Pro Display","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",system-ui,sans-serif;
  --font-sans:"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",system-ui,sans-serif;
  --font-mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --shadow-frame:0 30px 90px rgba(0,0,0,.45);
  --shadow-card:0 18px 50px rgba(0,0,0,.34);
  font-synthesis:none;
}
*,*::before,*::after{box-sizing:border-box}
html{min-height:100%;background:var(--bg)}
body{
  min-height:100vh;
  min-height:100dvh;
  margin:0;
  color:var(--text);
  font-family:var(--font-sans);
  background:
    radial-gradient(58rem 34rem at 10% -10%, rgba(184,243,106,.075), transparent 62%),
    radial-gradient(46rem 30rem at 106% 114%, rgba(184,243,106,.05), transparent 62%),
    linear-gradient(180deg,#0c0f0d 0%,#090b0a 100%);
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
}
::selection{background:rgba(184,243,106,.3)}
a{color:inherit}
button{font:inherit;cursor:pointer}
button:disabled{cursor:wait;opacity:.62}
input{font:inherit}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
[hidden]{display:none!important}

.page{display:grid;min-height:100vh;min-height:100dvh;padding:24px;place-items:center}

.frame{
  display:grid;
  grid-template-columns:minmax(0,1.14fr) minmax(380px,.86fr);
  width:min(1200px,100%);
  min-height:calc(100vh - 48px);
  min-height:calc(100dvh - 48px);
  position:relative;
  border:1px solid var(--line);
  border-radius:var(--radius-frame);
  background:rgba(13,16,14,.9);
  box-shadow:var(--shadow-frame);
  overflow:hidden;
}
.frame::before{
  content:"";
  position:absolute;
  inset:0 0 auto;
  height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.09),transparent);
  pointer-events:none;
  z-index:2;
}

.pane-context{
  position:relative;
  display:flex;
  flex-direction:column;
  gap:26px;
  padding:36px 42px 32px;
  border-right:1px solid var(--line);
  background-image:
    linear-gradient(rgba(255,255,255,.023) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.023) 1px,transparent 1px);
  background-size:34px 34px;
}
.pane-context::after{
  content:"";
  position:absolute;
  inset:0;
  background:radial-gradient(125% 95% at 28% 16%,transparent 34%,rgba(11,13,12,.7) 100%);
  pointer-events:none;
}
.pane-context > *{position:relative;z-index:1}

.context-top{display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:inline-flex;align-items:center;gap:11px;color:var(--text);font-size:15px;font-weight:720;letter-spacing:-.02em;text-decoration:none}
.brand-mark{
  display:grid;width:34px;height:34px;place-items:center;
  border-radius:var(--radius-mark);
  background:linear-gradient(180deg,#c9fa85,#a6e154);
  color:var(--accent-ink);
  font-size:15px;font-weight:850;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 8px 20px rgba(184,243,106,.16);
}
.context-nav{display:flex;gap:4px}
.nav-link{
  display:inline-flex;align-items:center;gap:6px;
  padding:7px 11px;border-radius:var(--radius-control);
  color:var(--muted);font-size:12.5px;font-weight:620;text-decoration:none;
  transition:color .18s ease,background .18s ease;
}
.nav-link:hover{color:var(--text);background:rgba(255,255,255,.05)}
.nav-link svg{opacity:.6;transition:opacity .18s ease,transform .18s ease}
.nav-link:hover svg{opacity:1;transform:translate(1px,-1px)}

.context-main{margin:auto 0;display:grid;gap:30px}
.eyebrow{
  justify-self:start;
  margin:0 0 18px;
  color:var(--accent);
  font-family:var(--font-mono);
  font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
}
.context-copy h1{
  margin:0;
  font-family:var(--font-display);
  font-size:clamp(42px,4.5vw,64px);
  font-weight:640;
  letter-spacing:-.05em;
  line-height:1.03;
  max-width:15ch;
}
.context-copy h1 em{font-style:italic;color:var(--accent);padding-right:.04em}
.lede{max-width:50ch;margin:22px 0 0;color:var(--muted);font-size:16.5px;line-height:1.62}

.terminal{
  margin:0;
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  background:linear-gradient(180deg,#0f1210,#0c0f0d);
  box-shadow:var(--shadow-card),inset 0 1px 0 rgba(255,255,255,.03);
  overflow:hidden;
}
.terminal-bar{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.018)}
.terminal-dots{display:flex;gap:6px}
.terminal-dots i{display:block;width:9px;height:9px;border-radius:50%;background:#333a35}
.terminal-title{color:var(--subtle);font-family:var(--font-mono);font-size:11px}
.terminal-body{padding:14px 16px 16px;font-family:var(--font-mono);font-size:12.5px;line-height:2;color:#c9d2cb;overflow-x:auto}
.tline{margin:0;white-space:nowrap;animation:lineIn .5s cubic-bezier(.16,1,.3,1) both;animation-delay:.32s}
.tline:nth-child(2){animation-delay:.41s}
.tline:nth-child(3){animation-delay:.5s}
.tline:nth-child(4){animation-delay:.59s}
.tline:nth-child(5){animation-delay:.68s}
.tline:nth-child(6){animation-delay:.77s}
.tline:nth-child(7){animation-delay:.86s}
.tline:nth-child(8){animation-delay:.95s}
.tline:nth-child(9){animation-delay:1.04s}
.tline + .tline{margin-top:1px}
.t-prompt{color:var(--accent);font-weight:700;user-select:none}
.t-cmd{color:var(--text)}
.t-dim{color:var(--subtle)}
.t-inline{display:flex;align-items:center;gap:8px}
.t-inline svg{flex:none}
.t-ok svg{color:var(--accent)}
.t-ok .t-strong{color:var(--text);font-weight:700}
.t-up svg{color:var(--accent-strong)}
.t-up .t-path{color:#d7e0d9}
.t-up .t-note{color:var(--subtle)}
.t-dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(184,243,106,.12);animation:pulse 2.4s ease-in-out infinite}
.t-cursor{display:inline-block;width:7px;height:14px;margin-left:7px;vertical-align:-2px;background:var(--accent);animation:blink 1.1s steps(2,start) infinite}

.facts{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:1px;
  margin:0;padding:0;list-style:none;
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  background:var(--line);
  overflow:hidden;
}
.facts li{display:grid;gap:7px;padding:13px 15px;background:#0e110f}
.fact-label{display:flex;align-items:center;gap:7px;color:var(--subtle);font-size:11px;font-weight:620;letter-spacing:.02em}
.fact-label svg{color:var(--accent);opacity:.75}
.fact-value{font-family:var(--font-mono);font-size:12.5px;color:var(--text)}

.pane-auth{
  display:flex;
  align-items:center;
  justify-content:center;
  padding:48px clamp(28px,4vw,56px);
  background:radial-gradient(30rem 22rem at 50% -4%,rgba(184,243,106,.05),transparent 66%),rgba(17,20,18,.92);
}
.auth-inner{width:100%;max-width:400px}
.auth-heading h2{margin:0;font-family:var(--font-display);font-size:30px;font-weight:660;letter-spacing:-.04em}
.auth-sub{margin:10px 0 0;color:var(--muted);font-size:14px}

.provider-options{display:grid;gap:10px;margin-top:30px}
.provider{
  display:grid;
  grid-template-columns:24px 1fr 24px;
  align-items:center;
  gap:10px;
  width:100%;
  min-height:52px;
  padding:0 15px;
  border-radius:var(--radius-control);
  font-size:14.5px;
  font-weight:660;
  text-align:center;
  transition:transform .18s cubic-bezier(.16,1,.3,1),background .18s ease,border-color .18s ease,box-shadow .18s ease;
}
.provider .p-icon{display:grid;place-items:center}
.provider:active{transform:translateY(1px) scale(.995)}
.provider:focus-visible,.text-button:focus-visible,.back-button:focus-visible,.primary-button:focus-visible,input:focus-visible,.nav-link:focus-visible,.brand:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.provider-github{border:1px solid #eef2ef;background:#f2f5f2;color:var(--accent-ink)}
.provider-github:hover{background:#fff;border-color:#fff;transform:translateY(-1px);box-shadow:0 12px 28px rgba(0,0,0,.36)}
.provider-email{border:1px solid var(--line-strong);background:var(--panel-raised);color:var(--text)}
.provider-email:hover{border-color:var(--line-hover);background:#1c211e;transform:translateY(-1px)}

.email-panel{margin-top:26px;padding-top:24px;border-top:1px solid var(--line);animation:panelIn .4s cubic-bezier(.16,1,.3,1) both}
.back-button{display:inline-flex;align-items:center;gap:7px;padding:0;border:0;background:transparent;color:var(--muted);font-size:12.5px;font-weight:620}
.back-button:hover{color:var(--text)}
.email-heading h3{margin:20px 0 0;font-size:19px;font-weight:680;letter-spacing:-.02em}
.email-heading p{margin:6px 0 0;color:var(--muted);font-size:13px}
.field{display:grid;gap:7px;margin-top:15px}
.field label{font-size:12.5px;font-weight:640}
.field-label-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
input{
  width:100%;height:46px;padding:0 13px;
  border:1px solid var(--line-strong);border-radius:var(--radius-control);
  background:var(--well);color:var(--text);
  transition:border-color .18s ease;
}
input:hover{border-color:var(--line-hover)}
input::placeholder{color:#68726b}
.primary-button{
  width:100%;height:48px;margin-top:20px;
  border:0;border-radius:var(--radius-control);
  background:var(--accent);color:var(--accent-ink);
  font-size:14.5px;font-weight:800;
  transition:background .18s ease,transform .18s cubic-bezier(.16,1,.3,1),box-shadow .18s ease;
}
.primary-button:hover{background:var(--accent-strong);transform:translateY(-1px);box-shadow:0 12px 26px rgba(184,243,106,.16)}
.primary-button:active{transform:translateY(1px) scale(.995)}
.text-button{padding:0;border:0;background:transparent;color:var(--muted);font-size:12.5px}
.text-button:hover{color:var(--text)}
.text-button.strong{color:var(--accent);font-weight:640}
.form-message{min-height:20px;margin:14px 0 -4px;color:var(--danger);font-size:12px;line-height:1.5}
.form-message[data-kind="success"]{color:var(--accent)}
.account-switch{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:20px;color:var(--muted);font-size:12.5px}
.security-note{
  display:flex;align-items:flex-start;gap:9px;
  margin:26px 0 0;padding-top:18px;border-top:1px solid var(--line);
  color:var(--subtle);font-size:11.5px;line-height:1.6;
}
.security-note svg{flex:none;margin-top:1px}

.context-top,.context-copy,.terminal,.facts,.auth-inner{animation:rise .7s cubic-bezier(.16,1,.3,1) both}
.context-copy{animation-delay:.06s}
.terminal{animation-delay:.14s}
.facts{animation-delay:.2s}
.auth-inner{animation-delay:.1s}

@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes lineIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes panelIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}

@media (max-width:1020px){
  .frame{grid-template-columns:1fr;min-height:auto}
  .pane-context{border-right:0;border-bottom:1px solid var(--line);padding:28px 28px 26px;gap:24px}
  .context-main{margin:10px 0 0}
  .context-copy h1{font-size:clamp(38px,7vw,54px)}
  .pane-auth{padding:42px 28px 50px}
}
@media (max-width:620px){
  .page{padding:12px}
  .frame{border-radius:14px}
  .context-nav{display:none}
  .context-copy h1{font-size:clamp(34px,10.5vw,44px);max-width:12ch}
  .lede{font-size:15px}
  .facts{grid-template-columns:1fr}
  .terminal-body{font-size:11.5px}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
  .tline,.context-top,.context-copy,.terminal,.facts,.auth-inner,.email-panel{opacity:1;transform:none}
}
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
