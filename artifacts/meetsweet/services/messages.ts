import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ConversationUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  isVerified: boolean;
}

export interface Conversation {
  id: string;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  isMuted: boolean;
  isArchived: boolean;
  unreadCount: number;
  otherUser: ConversationUser;
}

export interface ChatMessage {
  id: string;
  body: string | null;
  mediaUrl: string | null;
  mediaType: 'image' | 'video' | null;
  isDeleted: boolean;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
  };
  isOwn: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('@ms_access_token');
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function getConversations(
  tab: 'all' | 'archived' = 'all',
): Promise<{ conversations: Conversation[] }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/conversations?tab=${tab}`, { headers: authHeader(token) });
}

export async function createConversation(
  userId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch('/conversations', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ userId }),
  });
}

export async function getMessages(
  conversationId: string,
  before?: string,
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  const qs = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiFetch(`/conversations/${conversationId}/messages${qs}`, {
    headers: authHeader(token),
  });
}

export async function sendMessage(
  conversationId: string,
  body?: string,
  mediaUrl?: string,
  mediaType?: string,
): Promise<{ message: ChatMessage }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ body, mediaUrl, mediaType }),
  });
}

export async function deleteMessage(messageId: string): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  await apiFetch(`/messages/${messageId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function archiveConversation(
  conversationId: string,
  archived: boolean,
): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  await apiFetch(`/conversations/${conversationId}/archive`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ archived }),
  });
}

export async function searchUsers(
  q: string,
): Promise<{ users: ConversationUser[] }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/users/search?q=${encodeURIComponent(q)}`, {
    headers: authHeader(token),
  });
}
