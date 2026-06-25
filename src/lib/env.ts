export function env(name: string) {
  const value = process.env[name];
  const normalized = value?.trim();
  return normalized && normalized !== "\"\"" && normalized !== "''" ? normalized : undefined;
}

export function requireEnv(name: string) {
  const value = env(name);
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function featureFlags() {
  const twilioRestAuthConfigured = Boolean(env("TWILIO_AUTH_TOKEN") || (env("TWILIO_API_KEY") && env("TWILIO_API_SECRET")));
  return {
    database: Boolean(env("DATABASE_URL")),
    openai: Boolean(env("OPENAI_API_KEY")),
    line: Boolean(env("LINE_CHANNEL_SECRET") && env("LINE_CHANNEL_ACCESS_TOKEN")),
    twilio: Boolean(env("TWILIO_ACCOUNT_SID") && twilioRestAuthConfigured && env("TWILIO_PHONE_NUMBER")),
    clerk: Boolean(env("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") && env("CLERK_SECRET_KEY"))
  };
}

export function assertProductionReady() {
  const twilioRestAuthConfigured = Boolean(env("TWILIO_AUTH_TOKEN") || (env("TWILIO_API_KEY") && env("TWILIO_API_SECRET")));
  const required = [
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_PHONE_NUMBER",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY"
  ];

  return [
    ...required.map((name) => ({ name, configured: Boolean(env(name)) })),
    { name: "TWILIO_REST_AUTH", configured: twilioRestAuthConfigured }
  ];
}
