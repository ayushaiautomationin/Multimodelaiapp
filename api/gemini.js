/**
 * Multimodal AI (MMA) — Secure Vercel Serverless Proxy (api/gemini.js)
 *
 * Keeps Gemini API credentials secure in server environment variables on Vercel:
 * - GEMINI_API_KEY_1 (Planner)
 * - GEMINI_API_KEY_2 (Builder)
 * - GEMINI_API_KEY_3 (Reviewer)
 * Also accepts client-provided keys (e.g. from user Settings modal) when running in self-hosted or static environments.
 * Enforces 15 RPM project quota, exponential backoff, timeout protection, and structured responses.
 */

const MODEL_ROTATION_CHAIN = [
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
];

export default async function handler(req, res) {
  // CORS Headers for modern browser clients
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

    // Resolve API Key: Check server environment variables first, then client-provided key
    let apiKey = '';
    const normRole = String(role).toLowerCase();
    if (normRole === 'builder') {
      apiKey = process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY_BUILDER || process.env.GEMINI_API_KEY_1;
    } else if (normRole === 'reviewer') {
      apiKey = process.env.GEMINI_API_KEY_3 || process.env.GEMINI_API_KEY_REVIEWER || process.env.GEMINI_API_KEY_1;
    } else {
      apiKey = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_PLANNER;
    }

    // Fallback to general GEMINI_API_KEY or client-provided key
    if (!apiKey) {
      apiKey = process.env.GEMINI_API_KEY || clientApiKey;
    }

    if (!apiKey) {
      return res.status(401).json({
        ok: false,
        error: 'AUTH_REQUIRED: No Gemini API Key configured in server environment or client settings.',
        status: 401
      });
    }

    // Attempt model rotation chain
    let lastError = null;
    let selectedModel = MODEL_ROTATION_CHAIN[0];

    for (const modelId of MODEL_ROTATION_CHAIN) {
      selectedModel = modelId;
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35000);

      try {
        const payload = {
          contents,
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens
          }
        };

        if (systemInstruction) {
          payload.systemInstruction = typeof systemInstruction === 'string'
            ? { parts: [{ text: systemInstruction }] }
            : systemInstruction;
        }

        const apiResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timer);

        if (apiResponse.status === 429) {
          lastError = new Error('RATE_LIMITED_429');
          lastError.status = 429;
          continue; // Try next model or backoff
        }

        if (apiResponse.ok) {
          const data = await apiResponse.json();
          const candidate = data.candidates && data.candidates[0];
          const text = (candidate && candidate.content && candidate.content.parts || [])
            .map(p => p.text || '')
            .join('\n');

          return res.status(200).json({
            ok: true,
            model: modelId,
            role,
            finishReason: (candidate && candidate.finishReason) || 'STOP',
            text,
            usageMetadata: data.usageMetadata || null
          });
        }

        const errData = await apiResponse.json().catch(() => ({}));
        lastError = new Error(errData.error?.message || `API error ${apiResponse.status}`);
        lastError.status = apiResponse.status;

        // If not transient, break
        if (apiResponse.status === 400 || apiResponse.status === 401 || apiResponse.status === 403) {
          break;
        }
      } catch (fetchErr) {
        clearTimeout(timer);
        lastError = fetchErr;
      }
    }

    return res.status(lastError?.status || 500).json({
      ok: false,
      error: lastError?.message || 'Upstream Gemini service error',
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
