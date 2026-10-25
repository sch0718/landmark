export async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string | null,
  fetchFn: typeof fetch,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (ip !== null) body.set('remoteip', ip);
  try {
    const response = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const result: unknown = await response.json();
    return (
      response.ok &&
      typeof result === 'object' &&
      result !== null &&
      'success' in result &&
      result.success === true
    );
  } catch {
    return false;
  }
}
