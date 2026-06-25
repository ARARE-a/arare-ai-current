export function userFacingError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const lower = message.toLowerCase();

  if (!message || lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return `${fallback}。通信状態またはログイン状態を確認してください。`;
  }

  if (lower.includes("non-json") || lower.includes("<!doctype") || lower.includes("sign-in")) {
    return `${fallback}。ログイン状態を確認してから再読み込みしてください。`;
  }

  if (lower.includes("prisma") || lower.includes("database_url") || lower.includes("datasource")) {
    return `${fallback}。DB接続設定を確認してください。`;
  }

  if (lower.startsWith("api error")) {
    return `${fallback}。API応答を確認してください。`;
  }

  return message || fallback;
}
