const jwt = require('jsonwebtoken');

/**
 * Per-user sliding window rate limiter with optional Redis backend for distributed systems.
 * Falls back to in-memory Map if Redis is not available.
 */

// In-memory store fallback
const memoryStore = new Map();

// Redis client (will be initialized if REDIS_URL is provided)
let redisClient = null;

// Initialize Redis client if URL is provided
if (process.env.REDIS_URL) {
  try {
    const redis = require('redis');
    redisClient = redis.createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => {
      console.error('Redis client error:', err);
      redisClient = null; // Fall back to memory store on error
    });
    redisClient.connect();
  } catch (error) {
    console.warn('Failed to initialize Redis client, falling back to memory store:', error.message);
  }
}

/**
 * Creates a per-user rate limiter middleware
 * @param {Object} options - Configuration options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum number of requests per window
 * @param {string} options.message - Error message when limit is exceeded
 * @param {string} options.code - Error code for API responses
 * @returns {Function} Express middleware
 */
function createRateLimitPerUser(options) {
  const {
    windowMs,
    max,
    message = 'Too many requests, try again later',
    code = 'rate_limited'
  } = options;

  return async (req, res, next) => {
    let userId = null;

    // Extract user ID from JWT token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        userId = payload.id;
      } catch {
        // Invalid token - continue without user ID (will use IP fallback)
      }
    }

    // Use user ID if available, otherwise fall back to IP
    const key = userId ? `user:${userId}` : `ip:${req.ip}`;
    const now = Date.now();

    try {
      let requestData;

      if (redisClient && redisClient.isOpen) {
        // Redis-backed sliding window
        const redisKey = `rate_limit:${key}`;
        const windowStart = now - windowMs;

        // Use Redis pipeline for atomic operations
        const pipeline = redisClient.multi();
        
        // Remove old entries outside the window
        pipeline.zRemRangeByScore(redisKey, 0, windowStart);
        
        // Add current request timestamp
        pipeline.zAdd(redisKey, { score: now, value: `req:${now}:${Math.random()}` });
        
        // Count requests in current window
        pipeline.zCard(redisKey);
        
        // Set expiry for the key
        pipeline.expire(redisKey, Math.ceil(windowMs / 1000) + 1);

        const results = await pipeline.exec();
        const requestCount = results[2][1]; // Third command result (zCard)

        requestData = {
          count: requestCount,
          resetTime: now + windowMs
        };
      } else {
        // In-memory sliding window fallback
        if (!memoryStore.has(key)) {
          memoryStore.set(key, { requests: [], resetTime: now + windowMs });
        }

        const userData = memoryStore.get(key);
        
        // Clean up old requests outside the window
        const windowStart = now - windowMs;
        userData.requests = userData.requests.filter(timestamp => timestamp > windowStart);
        
        // Add current request
        userData.requests.push(now);
        
        // Update reset time if needed
        if (now >= userData.resetTime) {
          userData.resetTime = now + windowMs;
        }

        requestData = {
          count: userData.requests.length,
          resetTime: userData.resetTime
        };
      }

      // Check if limit exceeded
      if (requestData.count > max) {
        const retryAfter = Math.ceil((requestData.resetTime - now) / 1000);
        
        res.set({
          'X-RateLimit-Limit': max,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': new Date(requestData.resetTime).toISOString(),
          'Retry-After': retryAfter
        });

        return res.status(429).json({
          success: false,
          error: message,
          code,
          retryAfter
        });
      }

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': Math.max(0, max - requestData.count),
        'X-RateLimit-Reset': new Date(requestData.resetTime).toISOString()
      });

      next();

    } catch (error) {
      console.error('Rate limiter error:', error);
      // On error, allow the request to proceed to avoid blocking legitimate traffic
      next();
    }
  };
}

// Cleanup function for graceful shutdown
function cleanup() {
  if (redisClient && redisClient.isOpen) {
    redisClient.quit();
  }
  memoryStore.clear();
}

// Cleanup on process termination
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

module.exports = {
  createRateLimitPerUser,
  cleanup,
  // Export for testing
  _getStore: () => ({ memory: memoryStore, redis: redisClient })
};