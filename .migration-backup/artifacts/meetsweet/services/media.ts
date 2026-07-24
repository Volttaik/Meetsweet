import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBase } from './api';
import type { ApiError } from './api';

export interface UploadedMedia {
  url: string;
  thumbnailUrl: string | null;
  type: 'image' | 'video';
  size: number;
  filename: string;
  originalName: string;
  mimeType: string;
}

export async function uploadMedia(
  uri: string,
  mimeType: string,
  filename: string,
  onProgress?: (progress: number) => void,
): Promise<UploadedMedia> {
  const token = await AsyncStorage.getItem('@ms_access_token');
  if (!token) throw new Error('Not authenticated');

  const formData = new FormData();
  formData.append('file', {
    uri,
    type: mimeType,
    name: filename,
  } as unknown as Blob);

  const base = getApiBase();
  const url = `${base}/media/upload`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as UploadedMedia);
        } else {
          reject(new Error(data.error ?? `Upload failed: HTTP ${xhr.status}`));
        }
      } catch {
        reject(new Error('Failed to parse upload response'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('timeout', () => reject(new Error('Upload timed out')));

    xhr.timeout = 120_000; // 2 min timeout
    xhr.send(formData);
  });
}
