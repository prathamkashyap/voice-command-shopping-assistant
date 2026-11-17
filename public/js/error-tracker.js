const ERROR_QUEUE_KEY = 'voice_shopping_errors';
const MAX_QUEUE_SIZE = 50;
const FLUSH_INTERVAL = 30000; // 30 seconds

export class ErrorTracker {
  constructor(options = {}) {
    this.endpoint = options.endpoint || '/api/errors';
    this.enabled = options.enabled !== false;
    this.queue = [];
    this.flushTimer = null;
    this.sessionId = this.generateSessionId();
    this.userId = null;
    this.appVersion = '1.0.0';
    
    this.init();
  }

  init() {
    // Load queued errors from localStorage
    this.loadQueue();
    
    // Capture unhandled errors
    window.addEventListener('error', (event) => {
      this.captureException(event.error, {
        type: 'unhandled_error',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });

    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.captureException(event.reason, {
        type: 'unhandled_rejection'
      });
    });

    // Periodic flush
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL);
    
    // Flush on page unload
    window.addEventListener('beforeunload', () => this.flush(true));
    
    // Flush on visibility change (tab hidden)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flush();
      }
    });
  }

  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  setUserId(userId) {
    this.userId = userId;
  }

  captureException(error, context = {}) {
    if (!this.enabled) return;

    const errorData = {
      id: 'err_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      userId: this.userId,
      appVersion: this.appVersion,
      message: error?.message || String(error),
      stack: error?.stack || null,
      name: error?.name || 'Error',
      context: {
        ...context,
        url: window.location.href,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      }
    };

    this.queue.push(errorData);
    
    // Trim queue if too large
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue = this.queue.slice(-MAX_QUEUE_SIZE);
    }

    this.saveQueue();
    
    // Also log to console for debugging
    console.error('[ErrorTracker]', errorData.message, errorData);
  }

  captureMessage(message, level = 'info', context = {}) {
    if (!this.enabled) return;

    const logData = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      userId: this.userId,
      level,
      message,
      context: {
        ...context,
        url: window.location.href
      }
    };

    this.queue.push(logData);
    
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue = this.queue.slice(-MAX_QUEUE_SIZE);
    }

    this.saveQueue();
    
    // Log to console based on level
    console[level](`[ErrorTracker]`, message, context);
  }

  loadQueue() {
    try {
      const stored = localStorage.getItem(ERROR_QUEUE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[ErrorTracker] Failed to load queue:', e);
      this.queue = [];
    }
  }

  saveQueue() {
    try {
      localStorage.setItem(ERROR_QUEUE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.warn('[ErrorTracker] Failed to save queue:', e);
    }
  }

  async flush(sync = false) {
    if (!this.enabled || this.queue.length === 0) return;

    const payload = [...this.queue];
    this.queue = [];
    this.saveQueue();

    if (!this.enabled) return;

    try {
      if (sync && navigator.sendBeacon) {
        // Use sendBeacon for reliable delivery on page unload
        navigator.sendBeacon(this.endpoint, JSON.stringify({
          errors: payload,
          sessionId: this.sessionId,
          userId: this.userId
        }));
      } else {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            errors: payload,
            sessionId: this.sessionId,
            userId: this.userId
          })
        });
        if (!response.ok) {
          throw new Error(`Error reporting endpoint returned ${response.status}`);
        }
      }
    } catch (error) {
      console.warn('[ErrorTracker] Flush failed:', error);
      // Re-queue on failure
      this.queue.unshift(...payload);
      this.saveQueue();
    }
  }

  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush(true);
  }
}

// Global error tracker instance
export const errorTracker = new ErrorTracker({
  endpoint: '/api/errors', // Will need a Firebase Function to receive these
  enabled: true
});

// Convenience methods
export function captureException(error, context) {
  errorTracker.captureException(error, context);
}

export function captureMessage(message, level, context) {
  errorTracker.captureMessage(message, level, context);
}