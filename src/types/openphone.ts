// OpenPhone (Quo) webhook payload types — server-side only

export interface OpenPhoneMessageObject {
  id: string;
  object: "message";
  from: string; // E.164 phone number of sender
  to: string[]; // E.164 phone number(s) of recipient(s)
  direction: "incoming" | "outgoing";
  text: string;
  status: string;
  createdAt: string;
  userId: string;
  phoneNumberId: string;
  contactIds: string[];
}

export interface OpenPhoneCallVoicemail {
  url: string;
  type: string;
  duration: number;
}

export interface OpenPhoneCallObject {
  id: string;
  object: "call";
  from: string; // E.164 phone number of caller
  to: string; // E.164 phone number that was called (BNL's number)
  direction: "incoming" | "outgoing";
  status: string;
  duration: number;
  answeredAt: string | null; // null = missed call
  completedAt: string;
  userId: string;
  phoneNumberId: string;
  voicemail: OpenPhoneCallVoicemail | null;
  contactIds: string[];
}

export interface OpenPhoneMessageEvent {
  id: string;
  object: "event";
  apiVersion: string;
  createdAt: string;
  type: "message.received" | "message.delivered";
  data: { object: OpenPhoneMessageObject };
}

export interface OpenPhoneCallEvent {
  id: string;
  object: "event";
  apiVersion: string;
  createdAt: string;
  type: "call.completed" | "call.ringing" | "call.recording.completed";
  data: { object: OpenPhoneCallObject };
}

export type OpenPhoneWebhookEvent = OpenPhoneMessageEvent | OpenPhoneCallEvent;
