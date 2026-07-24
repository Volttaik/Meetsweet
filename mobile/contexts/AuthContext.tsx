import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthTokenGetter, setBaseUrl } from '@/lib/api-client-react';
import { getApiBase, apiFetch } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  username: string;
  email: string | null;
  phone: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  isVerified: boolean;
  isCreator: boolean;
  credits: number;
  followerCount: number;
  followingCount: number;
  subscriberCount: number;
  postCount: number;
  createdAt: string;
}

export interface RegisterData {
  name: string;
  username?: string;
  email?: string;
  phone?: string;
  password: string;
  bio?: string;
  avatarUrl?: string;
}

export interface LoginData {
  identifier: string;
  password: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (data: LoginData) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (user: User) => void;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  ACCESS_TOKEN: '@ms_access_token',
  REFRESH_TOKEN: '@ms_refresh_token',
  USER: '@ms_user',
} as const;

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // Configure the generated client against the standalone server.
  useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    setBaseUrl(apiUrl ? apiUrl.replace(/\/+$/, '') : null);
    setAuthTokenGetter(async () => {
      return await AsyncStorage.getItem(KEYS.ACCESS_TOKEN);
    });
  }, []);

  // Load persisted auth on mount
  useEffect(() => {
    (async () => {
      try {
        const [accessToken, userJson, refreshToken] = await Promise.all([
          AsyncStorage.getItem(KEYS.ACCESS_TOKEN),
          AsyncStorage.getItem(KEYS.USER),
          AsyncStorage.getItem(KEYS.REFRESH_TOKEN),
        ]);

        if (accessToken && userJson) {
          const user = JSON.parse(userJson) as User;
          setState({ user, accessToken, isLoading: false, isAuthenticated: true });

          // Try to refresh user data in background
          fetchCurrentUser(accessToken).catch(async () => {
            // Access token might be expired — try refresh
            if (refreshToken) {
              try {
                await doRefresh(refreshToken);
              } catch {
                await clearAuth();
              }
            } else {
              await clearAuth();
            }
          });
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      } catch {
        setState((s) => ({ ...s, isLoading: false }));
      }
    })();
  }, []);

  const fetchCurrentUser = async (token: string) => {
    const data = await apiFetch<{ user: User }>('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    setState((s) => ({ ...s, user: data.user }));
    await AsyncStorage.setItem(KEYS.USER, JSON.stringify(data.user));
    return data.user;
  };

  const doRefresh = async (refreshToken: string) => {
    const data = await apiFetch<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
    await AsyncStorage.setItem(KEYS.ACCESS_TOKEN, data.accessToken);
    await AsyncStorage.setItem(KEYS.REFRESH_TOKEN, data.refreshToken);
    const user = await fetchCurrentUser(data.accessToken);
    setState((s) => ({ ...s, accessToken: data.accessToken, user, isAuthenticated: true }));
  };

  const clearAuth = async () => {
    await Promise.all([
      AsyncStorage.removeItem(KEYS.ACCESS_TOKEN),
      AsyncStorage.removeItem(KEYS.REFRESH_TOKEN),
      AsyncStorage.removeItem(KEYS.USER),
    ]);
    setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false });
  };

  const login = useCallback(async (data: LoginData) => {
    const result = await apiFetch<{ user: User; accessToken: string; refreshToken: string }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify(data) },
    );
    await Promise.all([
      AsyncStorage.setItem(KEYS.ACCESS_TOKEN, result.accessToken),
      AsyncStorage.setItem(KEYS.REFRESH_TOKEN, result.refreshToken),
      AsyncStorage.setItem(KEYS.USER, JSON.stringify(result.user)),
    ]);
    setState({
      user: result.user,
      accessToken: result.accessToken,
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    const result = await apiFetch<{ user: User; accessToken: string; refreshToken: string }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify(data) },
    );
    await Promise.all([
      AsyncStorage.setItem(KEYS.ACCESS_TOKEN, result.accessToken),
      AsyncStorage.setItem(KEYS.REFRESH_TOKEN, result.refreshToken),
      AsyncStorage.setItem(KEYS.USER, JSON.stringify(result.user)),
    ]);
    setState({
      user: result.user,
      accessToken: result.accessToken,
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      const refreshToken = await AsyncStorage.getItem(KEYS.REFRESH_TOKEN);
      const accessToken = await AsyncStorage.getItem(KEYS.ACCESS_TOKEN);
      await apiFetch('/auth/logout', {
        method: 'POST',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    } finally {
      await clearAuth();
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const token = await AsyncStorage.getItem(KEYS.ACCESS_TOKEN);
    if (token) {
      await fetchCurrentUser(token);
    }
  }, []);

  const updateUser = useCallback((user: User) => {
    setState((s) => ({ ...s, user }));
    AsyncStorage.setItem(KEYS.USER, JSON.stringify(user)).catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refreshUser, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
