import { apiFetch } from './api';

export interface Category {
  id: string;
  name: string;
  slug: string;
  postCount: number;
}

export async function getCategories(): Promise<{ categories: Category[] }> {
  return apiFetch('/categories');
}
