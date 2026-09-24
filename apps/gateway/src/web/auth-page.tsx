import type { FC } from "hono/jsx";

export interface AuthPageProps {
  returnTo: string;
}

export const AuthPage: FC<AuthPageProps> = ({ returnTo }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="color-scheme" content="dark" />
      <meta name="theme-color" content="#0b0d0c" />
      <meta
        name="description"
        content="Artifact Sync connects trusted devices, publishes team-scoped artifacts, and keeps every credential visible from one place."
      />
      <title>Sign in · Artifact Sync</title>
      <link
        rel="icon"
        href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%23b8f36a'/%3E%3Ctext x='16' y='22.5' font-family='system-ui,sans-serif' font-size='18' font-weight='800' text-anchor='middle' fill='%2310150d'%3EA%3C/text%3E%3C/svg%3E"
      />
      <link rel="stylesheet" href="/assets/auth.css" />
      <script src="/assets/auth.js" defer />
    </head>
    <body data-return-to={returnTo}>
      <main class="page">
        <section class="frame">
          <section class="pane-context" aria-labelledby="product-title">
            <header class="context-top">
              <a class="brand" href="/" aria-label="Artifact Sync home">
                <span class="brand-mark" aria-hidden="true">A</span>
                <span>Artifact Sync</span>
              </a>
              <nav class="context-nav" aria-label="Product">
                <a class="nav-link" href="https://github.com/ashutoshpw/artifact-sync/tree/main/docs" target="_blank" rel="noreferrer">
                  Docs
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17 7 7 17" />
                    <path d="M8 7h9v9" />
                  </svg>
                </a>
                <a class="nav-link" href="https://github.com/ashutoshpw/artifact-sync" target="_blank" rel="noreferrer">
                  GitHub
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17 7 7 17" />
                    <path d="M8 7h9v9" />
                  </svg>
                </a>
              </nav>
            </header>

            <div class="context-main">
              <div class="context-copy">
                <p class="eyebrow">Private artifact control</p>
                <h1 id="product-title">Your files, one <em>calm</em> workspace.</h1>
                <p class="lede">Connect trusted devices, publish team-scoped artifacts, and keep every credential visible from one place.</p>
              </div>

              <figure class="terminal">
                <div class="terminal-bar" aria-hidden="true">
                  <span class="terminal-dots"><i></i><i></i><i></i></span>
                  <span class="terminal-title">artifact-sync</span>
                </div>
                <figcaption class="sr-only">Example terminal session: signing in with artifact-sync login and starting the sync daemon.</figcaption>
                <div class="terminal-body">
                  <p class="tline"><span class="t-prompt">$</span> <span class="t-cmd">artifact-sync login</span></p>
                  <p class="tline t-dim">Destination server: https://artifact.w3dev.app</p>
                  <p class="tline t-dim">Device code: K4T9-QX2M · approve this device in your browser</p>
                  <p class="tline t-inline t-ok">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="m5 12 5 5 10-10" />
                    </svg>
                    <span>Authenticated <span class="t-strong">Ashutosh</span> for team <span class="t-strong">w3dev</span></span>
                  </p>
                  <p class="tline"><span class="t-prompt">$</span> <span class="t-cmd">artifact-sync daemon</span></p>
                  <p class="tline t-dim">INFO daemon started · root=~/.agents/artifacts</p>
                  <p class="tline t-inline t-up">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 5v14" />
                      <path d="m18 11-6-6" />
                      <path d="m6 11 6-6" />
                    </svg>
                    <span class="t-path">reports/q3-forecast.pdf</span><span class="t-note">uploaded</span>
                  </p>
                  <p class="tline t-inline t-up">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 5v14" />
                      <path d="m18 11-6-6" />
                      <path d="m6 11 6-6" />
                    </svg>
                    <span class="t-path">notes/design-review.md</span><span class="t-note">uploaded</span>
                  </p>
                  <p class="tline t-inline">
                    <span class="t-dot"></span>
                    <span class="t-dim">watching ~/.agents/artifacts</span>
                    <span class="t-cursor" aria-hidden="true"></span>
                  </p>
                </div>
              </figure>
            </div>

            <ul class="facts">
              <li>
                <span class="fact-label">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 7a4 4 0 1 0 0 0" />
                    <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    <path d="M21 21v-2a4 4 0 0 0-3-3.85" />
                  </svg>
                  Access
                </span>
                <span class="fact-value">Team scoped</span>
              </li>
              <li>
                <span class="fact-label">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1-4.069 0l-.301-.301-6.558 6.558a2 2 0 0 1-1.239.578l-.175.008H4a1 1 0 0 1-1-1v-1.172a2 2 0 0 1 .467-1.284l.119-.13.414-.414h2v-2h2v-2l2.144-2.144-.301-.301a2.877 2.877 0 0 1 0-4.069l2.643-2.643a2.877 2.877 0 0 1 4.069 0z" />
                    <path d="M15 9h.01" />
                  </svg>
                  Credentials
                </span>
                <span class="fact-value">Revocable</span>
              </li>
            </ul>
          </section>

          <section class="pane-auth" aria-labelledby="auth-title">
            <div class="auth-inner">
              <div class="auth-heading">
                <h2 id="auth-title">Sign in to Artifact Sync</h2>
                <p class="auth-sub">Choose how you want to continue.</p>
              </div>

              <div id="provider-options" class="provider-options">
                <button class="provider provider-github" id="github-button" type="button">
                  <span class="p-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                    </svg>
                  </span>
                  <span>Continue with GitHub</span>
                  <span aria-hidden="true"></span>
                </button>
                <button class="provider provider-email" id="email-button" type="button" aria-expanded="false" aria-controls="email-panel">
                  <span class="p-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                      <path d="m3 7 9 6 9-6" />
                    </svg>
                  </span>
                  <span>Continue with email</span>
                  <span aria-hidden="true"></span>
                </button>
              </div>

              <section id="email-panel" class="email-panel" aria-labelledby="email-title" hidden>
                <button id="back-button" class="back-button" type="button">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M5 12h14" />
                    <path d="m5 12 6 6" />
                    <path d="m5 12 6-6" />
                  </svg>
                  Authentication options
                </button>
                <div class="email-heading">
                  <h3 id="email-title">Email and password</h3>
                  <p id="email-subtitle">Use your account credentials.</p>
                </div>

                <form id="email-form" novalidate>
                  <div id="name-field" class="field" hidden>
                    <label for="name">Name</label>
                    <input id="name" name="name" autocomplete="name" maxlength={100} />
                  </div>
                  <div class="field">
                    <label for="email">Email address</label>
                    <input id="email" name="email" type="email" autocomplete="email" required />
                  </div>
                  <div class="field">
                    <div class="field-label-row">
                      <label for="password">Password</label>
                      <button id="forgot-button" class="text-button" type="button">Forgot password?</button>
                    </div>
                    <input id="password" name="password" type="password" autocomplete="current-password" minlength={8} required />
                  </div>
                  <p id="form-message" class="form-message" role="status" aria-live="polite"></p>
                  <button id="email-submit" class="primary-button" type="submit">Continue</button>
                </form>

                <div class="account-switch">
                  <span id="mode-hint">New to Artifact Sync?</span>
                  <button id="mode-button" class="text-button strong" type="button">Create account</button>
                </div>
              </section>

              <p class="security-note">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6z" />
                  <path d="M11 16a1 1 0 1 0 2 0 1 1 0 0 0-2 0" />
                  <path d="M8 11V7a4 4 0 1 1 8 0v4" />
                </svg>
                <span>Sessions use secure, HTTP-only cookies. Artifact secrets are never shown after creation.</span>
              </p>
            </div>
          </section>
        </section>
      </main>
    </body>
  </html>
);
