# Gmail Push Notification Lambda

This Lambda function handles Gmail pub/sub notifications and device management through a single invocation method:

**All endpoints via ALB** - Both device management and Gmail notifications use HTTP requests through Application Load Balancer

## Features

- **Device Registration/Unregistration**: Register and unregister iOS device tokens via ALB endpoints
- **Gmail Pub/Sub Integration**: Process Gmail notifications sent via ALB webhook
- **Apple Push Notifications**: Send notifications using APNS token-based authentication
- **Multi-Device Support**: One email can have multiple registered devices
- **Error Handling**: Comprehensive error handling and logging

## Architecture

```
Gmail → Pub/Sub → ALB → Lambda → APNS → iOS Devices
                   ↑                │
                   │                │
            (Webhook Endpoint) (Handler Routing)
                   │
                   │
        ALB → Lambda (Device Registration/Unregistration)
```

## How It Works

### All Endpoints via ALB
- **Client → ALB → Lambda** - Both device management and Gmail notifications via ALB
- **Device Management**: `/device` (POST = register, DELETE = unregister)
- **Gmail Notifications**: `/gmail-notification` (POST) - Receives Pub/Sub push messages
- **Event Structure**: ALB events with `httpMethod` and `path` properties
- **Lambda auto-detects** which handler to use based on request path

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
| `APNS_PRIVATE_KEY` | Apple Push Notification service Private Key (.p8 file content) | Yes |
| `APNS_BUNDLE_ID` | iOS App Bundle ID (e.g., com.yourcompany.app) | Yes |

## DynamoDB Table Schema

Create a DynamoDB table with the following configuration:

- **Table Name**: Set via `DYNAMODB_TABLE_NAME` environment variable
- **Partition Key**: `email` (String) - The user's Gmail address
- **Sort Key**: `deviceToken` (String) - The iOS device push token
- **Additional Attributes**:
  - `registeredAt` (String) - ISO 8601 timestamp
  - `lastActive` (String) - ISO 8601 timestamp

## API Endpoints

All endpoints use ALB (Application Load Balancer) with Lambda integration.

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
- **Authentication**: ALB with HTTPS
- **Event Format**: Pub/Sub push message JSON

### Endpoint Summary
- **Device Management**: `https://your-alb-domain/device`
- **Gmail Notifications**: `https://your-alb-domain/gmail-notification`

## Deployment

### 1. Create Lambda Function

```bash
aws lambda create-function \
  --function-name gmail-push-notifications \
  --runtime nodejs18.x \
  --role arn:aws:iam::ACCOUNT:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --environment Variables='{
    DYNAMODB_TABLE_NAME=DeviceNotifications,
    APNS_TEAM_ID=YOUR_TEAM_ID,
    APNS_KEY_ID=YOUR_KEY_ID,
    APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_CONTENT\n-----END PRIVATE KEY-----",
    APNS_BUNDLE_ID=com.yourcompany.app
  }'
```

### 2. Set up ALB (Application Load Balancer)

1. **Create Application Load Balancer**:
   ```bash
   aws elbv2 create-load-balancer \
     --name gmail-push-alb \
     --subnets subnet-12345 subnet-67890 \
     --security-groups sg-12345678
   ```

2. **Create Target Group**:
   ```bash
   aws elbv2 create-target-group \
     --name gmail-push-targets \
     --protocol HTTP \
     --port 80 \
     --vpc-id vpc-12345678 \
     --target-type lambda \
     --targets Id=gmail-push-lambda-arn
   ```

3. **Create Listener Rules**:
   ```bash
   # Device management
   aws elbv2 create-rule \
     --listener-arn listener-arn \
     --priority 100 \
     --conditions Field=path-pattern,Values=/device \
     --actions Type=forward,TargetGroupArn=target-group-arn
   
   # Gmail notifications  
   aws elbv2 create-rule \
     --listener-arn listener-arn \
     --priority 200 \
     --conditions Field=path-pattern,Values=/gmail-notification \
     --actions Type=forward,TargetGroupArn=target-group-arn
   ```

### 3. Set up Gmail and Pub/Sub

1. **Gmail API Setup**:
   - Enable Gmail API in Google Cloud Console
   - Create service account with Gmail API access

2. **Pub/Sub Setup**:
   ```bash
   # Create topic
   gcloud pubsub topics create gmail-notifications
   
   # Create subscription pointing to ALB
   gcloud pubsub subscriptions create gmail-push-sub \
     --topic gmail-notifications \
     --push-endpoint=https://your-alb-domain/gmail-notification \
     --push-auth-token=optional-auth-token
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

### Test Device Registration
```bash
curl -X POST https://your-alb-domain/device \
  -H "Content-Type: application/json" \
  -d '{"email":"test@gmail.com","deviceToken":"test_device_token"}'
```

### Test Device Unregistration
```bash
curl -X DELETE https://your-alb-domain/device \
  -H "Content-Type: application/json" \
  -d '{"email":"test@gmail.com","deviceToken":"test_device_token"}'
```

### Test Gmail Notification Endpoint
```bash
curl -X POST https://your-alb-domain/gmail-notification \
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

- Store APNS private key securely in AWS Secrets Manager or Parameter Store
- Use HTTPS for all API endpoints
- Implement authentication for device registration endpoints if needed
- Regular rotation of APNS keys
- Monitor for unusual notification patterns

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
   - Verify ALB listener rules are configured correctly
   - Check Pub/Sub push subscription configuration
   - Review Lambda function logs for parsing errors
   - Ensure ALB can invoke Lambda function