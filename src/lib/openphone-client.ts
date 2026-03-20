// Server-side only — never import this from client components
const OPENPHONE_API_BASE = "https://api.openphone.com/v1";

function getApiKey(): string {
  const key = process.env.OPENPHONE_API_KEY;
  if (!key) throw new Error("OPENPHONE_API_KEY env var is not set");
  return key;
}

/**
 * Send an SMS via the OpenPhone API.
 * @param to   Recipient phone number in E.164 format (e.g. "+16025551234")
 * @param from Sender phone number in E.164 format — must be a number owned by the account
 * @param content The text message body
 */
export async function sendSMS(
  to: string,
  from: string,
  content: string
): Promise<void> {
  const res = await fetch(`${OPENPHONE_API_BASE}/messages`, {
    method: "POST",
    headers: {
      Authorization: getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, from, to: [to] }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `OpenPhone API error ${res.status} sending SMS to ${to}: ${body}`
    );
  }
}
