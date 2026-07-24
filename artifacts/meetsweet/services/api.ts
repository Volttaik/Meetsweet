/**
 * Central API service.
 * All API calls from the Expo app go through this module.
 */

// Build the API base URL from the Expo public domain env var
export function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}/api`;
  // Fallback for local/web development
  return '/api';
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Authenticated fetch wrapper. Prepends the API base URL automatically.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
  const base = getApiBase();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Strip Content-Type for FormData (browser sets correct multipart boundary)
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const response = await fetch(url, { ...options, headers });

  let data: unknown;
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      (data as Record<string, string>)?.error ??
      (data as Record<string, string>)?.message ??
      `HTTP ${response.status}`;
    throw new ApiError(response.status, message, data);
  }

  return data as T;
}

/**
 * Authenticated fetch with Bearer token injected from AsyncStorage.
 */
export async function authFetch<T = unknown>(
  path: string,
  token: string,
  options: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
  return apiFetch<T>(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}
