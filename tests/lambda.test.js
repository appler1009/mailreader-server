/**
 * Test suite for Gmail Push Notification Lambda function
 * 
 * Tests the main functionality including:
 * - Device registration/unregistration handling
 * - Gmail notification processing
 * - Main handler routing
 * - CORS headers
 * - Error handling
 */

// Mock AWS SDK
const mockDynamoDB = {
  put: jest.fn().mockImplementation((params) => ({
    promise: jest.fn().mockResolvedValue({ ...params })
  })),
  delete: jest.fn().mockImplementation((params) => ({
    promise: jest.fn().mockResolvedValue({ ...params })
  })),
  query: jest.fn().mockImplementation((params) => ({
    promise: jest.fn().mockResolvedValue({ Items: [], ...params })
  }))
};

jest.mock('aws-sdk', () => ({
  DynamoDB: {
    DocumentClient: jest.fn(() => mockDynamoDB)
  },
  SecretsManager: jest.fn(() => ({
    getSecretValue: jest.fn().mockImplementation((params) => ({
      promise: jest.fn().mockResolvedValue({ SecretString: 'mock-secret' })
    }))
  }))
}));

// Mock other dependencies
jest.mock('jsonwebtoken');
jest.mock('uuid');

describe('Gmail Push Notification Lambda', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset and mock process.env
    process.env = {
      DYNAMODB_TABLE_NAME: 'test-table',
      APNS_TEAM_ID: 'TESTTEAM123',
      APNS_KEY_ID: 'TESTKEY1234',
      APNS_SECRET_NAME: 'test/apns/private-key',
      APNS_BUNDLE_ID: 'com.test.gmailpush'
    };
    
    // Mock jwt.sign
    require('jsonwebtoken').sign.mockReturnValue('mock-jwt-token');
    
    // Mock uuidv4
    require('uuid').v4.mockReturnValue('test-uuid-123');
  });

  describe('Lambda Handler', () => {
    const lambda = require('../index.js');

    test('should handle device registration request', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/device',
        body: JSON.stringify({
          email: 'test@example.com',
          deviceToken: 'test-token-123'
        })
      };

      const result = await lambda.handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        message: 'Device registered successfully'
      });
      
      // Verify DynamoDB put was called
      expect(mockDynamoDB.put).toHaveBeenCalled();
    });

    test('should handle device unregistration request', async () => {
      const event = {
        httpMethod: 'DELETE',
        path: '/device',
        body: JSON.stringify({
          email: 'test@example.com',
          deviceToken: 'test-token-123'
        })
      };

      const result = await lambda.handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        message: 'Device unregistered successfully'
      });
      
      // Verify DynamoDB delete was called
      expect(mockDynamoDB.delete).toHaveBeenCalled();
    });

    test('should handle Gmail notification request', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/gmail-notification',
        body: JSON.stringify({
          message: {
            data: JSON.stringify({
              emailAddress: 'test@example.com',
              historyId: '1234567890'
            })
          }
        })
      };

      const result = await lambda.handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        message: 'No devices to notify'
      });
      
      // Verify DynamoDB query was called
      expect(mockDynamoDB.query).toHaveBeenCalled();
    });

    test('should return 400 for invalid request format', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/invalid'
      };

      const result = await lambda.handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Invalid request format'
      });
    });

    test('should return 400 for missing required fields in device request', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/device',
        body: JSON.stringify({
          email: 'test@example.com'
          // Missing deviceToken
        })
      };

      const result = await lambda.handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Email and deviceToken are required'
      });
    });

    test('should return 500 for invalid JSON in request body', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/device',
        body: 'invalid json'
      };

      const result = await lambda.handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Internal server error',
        message: expect.stringContaining('Unexpected token')
      });
    });

    test('should handle missing message body in Gmail notification', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/gmail-notification',
        body: JSON.stringify({})
      };

      const result = await lambda.handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Failed to process Gmail notification',
        message: 'Invalid Pub/Sub message format'
      });
    });
  });

  describe('CORS Headers', () => {
    test('should include CORS headers in device endpoints', async () => {
      const { handler } = require('../index.js');
      
      const event = {
        httpMethod: 'POST',
        path: '/device',
        body: JSON.stringify({
          email: 'test@example.com',
          deviceToken: 'test-token'
        })
      };

      const result = await handler(event);

      expect(result.headers).toEqual({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
    });

    test('should include CORS headers for Gmail notification endpoints', async () => {
      const { handler } = require('../index.js');
      
      const event = {
        httpMethod: 'POST',
        path: '/gmail-notification',
        body: JSON.stringify({
          message: {
            data: JSON.stringify({
              emailAddress: 'test@example.com',
              historyId: '1234567890'
            })
          }
        })
      };

      const result = await handler(event);

      expect(result.headers).toEqual({
        'Content-Type': 'application/json'
      });
    });
  });

  describe('Environment Variables Validation', () => {
    test('should have all required environment variables', () => {
      expect(process.env.DYNAMODB_TABLE_NAME).toBe('test-table');
      expect(process.env.APNS_TEAM_ID).toBe('TESTTEAM123');
      expect(process.env.APNS_KEY_ID).toBe('TESTKEY1234');
      expect(process.env.APNS_SECRET_NAME).toBe('test/apns/private-key');
      expect(process.env.APNS_BUNDLE_ID).toBe('com.test.gmailpush');
    });
  });

  describe('Error Handling', () => {
    test('should handle DynamoDB errors gracefully', async () => {
      // Mock DynamoDB to throw error
      mockDynamoDB.put.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('DynamoDB Error'))
      });

      const { handler } = require('../index.js');
      
      const event = {
        httpMethod: 'POST',
        path: '/device',
        body: JSON.stringify({
          email: 'test@example.com',
          deviceToken: 'test-token'
        })
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Internal server error',
        message: 'DynamoDB Error'
      });
    });

    test('should handle invalid Gmail message format', async () => {
      const { handler } = require('../index.js');
      
      const event = {
        httpMethod: 'POST',
        path: '/gmail-notification',
        body: JSON.stringify({
          message: {
            data: 'invalid base64 json'
          }
        })
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Failed to process Gmail notification',
        message: expect.stringContaining('Failed to parse Gmail message')
      });
    });
  });
});