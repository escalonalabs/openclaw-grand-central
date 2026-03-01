'use strict';

const crypto = require('node:crypto');

/**
 * Assumptions:
 * - This module is framework-agnostic and can be used with Express-style
 *   middleware signatures (`req`, `res`, `next`).
 * - Token provisioning and policy wiring are handled by the caller.
 * - No runtime integration is performed in this repository yet.
 */

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key)/i;

function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string') {
    return '';
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value && typeof value === 'object') {
    const cloned = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      cloned[key] = cloneValue(nestedValue);
    }
    return cloned;
  }

  return value;
}

function defaultRedactHook(event) {
  const working = cloneValue(event);

  function walk(node) {
    if (!node || typeof node !== 'object') {
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        node[key] = '[REDACTED]';
        continue;
      }

      if (value && typeof value === 'object') {
        walk(value);
      }
    }
  }

  walk(working);
  return working;
}

function noopAuditHook() {}

function createSecurityGuardrails(options = {}) {
  const {
    tokenResolver = () => process.env.OPENCLAW_BRIDGE_TOKEN || '',
    redactHook = defaultRedactHook,
    auditHook = noopAuditHook,
  } = options;

  function authTokenMiddleware(req, res, next) {
    const expectedToken = tokenResolver(req);
    const providedToken = extractBearerToken(req?.headers?.authorization);

    if (!expectedToken) {
      auditHook({
        control: 'authn',
        decision: 'deny',
        reason: 'token_not_configured',
      });

      res.statusCode = 503;
      res.end('Bridge auth token is not configured');
      return;
    }

    if (!providedToken || !timingSafeCompare(providedToken, expectedToken)) {
      auditHook({
        control: 'authn',
        decision: 'deny',
        reason: 'invalid_or_missing_token',
      });

      res.statusCode = 401;
      res.end('Unauthorized');
      return;
    }

    req.securityContext = {
      authenticated: true,
      authScheme: 'bearer',
    };

    auditHook({
      control: 'authn',
      decision: 'allow',
      reason: 'token_valid',
    });

    next();
  }

  function redactEvent(event, context = {}) {
    try {
      const redacted = redactHook(event, context);

      auditHook({
        control: 'redaction',
        decision: 'applied',
        reason: 'ok',
        eventType: event?.event_type || 'unknown',
      });

      return redacted;
    } catch (error) {
      auditHook({
        control: 'redaction',
        decision: 'deny',
        reason: 'hook_error',
        error: error instanceof Error ? error.message : String(error),
      });

      return null;
    }
  }

  return {
    authTokenMiddleware,
    redactEvent,
  };
}

module.exports = {
  createSecurityGuardrails,
  extractBearerToken,
  defaultRedactHook,
};
