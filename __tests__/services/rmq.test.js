import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import RmqService from '../../dist/services/rmq.js';

// Mock the rascal module first
vi.mock('rascal', () => ({
  default: {
    BrokerAsPromised: {
      create: vi.fn()
    }
  }
}));

const mockPublication = {
  on: vi.fn()
};

const mockBrokerInstance = {
  publish: vi.fn().mockResolvedValue(mockPublication),
  on: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined)
};

// Get the mocked module
const rascal = await import('rascal');
const mockBroker = rascal.default.BrokerAsPromised;

const mockEventService = {
  subscribe: vi.fn((event, handler) => {
    // Store the handler for testing
    mockEventService.handlers = mockEventService.handlers || {};
    mockEventService.handlers[event] = handler;
  }),
  unsubscribe: vi.fn(),
  // Add handlers storage
  handlers: {}
};

const mockApp = {
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  },
  diContainer: {
    resolve: vi.fn(() => mockEventService)
  }
};

const sampleTransformers = {
  'test.event': {
    transformer: vi.fn().mockImplementation(async (payload) => ({ ...payload, transformed: true })),
    routingKey: 'test.route'
  }
};

describe('RmqService', () => {
  let rmqService;
  let pluginSettings;
  let originalMaxListeners;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    
    // Increase max listeners to avoid warning
    originalMaxListeners = process.getMaxListeners();
    process.setMaxListeners(20);

    pluginSettings = {
      connection: {
        vhosts: {
          '/': {
            connection: {
              url: 'amqp://localhost'
            },
            exchanges: ['test-exchange'],
            queues: ['test-queue'],
            bindings: []
          }
        }
      },
      pubTransformers: sampleTransformers
    };

    // Mock successful connection by default
    mockBroker.create.mockResolvedValue(mockBrokerInstance);
  });

  afterEach(async () => {
    if (rmqService) {
      await rmqService.close();
    }
    // Restore original max listeners
    process.setMaxListeners(originalMaxListeners);
    // Clear handlers
    mockEventService.handlers = {};
  });

  describe('initialization', () => {
    it('should initialize with correct settings', async () => {
      // Mock a failed connection for this test
      mockBroker.create.mockRejectedValueOnce(new Error('Connection failed'));
      
      rmqService = new RmqService(mockApp, pluginSettings);
      // Wait for init to complete
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(rmqService).toBeDefined();
      expect(rmqService.connected).toBe(false);
      expect(typeof rmqService.connect).toBe('function');
      expect(typeof rmqService.publishMessage).toBe('function');
    });

    it('should setup event subscriptions during initialization', async () => {
      rmqService = new RmqService(mockApp, pluginSettings);
      // Wait for init to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockEventService.subscribe).toHaveBeenCalledTimes(Object.keys(sampleTransformers).length);
      expect(mockEventService.subscribe).toHaveBeenCalledWith('test.event', expect.any(Function));
    });
  });

  describe('connection management', () => {
    it('should connect successfully', async () => {
      rmqService = new RmqService(mockApp, pluginSettings);
      // Wait for init to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(rmqService.connected).toBe(true);
      expect(mockBroker.create).toHaveBeenCalledTimes(1);
      expect(mockBroker.create).toHaveBeenCalledWith(pluginSettings.connection);
    });

    it('should not reconnect if already connected', async () => {
      rmqService = new RmqService(mockApp, pluginSettings);
      // Wait for init to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Clear mock calls
      mockBroker.create.mockClear();
      
      // Try to connect again
      await rmqService.connect();
      
      expect(mockBroker.create).not.toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      mockBroker.create.mockRejectedValueOnce(error);

      rmqService = new RmqService(mockApp, pluginSettings);
      // Wait for init to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(rmqService.connected).toBe(false);
      expect(mockApp.log.error).toHaveBeenCalledWith(expect.stringContaining('Error connecting to RabbitMQ'));
    });
  });

  describe('message publishing', () => {
    beforeEach(async () => {
      rmqService = new RmqService(mockApp, pluginSettings);
      // Wait for init to complete
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    it('should publish messages successfully', async () => {
      const message = { test: 'data' };
      await rmqService.publishMessage('test.route', message);

      expect(mockBrokerInstance.publish).toHaveBeenCalledTimes(1);
      expect(mockBrokerInstance.publish).toHaveBeenCalledWith('test.route', message);
    });

    it('should handle publish errors', async () => {
      const error = new Error('Publish failed');
      mockBrokerInstance.publish.mockRejectedValueOnce(error);

      await rmqService.publishMessage('test.route', { test: 'data' });
      
      expect(mockApp.log.error).toHaveBeenCalledWith(error);
    });
  });

  describe('event payload transformation', () => {
    beforeEach(async () => {
      rmqService = new RmqService(mockApp, pluginSettings);
      // Wait for init to complete
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    it('should transform messages before publishing', async () => {
      const handler = mockEventService.handlers['test.event'];
      expect(handler).toBeDefined();

      await handler({ data: { test: 'data' } });

      expect(sampleTransformers['test.event'].transformer).toHaveBeenCalled();
      expect(mockBrokerInstance.publish).toHaveBeenCalled();
      const publishCall = mockBrokerInstance.publish.mock.calls[0];
      const publishedData = publishCall[1];
      expect(publishedData.transformed).toBe(true);
    });

    it('should handle transformer errors', async () => {
      const error = new Error('Transform failed');
      sampleTransformers['test.event'].transformer.mockRejectedValueOnce(error);

      const handler = mockEventService.handlers['test.event'];
      expect(handler).toBeDefined();
      await handler({ data: { test: 'data' } });

      expect(mockApp.log.error).toHaveBeenCalledWith(expect.stringContaining('Error transforming payload'));
    });

    it('should handle null/undefined transformer results', async () => {
      sampleTransformers['test.event'].transformer.mockResolvedValueOnce(null);

      const handler = mockEventService.handlers['test.event'];
      expect(handler).toBeDefined();
      await handler({ data: { test: 'data' } });

      expect(mockBrokerInstance.publish).not.toHaveBeenCalled();
    });
  });

  describe('shutdown handling', () => {
    beforeEach(async () => {
      rmqService = new RmqService(mockApp, pluginSettings);
      // Wait for init to complete
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    it('should clean up connections on shutdown', async () => {
      await rmqService.close();
      
      expect(mockBrokerInstance.shutdown).toHaveBeenCalledTimes(1);
      expect(rmqService.connected).toBe(false);
      expect(rmqService.broker).toBeNull();
    });

    it('should handle shutdown when not connected', async () => {
      // Mock a failed connection
      mockBroker.create.mockRejectedValueOnce(new Error('Connection failed'));
      
      rmqService = new RmqService(mockApp, pluginSettings);
      // Wait for init to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      await rmqService.close();
      expect(rmqService.connected).toBe(false);
    });
  });
}); 