# Agent Guidelines: Testing After Code Changes

## Overview
This document outlines the testing protocols that must be followed after any code modifications to ensure code quality and prevent regressions.

## Testing Requirements

### 1. Run Tests After Every Code Change
- **Mandatory**: Execute the full test suite using `npm test` after any code modification
- **Scope**: This applies to all changes including:
  - Feature additions
  - Bug fixes
  - Refactoring
  - Configuration changes
  - Dependency updates

### 2. Pre-Push Hook
- A Git pre-push hook is configured to automatically run tests before any push
- If tests fail, the push will be blocked
- Location: `.githooks/pre-push`
- Setup: Run `git config core.hooksPath .githooks` after cloning

### 3. Test Coverage
- All Lambda handler functions must be tested
- Error conditions and edge cases must be covered
- CORS headers and environment variables must be validated
- DynamoDB operations must be mocked and tested

### 4. Manual Testing Checklist
Before committing changes, verify:
- [ ] All unit tests pass (`npm test`)
- [ ] Code follows Function URL event format (no ALB compatibility)
- [ ] Logging is present for debugging
- [ ] Environment variables are properly handled
- [ ] Error responses include appropriate status codes

### 5. Integration Testing
- Test Lambda function deployment with actual AWS resources
- Verify Function URL accessibility
- Check CloudWatch logs for proper event handling
- Validate CORS behavior in production

## Failure Handling
If tests fail:
1. Do not commit or push failing code
2. Debug the failing tests
3. Fix the underlying issues
4. Re-run tests until they pass
5. Only then commit and push

## Benefits
- Prevents deployment of broken code
- Catches regressions early
- Maintains code reliability
- Ensures consistent behavior across environments

## Commands
```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch