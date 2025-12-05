# Deployment Guide

This guide covers how to deploy the Gmail Push Notification Lambda using the provided GitHub Actions workflow.

## Prerequisites

### 1. AWS Account Setup
- AWS account with appropriate permissions
- AWS CLI configured locally (for testing)
- GitHub repository with this code

### 2. Required GitHub Secrets
Configure these secrets in your GitHub repository:

```
AWS_ACCESS_KEY_ID=<your-aws-access-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-key>
AWS_REGION=<aws-region>
APNS_TEAM_ID=<your-apple-team-id>
APNS_KEY_ID=<your-apns-key-id>
APNS_BUNDLE_ID=<your-ios-bundle-id>
```

### 3. IAM Permissions
The AWS credentials need these permissions:
- `cloudformation:*`
- `lambda:*`
- `apigateway:*`
- `dynamodb:*`
- `iam:*`
- `logs:*`
- `secretsmanager:*`

## Deployment Methods

### Method 1: Manual Trigger (Recommended)

1. Go to your GitHub repository
2. Click on **Actions** tab
3. Select **Deploy Gmail Push Notification Lambda** workflow
4. Click **Run workflow**
5. Choose environment (dev/staging/prod)
6. Click **Run workflow**

### Method 2: Automatic Deployment
The workflow will automatically run when code is pushed to the `main` branch, deploying to `dev` environment.

## Infrastructure Created

The deployment creates these AWS resources:

### DynamoDB
- **Table**: `gmail-push-{environment}-devices`
- **Schema**: email (HASH), deviceToken (RANGE)
- **Features**: Point-in-time recovery, encryption, TTL support

### Lambda Function
- **Function**: `gmail-push-{environment}-lambda`
- **Runtime**: Node.js 20.x
- **Memory**: 192 MB
- **Timeout**: 30 seconds
- **Role**: IAM role with DynamoDB, CloudWatch, and Secrets Manager access
- **Permissions**: Function URL allows public access

### Lambda Function URL
The deployment automatically creates a Lambda Function URL for HTTPS access:
- **URL**: `https://{function-id}.lambda-url.{region}.on.aws`
- **Authentication**: None (public access)
- **CORS**: Enabled for all origins
- **Supported Methods**: GET, POST, DELETE, OPTIONS

## Post-Deployment Configuration

### 1. Create APNS Secrets in AWS Secrets Manager
Create secrets for your APNS private keys using hierarchical naming:

```bash
# For dev environment
aws secretsmanager create-secret \
  --name dev/mailreader/apns/private-key \
  --description "APNS private key for mailreader development environment" \
  --secret-string "<your-dev-apns-private-key-content>"

# For prod environment
aws secretsmanager create-secret \
  --name prod/mailreader/apns/private-key \
  --description "APNS private key for mailreader production environment" \
  --secret-string "<your-prod-apns-private-key-content>"
```

### 2. Environment Variables
Environment variables are automatically configured during deployment via CloudFormation parameters and GitHub secrets:

- `APNS_TEAM_ID`: Set from `APNS_TEAM_ID` GitHub secret
- `APNS_KEY_ID`: Set from `APNS_KEY_ID_DEV` or `APNS_KEY_ID_PROD` based on environment
- `APNS_BUNDLE_ID`: Set from `APNS_BUNDLE_ID` GitHub secret
- `APNS_SECRET_NAME`: Set automatically to `{environment}/mailreader/apns/private-key`

### 3. Function URL Access
The Lambda Function URL is created automatically and provides direct HTTPS access to your endpoints:
- `/device` → POST (register), DELETE (unregister)
- `/gmail-notification` → POST (Gmail notifications)

### 3. Gmail API Setup
- Enable Gmail API in Google Cloud Console
- Create Pub/Sub topic and subscription
- Configure Gmail watch notifications
- Set push endpoint to Function URL: `https://{function-id}.lambda-url.{region}.on.aws/gmail-notification`

## Deployment Verification

### Check Stack Status
```bash
aws cloudformation describe-stacks \
  --stack-name gmail-push-dev-infrastructure
```

### Test Lambda Function
```bash
# Get your Function URL
aws lambda get-function-url-config --function-name gmail-push-dev-lambda --query FunctionUrl --output text

# Test device registration
curl -X POST https://your-function-url/device \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","deviceToken":"test123"}'
```

### Test Gmail Endpoint
```bash
# Test Gmail notification endpoint
curl -X POST https://your-api-gateway-url/dev/gmail-notification \
  -H "Content-Type: application/json" \
  -d '{"message":{"data":"base64-encoded-data"}}'
```

## Rollback

To rollback a deployment:
```bash
aws cloudformation delete-stack \
  --stack-name gmail-push-{environment}-lambda
aws cloudformation delete-stack \
  --stack-name gmail-push-{environment}-infrastructure
aws cloudformation delete-stack \
  --stack-name gmail-push-{environment}-apigw
```

## Monitoring

### CloudWatch Logs
- Lambda function logs: `/aws/lambda/gmail-push-{environment}-lambda`
- API Gateway logs: Available in CloudWatch

### Metrics to Monitor
- Lambda invocation count and duration
- API Gateway request count and latency
- DynamoDB read/write capacity
- APNS delivery success rate

## Troubleshooting

### Common Issues

1. **Environment Variables Not Set**
    - Check Lambda console → Configuration → Environment variables
    - Verify GitHub secrets are configured correctly
    - Redeploy if environment variables are missing

2. **API Gateway 500 Errors**
   - Check Lambda function logs
   - Verify CloudFormation outputs

3. **DynamoDB Access Denied**
   - Verify IAM role permissions
   - Check table name matches environment variable

4. **APNS Authentication Failed**
   - Verify Team ID, Key ID, and Private Key
   - Ensure private key format includes proper line breaks

### Getting Help
- Check CloudWatch logs for detailed error messages
- Review API Gateway execution logs
- Test Lambda function with sample events