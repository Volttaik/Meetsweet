import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';

export interface Transaction {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  createdAt: string;
}

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('@ms_access_token');
}

export async function getWallet(): Promise<{ balance: number; transactions: Transaction[] }> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch('/wallet', {
    headers: { Authorization: `Bearer ${token}` },
  });
}
