/**
 * Jest setup file - runs before each test
 * 
 * This file suppresses console output during tests to provide cleaner test results
 * while still allowing tests to verify error handling behavior.
 */

// Suppress console.log and console.error during tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeEach(() => {
  // Mock console.log to prevent verbose output during tests
  console.log = jest.fn();
  
  // Mock console.error but keep some error messages for debugging
  console.error = jest.fn((message) => {
    // Only log critical errors that aren't from expected test scenarios
    if (!message.includes('Device request error') && 
        !message.includes('Gmail notification error') &&
        !message.includes('Failed to parse Gmail message')) {
      originalConsoleError(message);
    }
  });
});

afterEach(() => {
  // Restore original console methods after each test
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});