function safeDatabaseUrlShape(value) {
  const result = {
    has: Boolean(value),
    length: value?.length ?? 0
  };

  if (!value) return result;

  try {
    const url = new URL(value);
    return {
      ...result,
      protocol: url.protocol,
      username: url.username,
      host: url.host,
      pathname: url.pathname,
      passwordLength: url.password.length,
      query: url.search
    };
  } catch (error) {
    return {
      ...result,
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

function compareDatabaseUrls(actual, expected) {
  if (!actual || !expected) return null;

  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    return {
      sameProtocol: actualUrl.protocol === expectedUrl.protocol,
      sameUsername: actualUrl.username === expectedUrl.username,
      samePassword: actualUrl.password === expectedUrl.password,
      sameHost: actualUrl.host === expectedUrl.host,
      samePathname: actualUrl.pathname === expectedUrl.pathname,
      sameQuery: actualUrl.search === expectedUrl.search
    };
  } catch (error) {
    return {
      compareError: error instanceof Error ? error.message : String(error)
    };
  }
}

console.error(
  JSON.stringify(
    {
      databaseUrl: safeDatabaseUrlShape(process.env.DATABASE_URL),
      expectedDatabaseUrlExactMatch: process.env.EXPECTED_DATABASE_URL
        ? process.env.DATABASE_URL === process.env.EXPECTED_DATABASE_URL
        : null,
      expectedDatabaseUrlPartMatch: compareDatabaseUrls(process.env.DATABASE_URL, process.env.EXPECTED_DATABASE_URL)
    },
    null,
    2
  )
);
