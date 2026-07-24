import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  postId: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
  } | null;
}

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('@ms_access_token');
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function getNotifications(before?: string): Promise<{
  notifications: Notification[];
  unreadCount: number;
  hasMore: boolean;
}> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  const qs = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiFetch(`/notifications${qs}`, { headers: authHeader(token) });
}

export async function markNotificationRead(id: string): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  await apiFetch(`/notifications/${id}/read`, {
    method: 'PUT',
    headers: authHeader(token),
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  await apiFetch('/notifications/read-all', {
    method: 'PUT',
    headers: authHeader(token),
  });
}
