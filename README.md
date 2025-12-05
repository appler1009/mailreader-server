# Gmail Push Notification Lambda

This Lambda function handles Gmail pub/sub notifications and device management using AWS Lambda Function URLs for direct HTTPS access.

**All endpoints via Lambda Function URL** - Both device management and Gmail notifications use HTTP requests through Lambda Function URLs

## Features

- **Device Registration/Unregistration**: Register and unregister iOS device tokens via ALB endpoints
- **Gmail Pub/Sub Integration**: Process Gmail notifications sent via ALB webhook
- **Apple Push Notifications**: Send notifications using APNS token-based authentication
- **Multi-Device Support**: One email can have multiple registered devices
- **Error Handling**: Comprehensive error handling and logging

## Architecture

```
Gmail → Pub/Sub → Lambda Function URL → Lambda → APNS → iOS Devices
                        ↑                           │
                        │                           │
                 (Webhook Endpoint)        (Handler Routing)
                        │
                        │
        Lambda Function URL → Lambda (Device Registration/Unregistration)
```

**Environments:**
- **Dev**: `gmail-push-dev-lambda` - Uses APNS sandbox for testing
- **Prod**: `gmail-push-prod-lambda` - Uses APNS production for live notifications

## How It Works

### All Endpoints via Lambda Function URL
- **Client → Lambda Function URL → Lambda** - Both device management and Gmail notifications via Function URL
- **Device Management**: `/device` (POST = register, DELETE = unregister)
- **Gmail Notifications**: `/gmail-notification` (POST) - Receives Pub/Sub push messages
- **Event Structure**: Function URL events with `httpMethod` and `path` properties
- **Lambda auto-detects** which handler to use based on request path
- **APNS Environment**: Automatically uses sandbox for dev, production for prod

### Event Detection Logic
The Lambda function automatically determines the request type:
- **Path `/device`** → Device management handler
- **Path `/gmail-notification`** → Gmail notification handler

## Environment Variables

Configure these environment variables in the Lambda function:

| Variable | Description | Required |
|----------|-------------|----------|
| `DYNAMODB_TABLE_NAME` | Name of DynamoDB table for device storage | Yes |
| `APNS_TEAM_ID` | Apple Developer Team ID | Yes |
| `APNS_KEY_ID` | Apple Push Notification service Key ID | Yes |
| `APNS_SECRET_NAME` | Name of AWS Secrets Manager secret containing the P8 private key | Yes |
| `APNS_BUNDLE_ID` | iOS App Bundle ID (e.g., com.yourcompany.app) | Yes |
| `ENVIRONMENT` | Environment (dev/prod) - auto-configures APNS endpoint | Yes |

## Environments

The Lambda function automatically configures APNS endpoints based on the `ENVIRONMENT` variable:

- **dev**: Uses APNS sandbox (`api.sandbox.push.apple.com`) for testing
- **prod**: Uses APNS production (`api.push.apple.com`) for live notifications

**Function Names:**
- Dev: `gmail-push-dev-lambda`
- Prod: `gmail-push-prod-lambda`

**DynamoDB Tables:**
- Dev: `gmail-push-dev-devices`
- Prod: `gmail-push-prod-devices`

## DynamoDB Table Schema

Create a DynamoDB table with the following configuration:

- **Table Name**: Set via `DYNAMODB_TABLE_NAME` environment variable
- **Partition Key**: `email` (String) - The user's Gmail address
- **Sort Key**: `deviceToken` (String) - The iOS device push token
- **Additional Attributes**:
  - `registeredAt` (String) - ISO 8601 timestamp
  - `lastActive` (String) - ISO 8601 timestamp

## API Endpoints

All endpoints use Lambda Function URLs with direct HTTPS access.

### Device Management
- **Method**: `POST` (register) / `DELETE` (unregister)
- **Path**: `/device`
- **Headers**: `Content-Type: application/json`
- **Body**:
```json
{
  "email": "user@gmail.com",
  "deviceToken": "device_push_token_here"
}
```

### Gmail Notifications
- **Method**: `POST`
- **Path**: `/gmail-notification`
- **Purpose**: Receives Gmail pub/sub push messages from Google Cloud Pub/Sub
- **Authentication**: Function URL with public access
- **Event Format**: Pub/Sub push message JSON

### Endpoint Summary
- **Device Management**: `https://[function-id].lambda-url.[region].on.aws/device`
- **Gmail Notifications**: `https://[function-id].lambda-url.[region].on.aws/gmail-notification`

## Deployment

### Automated Deployment (Recommended)

This project uses GitHub Actions for automated deployment to multiple environments:

- **Dev Environment**: Push to `dev` branch → deploys `gmail-push-dev-lambda`
- **Prod Environment**: Push to `main` branch → deploys `gmail-push-prod-lambda`
- **Manual Deployment**: Use GitHub Actions workflow dispatch to choose environment

**Prerequisites:**
1. Set up AWS credentials in GitHub repository secrets
2. Configure APNs keys and environment variables
3. Push to appropriate branch to trigger deployment

### Manual CloudFormation Deployment

For manual deployment to a specific environment:

```bash
# Deploy DynamoDB and Lambda for dev environment
aws cloudformation deploy \
  --template-file infrastructure/dynamodb.yml \
  --stack-name gmail-push-dev-infrastructure \
  --parameter-overrides Environment=dev \
  --capabilities CAPABILITY_IAM

aws cloudformation deploy \
  --template-file infrastructure/lambda.yml \
  --stack-name gmail-push-dev-lambda \
  --parameter-overrides Environment=dev DynamoDBTableName=gmail-push-dev-devices \
  --capabilities CAPABILITY_IAM

# Get the Function URL
aws lambda get-function-url-config --function-name gmail-push-dev-lambda
```

### 3. Set up Gmail and Pub/Sub

1. **Gmail API Setup**:
   - Enable Gmail API in Google Cloud Console
   - Create service account with Gmail API access

2. **Pub/Sub Setup**:
   ```bash
   # Create topic
   gcloud pubsub topics create gmail-notifications

   # Create subscriptions for each environment
   # Dev subscription
   gcloud pubsub subscriptions create gmail-dev-sub \
     --topic gmail-notifications \
     --push-endpoint=https://[dev-function-url]/gmail-notification

   # Prod subscription
   gcloud pubsub subscriptions create gmail-prod-sub \
     --topic gmail-notifications \
     --push-endpoint=https://[prod-function-url]/gmail-notification
   ```

3. **Configure Gmail Watch**:
   ```bash
   curl -X POST \
     "https://gmail.googleapis.com/gmail/v1/users/me/watch" \
     -H "Authorization: Bearer $(oauth-token)" \
     -H "Content-Type: application/json" \
     -d '{
       "topicName": "projects/YOUR_PROJECT/topics/gmail-notifications",
       "labelIds": ["INBOX"],
       "labelFilterAction": "include"
     }'
   ```

### 4. Configure Permissions

Ensure your Lambda execution role has the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT:table/DeviceNotifications"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:REGION:ACCOUNT:*"
    }
  ]
}
```

## Testing

### Get Function URLs
```bash
# Dev environment
aws lambda get-function-url-config --function-name gmail-push-dev-lambda

# Prod environment
aws lambda get-function-url-config --function-name gmail-push-prod-lambda
```

### Test Device Registration
```bash
curl -X POST https://[function-id].lambda-url.[region].on.aws/device \
  -H "Content-Type: application/json" \
  -d '{"email":"test@gmail.com","deviceToken":"test_device_token"}'
```

### Test Device Unregistration
```bash
curl -X DELETE https://[function-id].lambda-url.[region].on.aws/device \
  -H "Content-Type: application/json" \
  -d '{"email":"test@gmail.com","deviceToken":"test_device_token"}'
```

### Test Gmail Notification Endpoint
```bash
curl -X POST https://[function-id].lambda-url.[region].on.aws/gmail-notification \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "eyJlbWFpbCI6InRlc3RAZ21haWwuY29tIiwiaGlzdG9yeUlkIjoiMTIzNDU2Nzg5MTIzNDU2Nzg5In0="
    }
  }'
```

**Note**: The `data` field should be base64-encoded JSON containing:
```json
{
  "email": "test@gmail.com",
  "historyId": "123456789123456789"
}
```

## Error Handling

The Lambda function handles various error scenarios:

- **Invalid Requests**: Returns 400 status for malformed requests
- **Missing Environment Variables**: Throws configuration errors
- **APNS Failures**: Logs failed notifications and continues processing
- **DynamoDB Errors**: Proper error handling with detailed logging
- **Gmail Message Parse Errors**: Validates and handles malformed pub/sub messages

## Monitoring

Monitor the function using:
- **CloudWatch Logs**: Check function logs for APNS delivery status
- **CloudWatch Metrics**: Monitor invocation count, duration, and errors
- **APNS Feedback Service**: Monitor for invalid device tokens

## Security Considerations

- APNS private keys are securely stored in AWS Secrets Manager with automatic encryption
- Lambda Function URLs provide HTTPS automatically
- Function URLs are publicly accessible - implement application-level authentication if needed
- Regular rotation of APNS keys
- Monitor for unusual notification patterns
- Use separate APNs keys for dev/prod environments stored in environment-specific secrets

## Troubleshooting

### Common Issues

1. **APNS Authentication Fails**
   - Verify Team ID, Key ID, and Private Key are correct
   - Ensure private key format is correct (include `\n` for newlines)

2. **No Notifications Received**
   - Check device token validity
   - Verify APNS certificate/key configuration
   - Check iOS app push notification permissions

3. **DynamoDB Errors**
   - Verify table exists with correct schema
   - Check IAM permissions
   - Confirm environment variables are set

4. **Gmail Notifications Not Processing**
   - Verify Pub/Sub push subscription points to correct Function URL
   - Check Function URL is accessible and returns 200 for test requests
   - Review Lambda function logs for parsing errors
   - Ensure Function URL has public access (AuthType: NONE)