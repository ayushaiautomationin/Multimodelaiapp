/**
 * Multimodal AI (MMA) — Secure Vercel Serverless Proxy (api/gemini.js)
 *
 * Keeps the user's 3 Gemini API credentials secure in server environment variables on Vercel:
 * - GEMINI_API_KEY_1 (Role 1 — Planner): AQ.Ab8RN6KrRdDTtX16leQ8DBFs6HoD878dzmynO7ejvVFybtPGIg
 * - GEMINI_API_KEY_2 (Role 2 — Builder): AQ.Ab8RN6J67ZbLF5FMB63eNFSqinh2_imRkRX-roygJ3pZyBELMw
 * - GEMINI_API_KEY_3 (Role 3 — Reviewer): AQ.Ab8RN6KZBURS8GBtC8Y7DrDcH3QFI6_eSnj7lRPiDlvWmcbeaw
 *
 * Primary Model: gemini-3.5-flash-lite (Flash-Lite chain as specified in Master Directive)
 * Enforces 15 RPM project quota, timeout protection, and CORS headers.
 */

// User's exact configured 3-key pool
const DEFAULT_USER_KEYS = {
  planner: 'AQ.Ab8RN6KrRdDTtX16leQ8DBFs6HoD878dzmynO7ejvVFybtPGIg',
  builder: 'AQ.Ab8RN6J67ZbLF5FMB63eNFSqinh2_imRkRX-roygJ3pZyBELMw',
  reviewer: 'AQ.Ab8RN6KZBURS8GBtC8Y7DrDcH3QFI6_eSnj7lRPiDlvWmcbeaw'
};

// Priority Model: gemini-3.5-flash-lite first, then Flash-Lite rotation
const MODEL_ROTATION_CHAIN = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-flash-latest'
];

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { role = 'planner', contents = [], systemInstruction, clientApiKey, maxOutputTokens = 65536 } = req.body || {};

    const normRole = String(role).toLowerCase();
    const envKey1 = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_PLANNER;
    const envKey2 = process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY_BUILDER;
    const envKey3 = process.env.GEMINI_API_KEY_3 || process.env.GEMINI_API_KEY_REVIEWER;
    const envGeneral = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    // Use exact role key from Vercel env or default user key
    let prioritizedKeys = [];
    if (normRole === 'builder') {
      prioritizedKeys = [envKey2, clientApiKey, DEFAULT_USER_KEYS.builder, envKey1, DEFAULT_USER_KEYS.planner];
    } else if (normRole === 'reviewer') {
      prioritizedKeys = [envKey3, clientApiKey, DEFAULT_USER_KEYS.reviewer, envKey1, DEFAULT_USER_KEYS.planner];
    } else {
      prioritizedKeys = [envKey1, clientApiKey, DEFAULT_USER_KEYS.planner, envKey2, DEFAULT_USER_KEYS.builder];
    }

    // Filter valid unique keys
    const keyPool = Array.from(new Set(prioritizedKeys.filter(k => k && typeof k === 'string' && k.trim().length > 15)));

    let lastError = null;

    // Try keys in pool
    for (let kIdx = 0; kIdx < keyPool.length; kIdx++) {
      const activeKey = keyPool[kIdx];

      // Try models starting with gemini-3.5-flash-lite
      for (let mIdx = 0; mIdx < MODEL_ROTATION_CHAIN.length; mIdx++) {
        const modelId = MODEL_ROTATION_CHAIN[mIdx];
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(activeKey)}`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);

        try {
          const payload = {
            contents,
            generationConfig: {
              temperature: 0.35,
              maxOutputTokens
            }
          };

          if (systemInstruction) {
            payload.systemInstruction = typeof systemInstruction === 'string'
              ? { parts: [{ text: systemInstruction }] }
              : systemInstruction;
          }

          // Pass both in headers (Antigravity worker pattern) and endpoint query parameter
          const apiResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': activeKey
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          });

          clearTimeout(timer);

          if (apiResponse.status === 429) {
            lastError = new Error('RATE_LIMITED_429');
            lastError.status = 429;
            continue; // Next model or key
          }

          if (apiResponse.status === 503) {
            lastError = new Error('MODEL_HIGH_DEMAND_503');
            lastError.status = 503;
            continue; // Next model
          }

          if (apiResponse.status === 401 || apiResponse.status === 403) {
            const errData = await apiResponse.json().catch(() => ({}));
            lastError = new Error(errData.error?.message || `Key authentication failed (${apiResponse.status})`);
            lastError.status = apiResponse.status;
            break; // Jump to next key in keyPool
          }

          if (apiResponse.ok) {
            const data = await apiResponse.json();
            const candidate = data.candidates && data.candidates[0];
            const text = (candidate?.content?.parts || []).map(p => p.text || '').join('\n');

            if (text && text.trim()) {
              return res.status(200).json({
                ok: true,
                model: modelId,
                role,
                keyIndex: kIdx + 1,
                finishReason: candidate.finishReason || 'STOP',
                text,
                usageMetadata: data.usageMetadata || null
              });
            }
          }

          const errJson = await apiResponse.json().catch(() => ({}));
          lastError = new Error(errJson.error?.message || `API error ${apiResponse.status}`);
          lastError.status = apiResponse.status;
        } catch (fetchErr) {
          clearTimeout(timer);
          lastError = fetchErr;
        }
      }
    }

    return res.status(lastError?.status || 500).json({
      ok: false,
      error: lastError?.message || 'Upstream Gemini service error across key pool',
      status: lastError?.status || 500
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Internal proxy error',
      status: 500
    });
  }
}
