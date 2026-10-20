/**
 * Multimodal AI (MMA) — Serverless API Proxy for 3-Role Gemini Requests (`api/gemini.js`)
 * Keeps all three Gemini API credentials strictly in server-side environment variables
 * (`GEMINI_API_KEY_PLANNER`, `GEMINI_API_KEY_BUILDER`, `GEMINI_API_KEY_REVIEWER`),
 * preserves the configured Gemini Flash-Lite/Flash model chain, and redacts secrets.
 */

'use strict';

const ALLOWED_ROLES = new Set(['planner', 'builder', 'reviewer']);
const MODEL_ROTATION_CHAIN = Object.freeze([
  process.env.GEMINI_MODEL_ID || 'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
]);
const DEFAULT_MODEL = MODEL_ROTATION_CHAIN[0];
const MAX_BODY_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 20 * 1024 * 1024; // 20 MiB ceiling

function redactSecrets(text) {
  if (!text) return '';
  return String(text)
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/AQ\.[0-9A-Za-z\-_]{20,}/g, '[REDACTED_OAUTH_TOKEN]')
    .replace(/sk-[0-9A-Za-z\-_]{16,}/g, '[REDACTED_SECRET_KEY]')
    .replace(/ghp_[0-9A-Za-z]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]');
}

function getKeyForRole(role) {
  const normalized = String(role || 'planner').toLowerCase();
  const keys = {
    planner: process.env.GEMINI_API_KEY_PLANNER || process.env.GEMINI_KEY_PLANNER,
    builder: process.env.GEMINI_API_KEY_BUILDER || process.env.GEMINI_KEY_BUILDER,
    reviewer: process.env.GEMINI_API_KEY_REVIEWER || process.env.GEMINI_KEY_REVIEWER
  };
  return keys[normalized] || keys.planner || keys.builder || keys.reviewer || '';
}

async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-Role');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }));
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const rawSize = JSON.stringify(body).length;
    if (rawSize > MAX_BODY_BYTES) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, error: 'PAYLOAD_TOO_LARGE', maxBytes: MAX_BODY_BYTES }));
    }

    const role = String(body.role || 'planner').toLowerCase();
    if (!ALLOWED_ROLES.has(role)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_ROLE' }));
    }

    const apiKey = getKeyForRole(role);
    if (!apiKey || apiKey.includes('YOUR_')) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        ok: false,
        error: 'SERVER_CREDENTIALS_UNCONFIGURED',
        message: 'Configure GEMINI_API_KEY_PLANNER, GEMINI_API_KEY_BUILDER, and GEMINI_API_KEY_REVIEWER in your deployment environment variables.'
      }));
    }

    const modelId = body.modelId || DEFAULT_MODEL;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;

    const upstreamResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: body.systemInstruction,
        contents: body.contents,
        generationConfig: {
          temperature: typeof body.temperature === 'number' ? body.temperature : 0.3,
          maxOutputTokens: Math.min(Number(body.maxOutputTokens) || 8192, 65536)
        }
      })
    });

    const data = await upstreamResp.json().catch(() => ({}));
    if (!upstreamResp.ok) {
      res.statusCode = upstreamResp.status;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        ok: false,
        status: upstreamResp.status,
        error: redactSecrets(data?.error?.message || `UPSTREAM_HTTP_${upstreamResp.status}`)
      }));
    }

    const candidate = data?.candidates?.[0] || {};
    const text = (candidate?.content?.parts || []).map(p => p.text || '').join('\n');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      ok: true,
      role,
      model: modelId,
      finishReason: candidate.finishReason || 'STOP',
      usageMetadata: data.usageMetadata || null,
      text: redactSecrets(text)
    }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      ok: false,
      error: 'INTERNAL_PROXY_ERROR',
      message: redactSecrets(err.message)
    }));
  }
}

module.exports = handler;
module.exports.redactSecrets = redactSecrets;
module.exports.getKeyForRole = getKeyForRole;
module.exports.MODEL_ROTATION_CHAIN = MODEL_ROTATION_CHAIN;
