// Server-side only — GHL REST API wrapper
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15";
const GHL_LOCATION_ID = "4B1ce8cldGxqXA9jm9W4";

function getApiKey(): string {
  const key = process.env.GHL_LOCATION_API_KEY;
  if (!key) throw new Error("GHL_LOCATION_API_KEY env var is not set");
  return key;
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
    Version: GHL_VERSION,
  };
}

async function ghlFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: { ...ghlHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL API ${res.status} ${path}: ${body}`);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GhlContact {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  instagram?: string;
  tags?: string[];
  customFields?: { id: string; value: unknown }[];
}

export interface GhlConversation {
  id: string;
  type: string; // "TYPE_PHONE", etc.
  lastMessageType?: string; // "TYPE_INSTAGRAM", "TYPE_SMS", "TYPE_EMAIL", etc.
  contactId: string;
  unreadCount?: number;
}

// ── Conversations ─────────────────────────────────────────────────────────────

/**
 * Search for existing conversations for a contact.
 * Returns conversations sorted by most recent first.
 */
export async function searchConversations(
  contactId: string
): Promise<GhlConversation[]> {
  const data = await ghlFetch(
    `/conversations/search?contactId=${contactId}&limit=20&sort=desc&sortBy=last_message_date`
  );
  return data?.conversations ?? [];
}

// ── Send Message ──────────────────────────────────────────────────────────────

interface SendSmsParams {
  type: "SMS";
  contactId: string;
  toNumber: string;
  message: string;
}

interface SendIgDmParams {
  type: "IG";
  contactId: string;
  conversationId: string;
  message: string;
}

interface SendEmailParams {
  type: "Email";
  contactId: string;
  subject: string;
  html: string;
}

type SendMessageParams = SendSmsParams | SendIgDmParams | SendEmailParams;

/**
 * Send a message via GHL conversations API.
 * All channels use the same endpoint — fields vary by type.
 */
export async function sendMessage(params: SendMessageParams): Promise<void> {
  let body: Record<string, unknown>;

  if (params.type === "SMS") {
    body = {
      type: "SMS",
      contactId: params.contactId,
      fromNumber: "+19289705080", // BNL marketing number
      toNumber: params.toNumber,
      message: params.message,
    };
  } else if (params.type === "IG") {
    body = {
      type: "IG",
      contactId: params.contactId,
      conversationId: params.conversationId,
      message: params.message,
    };
  } else {
    body = {
      type: "Email",
      contactId: params.contactId,
      subject: params.subject,
      html: params.html,
    };
  }

  await ghlFetch("/conversations/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export async function getContact(contactId: string): Promise<GhlContact> {
  const data = await ghlFetch(`/contacts/${contactId}`);
  return data?.contact ?? data;
}

/** Look up a contact by phone number. Returns null if not found. */
export async function findContactByPhone(phone: string): Promise<GhlContact | null> {
  const normalized = phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`;
  const data = await ghlFetch(
    `/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(normalized)}`
  );
  const contacts: GhlContact[] = data?.contacts ?? [];
  return contacts[0] ?? null;
}

/** Add a note to a contact record. Best-effort — callers should catch errors. */
export async function createContactNote(contactId: string, body: string): Promise<void> {
  await ghlFetch(`/contacts/${contactId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

/**
 * Fetch all opportunities in the "Red - Last 90 Days" stage.
 * Pipeline: LLlWBbsAg7ruUPXt3euI  Stage: 41681a62-e260-440e-a9a2-c74b66fa4d9f
 */
export async function getRedStageContacts(
  locationId: string
): Promise<GhlContact[]> {
  const pipelineId = "LLlWBbsAg7ruUPXt3euI";
  const stageId = "41681a62-e260-440e-a9a2-c74b66fa4d9f";

  const data = await ghlFetch(
    `/opportunities/search?location_id=${locationId}&pipeline_id=${pipelineId}&pipeline_stage_id=${stageId}&status=open&limit=100`
  );

  const opps: Array<{ contact?: GhlContact }> = data?.opportunities ?? [];
  return opps.map((o) => o.contact).filter(Boolean) as GhlContact[];
}
