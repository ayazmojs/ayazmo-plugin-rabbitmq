import { jest } from '@jest/globals';

export const mockPublication = {
  on: jest.fn()
};

const mockBrokerInstance = {
  publish: jest.fn().mockResolvedValue(mockPublication),
  on: jest.fn(),
  shutdown: jest.fn().mockResolvedValue(undefined)
};

export const mockBroker = {
  create: jest.fn().mockResolvedValue(mockBrokerInstance)
};

export const mockEventService = {
  subscribe: jest.fn((event, handler) => {
    // Store the handler for testing
    mockEventService.handlers = mockEventService.handlers || {};
    mockEventService.handlers[event] = handler;
  }),
  unsubscribe: jest.fn(),
  // Add handlers storage
  handlers: {}
};

export const mockApp = {
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  },
  diContainer: {
    resolve: jest.fn(() => mockEventService)
  }
};

export const sampleTransformers = {
  'test.event': {
    transformer: jest.fn().mockImplementation(async (payload, app) => ({ ...payload, transformed: true })),
    routingKey: 'test.route'
  }
}; 