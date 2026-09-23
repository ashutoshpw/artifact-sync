import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDatabase } from "../db/client.ts";
import { account, session, teamMemberships, teams, user, verification } from "../db/schema.ts";
import type { GatewayEnv } from "./types.ts";

type BetterAuthUser = Pick<typeof user.$inferSelect, "id" | "name" | "emailVerified">;

export function createWebAuth(env: GatewayEnv) {
  const db = createDatabase(env.DB);
  const emailFrom = env.AUTH_EMAIL_FROM || "Artifact Sync <no-reply@artifact.w3dev.app>";

  return betterAuth({
    appName: "Artifact Sync",
    baseURL: env.APP_ORIGIN,
    basePath: "/__api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user,
        session,
        account,
        verification,
      },
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user: recipient, url }) => {
        await sendAuthEmail(env, {
          to: recipient.email,
          from: emailFrom,
          subject: "Reset your Artifact Sync password",
          text: `Reset your password using this link: ${url}`,
          html: `<p>Use this link to reset your Artifact Sync password:</p><p><a href="${escapeAttribute(url)}">Reset password</a></p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: recipient, url }) => {
        await sendAuthEmail(env, {
          to: recipient.email,
          from: emailFrom,
          subject: "Verify your Artifact Sync email",
          text: `Verify your email address using this link: ${url}`,
          html: `<p>Confirm your email address to finish creating your Artifact Sync account:</p><p><a href="${escapeAttribute(url)}">Verify email</a></p>`,
        });
      },
    },
    socialProviders: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {},
    databaseHooks: {
      user: {
        create: { after: async (createdUser) => ensurePersonalTeam(db, createdUser) },
        update: { after: async (updatedUser) => ensurePersonalTeam(db, updatedUser) },
      },
    },
  });
}

async function ensurePersonalTeam(
  db: ReturnType<typeof createDatabase>,
  accountUser: BetterAuthUser,
): Promise<void> {
  if (!accountUser.emailVerified) return;

  const normalizedName = accountUser.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 38) || "team";
  const identitySuffix = accountUser.id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-8);
  const teamId = `team_${accountUser.id}`;
  const teamSlug = `${normalizedName}-${identitySuffix || crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();

  await db.batch([
    db.insert(teams).values({
      id: teamId,
      name: `${accountUser.name}'s team`,
      slug: teamSlug,
      createdAt: now,
    }).onConflictDoNothing(),
    db.insert(teamMemberships).values({
      teamId,
      userId: accountUser.id,
      role: "admin",
      createdAt: now,
    }).onConflictDoNothing(),
  ]);
}

async function sendAuthEmail(
  env: GatewayEnv,
  message: { to: string; from: string; subject: string; text: string; html: string },
): Promise<void> {
  if (!env.EMAIL) throw new Error("transactional email is not configured");
  await env.EMAIL.send(message);
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
