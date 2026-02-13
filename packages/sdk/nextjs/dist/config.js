'use strict';

// src/config.ts
function getEnvConfig() {
  const config = {};
  const apiKey = process.env.BUGWATCH_API_KEY || process.env.NEXT_PUBLIC_BUGWATCH_API_KEY;
  if (apiKey) config.apiKey = apiKey;
  const environment = process.env.BUGWATCH_ENVIRONMENT || process.env.NEXT_PUBLIC_BUGWATCH_ENVIRONMENT;
  if (environment) config.environment = environment;
  const release = process.env.BUGWATCH_RELEASE || process.env.NEXT_PUBLIC_BUGWATCH_RELEASE;
  if (release) config.release = release;
  const debug = process.env.BUGWATCH_DEBUG || process.env.NEXT_PUBLIC_BUGWATCH_DEBUG;
  if (debug === "true") config.debug = true;
  const endpoint = process.env.BUGWATCH_ENDPOINT || process.env.NEXT_PUBLIC_BUGWATCH_ENDPOINT;
  if (endpoint) config.endpoint = endpoint;
  return config;
}
function hasApiKey() {
  return Boolean(process.env.BUGWATCH_API_KEY || process.env.NEXT_PUBLIC_BUGWATCH_API_KEY);
}

exports.getEnvConfig = getEnvConfig;
exports.hasApiKey = hasApiKey;
//# sourceMappingURL=config.js.map
//# sourceMappingURL=config.js.map