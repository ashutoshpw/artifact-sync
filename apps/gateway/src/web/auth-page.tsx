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
      <title>Sign in · Artifact Sync</title>
      <link rel="stylesheet" href="/assets/auth.css" />
      <script src="/assets/auth.js" defer />
    </head>
    <body data-return-to={returnTo}>
      <main class="auth-frame">
        <section class="auth-context" aria-labelledby="product-title">
          <a class="brand" href="/" aria-label="Artifact Sync home">
            <span class="brand-mark" aria-hidden="true">A</span>
            <span>Artifact Sync</span>
          </a>
          <div class="context-copy">
            <p class="context-label">Private artifact control</p>
            <h1 id="product-title">Your files, one calm workspace.</h1>
            <p>Connect trusted devices, publish team-scoped artifacts, and keep every credential visible from one place.</p>
          </div>
          <dl class="context-facts">
            <div><dt>Storage</dt><dd>Private R2</dd></div>
            <div><dt>Access</dt><dd>Team scoped</dd></div>
            <div><dt>Credentials</dt><dd>Revocable</dd></div>
          </dl>
        </section>

        <section class="auth-card" aria-labelledby="auth-title">
          <div class="auth-heading">
            <p class="auth-kicker">Welcome</p>
            <h2 id="auth-title">Sign in to Artifact Sync</h2>
            <p>Choose how you want to continue.</p>
          </div>

          <div id="provider-options" class="provider-options">
            <button class="provider-button github" id="github-button" type="button">
              <span class="provider-mark" aria-hidden="true">GH</span>
              <span>Continue with GitHub</span>
            </button>
            <button class="provider-button" id="email-button" type="button" aria-expanded="false" aria-controls="email-panel">
              <span class="provider-mark" aria-hidden="true">@</span>
              <span>Continue with email</span>
            </button>
          </div>

          <section id="email-panel" class="email-panel" aria-labelledby="email-title" hidden>
            <button id="back-button" class="back-button" type="button">
              <span aria-hidden="true">←</span>
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

          <p class="security-note">Sessions use secure, HTTP-only cookies. Artifact secrets are never shown after creation.</p>
        </section>
      </main>
    </body>
  </html>
);
