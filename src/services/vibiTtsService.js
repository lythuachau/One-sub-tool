import { API_BASE_URL } from '../config';

const request = async (endpoint, apiKey, body, signal) => {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/narration/vibi/${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: body
        ? { 'Content-Type': 'application/json', Accept: 'application/json' }
        : { 'Content-Type': 'application/json', Accept: 'application/json', 'x-vibi-api-key': apiKey },
      ...(body ? { body: JSON.stringify({ ...body, apiKey }) } : {}),
      signal
    });
  } catch (error) {
    if (error.name === 'TypeError') {
      throw new Error('Không kết nối được backend One-sub-tool. Hãy khởi động lại bằng npm run dev:cuda rồi thử lại.');
    }
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    const hint = contentType.includes('text/html')
      ? ' Backend đang chạy phiên bản cũ; hãy khởi động lại npm run dev:cuda.'
      : '';
    throw new Error(`Vibi API trả về dữ liệu không phải JSON (HTTP ${response.status}).${hint}`);
  }
  if (!response.ok || data.error) {
    const detail = data.error || `Vibi API returned ${response.status}.`;
    const retryAfter = data.retry_after ? ` Thử lại sau ${data.retry_after}.` : '';
    throw new Error(`${detail} (HTTP ${response.status}).${retryAfter}`);
  }
  return data;
};

export const getVibiCatalog = (apiKey, signal) => {
  if (!apiKey) throw new Error('Hãy thêm Vibi API key trong Cài đặt → Khóa API.');
  return request('catalog', apiKey, null, signal);
};

export const synthesizeVibi = (apiKey, options, signal) => {
  if (!apiKey) throw new Error('Hãy thêm Vibi API key trong Cài đặt → Khóa API.');
  return request('synthesize', apiKey, options, signal);
};
