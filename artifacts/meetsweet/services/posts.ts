import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';

export interface PostAuthor {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  isVerified: boolean;
  isCreator: boolean;
}

export interface Post {
  id: string;
  caption: string;
  visibility: 'public' | 'subscribers' | 'draft';
  mediaUrl: string | null;
  mediaType: 'image' | 'video' | null;
  thumbnailUrl: string | null;
  durationSecs: number | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  likeCount: number;
  commentCount: number;
  bookmarkCount: number;
  isPremium: boolean;
  priceCredits: number | null;
  createdAt: string;
  author: PostAuthor;
  likedByMe: boolean;
  bookmarkedByMe: boolean;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
  };
}

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('@ms_access_token');
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function getFeed(page = 1): Promise<{ posts: Post[]; hasMore: boolean }> {
  const token = await getToken();
  const headers = token ? authHeader(token) : {};
  return apiFetch(`/posts?page=${page}&limit=20`, { headers });
}

export async function getUserPosts(userId: string, page = 1): Promise<{ posts: Post[]; hasMore: boolean }> {
  const token = await getToken();
  const headers = token ? authHeader(token) : {};
  return apiFetch(`/posts?userId=${userId}&page=${page}&limit=20`, { headers });
}

export async function getPost(id: string): Promise<{ post: Post }> {
  const token = await getToken();
  const headers = token ? authHeader(token) : {};
  return apiFetch(`/posts/${id}`, { headers });
}

export interface CreatePostData {
  caption?: string;
  visibility?: string;
  mediaUrl?: string;
  mediaType?: string;
  thumbnailUrl?: string;
  durationSecs?: number;
  fileSize?: number;
  width?: number;
  height?: number;
  isPremium?: boolean;
  priceCredits?: number;
  categories?: string[];
  tags?: string[];
}

export async function createPost(data: CreatePostData): Promise<{ post: Post }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch('/posts', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify(data),
  });
}

export async function deletePost(id: string): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  await apiFetch(`/posts/${id}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function likePost(id: string): Promise<{ liked: boolean; likeCount: number }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/posts/${id}/like`, {
    method: 'POST',
    headers: authHeader(token),
  });
}

export async function unlikePost(id: string): Promise<{ liked: boolean; likeCount: number }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/posts/${id}/like`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function getComments(postId: string): Promise<{ comments: Comment[] }> {
  return apiFetch(`/posts/${postId}/comments`);
}

export async function addComment(postId: string, body: string): Promise<{ comment: Comment }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/posts/${postId}/comments`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ body }),
  });
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  await apiFetch(`/posts/${postId}/comments/${commentId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function likeComment(
  postId: string,
  commentId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/posts/${postId}/comments/${commentId}/like`, {
    method: 'POST',
    headers: authHeader(token),
  });
}

export async function unlikeComment(
  postId: string,
  commentId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/posts/${postId}/comments/${commentId}/like`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function bookmarkPost(id: string): Promise<{ bookmarked: boolean }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/posts/${id}/bookmark`, {
    method: 'POST',
    headers: authHeader(token),
  });
}

export async function unbookmarkPost(id: string): Promise<{ bookmarked: boolean }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch(`/posts/${id}/bookmark`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

export async function getBookmarkedPosts(
  page = 1,
): Promise<{ posts: Post[]; hasMore: boolean }> {
  const token = await getToken();
  const headers = token ? authHeader(token) : {};
  return apiFetch(`/posts?bookmarked=true&page=${page}&limit=20`, { headers });
}
