import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';
import type { User } from '@/contexts/AuthContext';

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('@ms_access_token');
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function getMe(): Promise<{ user: User }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch('/users/me', { headers: authHeader(token) });
}

export async function updateMe(data: {
  name?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
}): Promise<{ user: User }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch('/users/me', {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify(data),
  });
}

export async function getUser(username: string): Promise<{ user: User; isFollowing: boolean }> {
  const token = await getToken();
  const headers = token ? authHeader(token) : {};
  return apiFetch(`/users/${username}`, { headers });
}

export async function followUser(username: string): Promise<{ following: boolean }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/users/${username}/follow`, {
    method: 'POST',
    headers: authHeader(token),
  });
}

export async function unfollowUser(username: string): Promise<{ following: boolean }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/users/${username}/follow`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}
