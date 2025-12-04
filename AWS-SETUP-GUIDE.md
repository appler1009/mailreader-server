To prepare AWS for your Lambda function, ALB (Application Load Balancer), and DynamoDB to work with GitHub Actions deployment, you'll need the following prerequisites and configurations. This is based on your project's infrastructure templates and deployment workflow.

## 1. AWS Account & Basic Setup

**Timing**: Done BEFORE deployment  
**Performed by**: You manually

- **AWS Account**: Active account with billing enabled
- **AWS Region**: Choose a region (e.g., us-east-1) and ensure all resources will be created there
- **AWS CLI**: Install and configure locally with `aws configure` for testing

## 2. IAM User for GitHub Actions

**Timing**: Done BEFORE deployment  
**Performed by**: You manually

Create an IAM user with programmatic access that GitHub Actions will use:

```bash
# Create the user
aws iam create-user --user-name github-actions-user

# Create custom policy with required permissions
cat > github-actions-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:*",
                "lambda:*",
                "dynamodb:*",
                "iam:*",
                "logs:*"
            ],
            "Resource": "*"
        }
    ]
}
EOF

aws iam create-policy --policy-name GitHubActionsPolicy --policy-document file://github-actions-policy.json

# Attach custom policy
aws iam attach-user-policy --user-name github-actions-user --policy-arn arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/GitHubActionsPolicy

# Create access keys
aws iam create-access-key --user-name github-actions-user
```

**Required Permissions** (covered by PowerUserAccess or grant individually):
- `cloudformation:*`
- `lambda:*`
- `dynamodb:*`
- `iam:*`
- `logs:*`

## 3. GitHub Repository Secrets

**Timing**: Done BEFORE deployment  
**Performed by**: You manually

Add these secrets in your GitHub repo (Settings → Secrets and variables → Actions):

| Secret Name | Value |
|-------------|--------|
| `AWS_ACCESS_KEY_ID` | Access key from the IAM user |
| `AWS_SECRET_ACCESS_KEY` | Secret key from the IAM user |
| `AWS_REGION` | Your chosen AWS region |

## 4. HTTPS Setup for Lambda Function URLs

**Timing**: Already completed  
**Status**: CloudFormation template has been updated with Lambda Function URL configuration

**You're absolutely correct!** Gmail pub/sub requires HTTPS endpoints. However, you don't need to buy your own domain name. Here's the recommended solution:

### Lambda Function URLs (Recommended)
**Easiest solution - AWS provides HTTPS automatically**

The CloudFormation template in `infrastructure/lambda.yml` has already been updated with the following configuration:

```yaml
LambdaFunction:
  Type: AWS::Lambda::Function
  Properties:
    # ... existing properties ...
    FunctionUrlConfig:
      Cors:
        AllowMethods:
          - GET
          - POST
          - DELETE
          - OPTIONS
        AllowHeaders:
          - Content-Type
        AllowOrigins:
          - '*'
        MaxAge: 86400
      AuthType: NONE  # No authentication required
```

**What's Already Configured:**
- **FunctionUrlConfig**: Added to LambdaFunction with CORS settings
- **LambdaFunctionUrlPermission**: Added for public function URL access
- **LambdaFunctionUrl Output**: Exported for easy reference

After deployment, you'll get an HTTPS URL like:
`https://{your-function-id}.lambda-url.{region}.on.aws`

### Configuration Details

The CloudFormation template includes:

1. **Lambda Function URL with CORS**:
```yaml
FunctionUrlConfig:
  Cors:
    AllowMethods: [GET, POST, DELETE, OPTIONS]
    AllowHeaders: [Content-Type]
    AllowOrigins: ['*']
    MaxAge: 86400
  AuthType: NONE
```

2. **Lambda Permission for URL Access**:
```yaml
LambdaFunctionUrlPermission:
  Type: AWS::Lambda::Permission
  Properties:
    FunctionName: !Ref LambdaFunction
    Action: lambda:InvokeFunctionUrl
    Principal: "*"
    SourceArn: "*"
```

3. **URL Export**:
```yaml
Outputs:
  LambdaFunctionUrl:
    Description: Lambda Function URL for HTTPS access
    Value: !GetAtt LambdaFunction.FunctionUrl
    Export:
      Name: !Sub ${AWS::StackName}-LambdaFunctionUrl
```

## 5. GitHub Actions Deployment

**Timing**: Done DURING deployment  
**Performed by**: GitHub Actions automatically

When you push to your main branch, GitHub Actions will automatically:
- Deploy DynamoDB table via CloudFormation
- Deploy Lambda function with Function URLs via CloudFormation
- Create all necessary IAM roles and permissions
- Set up log groups and monitoring

## 6. Post-Deployment Setup

**Timing**: Done AFTER deployment  
**Performed by**: You manually

Once the deployment completes, manually configure:

### Get Lambda Function URL
```bash
# Get your Lambda Function URL (created automatically by CloudFormation)
aws lambda get-function-url-config --function-name gmail-push-dev-lambda
```

The URL will look like: `https://abcdef1234567890.lambda-url.us-east-1.on.aws`

### Lambda Environment Variables
**Performed by**: You manually in Lambda console

**Authentication Method**: Token-based APNs (Modern approach using JWT tokens)

**What are APNs Tokens?**
Your application uses **token-based authentication** (not certificates) for Apple Push Notifications. This modern approach uses:
- **Team ID**: Your Apple Developer Team identifier
- **Key ID**: Your APNs Key identifier  
- **Private Key**: P8 key file for JWT token generation
- **Bundle ID**: Your app's unique identifier

This token-based approach is preferred over certificates because:
- No expiration dates (keys work indefinitely)
- Easier management and rotation
- More secure and modern

**Step-by-Step Instructions:**

1. **Access Lambda Console**
   - Go to [AWS Lambda Console](https://console.aws.amazon.com/lambda)
   - Navigate to Functions in the left sidebar
   - Find your function: `gmail-push-{environment}-lambda` (e.g., `gmail-push-dev-lambda`)

2. **Navigate to Configuration Tab**
   - Click on your Lambda function name
   - Click on the **"Configuration"** tab
   - In the left sidebar, click on **"Environment variables"**

3. **Add Each Environment Variable**
   
   **APNS_TEAM_ID** (Team ID):
   - Click **"Add environment variable"**
   - Key: `APNS_TEAM_ID`
   - Value: Your Apple Developer Team ID (10-character string from Apple Developer account)
   - Click **"Save"**
   - **Example**: `ABCDE12345`

   **APNS_KEY_ID** (Key ID):
   - Click **"Add environment variable"**
   - Key: `APNS_KEY_ID`
   - Value: Your APNs Key ID (10-character string from Apple Developer account)
   - Click **"Save"**
   - **Example**: `XYZXY123AB`

   **APNS_PRIVATE_KEY** (P8 Key):
   - Click **"Add environment variable"**
   - Key: `APNS_PRIVATE_KEY`
   - Value: Your APNs private key (P8 file content - include the full key with BEGIN/END lines)
   - Click **"Save"**
   - **Important**: Must include the complete P8 key content

   **APNS_BUNDLE_ID** (Bundle Identifier):
   - Click **"Add environment variable"**
   - Key: `APNS_BUNDLE_ID`
   - Value: Your app's bundle ID (must match your app's identifier)
   - Click **"Save"**
   - **Example**: `com.yourcompany.gmailpush`

4. **Save Changes**
   - Click **"Save"** at the top of the page to save all environment variables
   - Wait for the "Configuration updated" notification

**Where to Find APNs Token Credentials:**
1. **Apple Developer Account**: Sign in to [developer.apple.com](https://developer.apple.com)
2. **Team ID**: 
   - Account section → Membership details
   - Copy the "Team ID" (10 characters)
3. **Key ID and Private Key**:
   - Certificates, Identifiers & Profiles → Keys
   - Click **"+"** to create a new key
   - Name: "Gmail Push Notifications"
   - Key Services: Select **"Apple Push Notifications service (APNs)"**
   - Download the `.p8` key file immediately
   - Copy the Key ID (displayed in the key details)
4. **Bundle ID**:
   - Certificates, Identifiers & Profiles → Identifiers → App IDs
   - Create a new App ID or use existing one
   - Copy the Bundle ID exactly as shown

**Important Security Notes:**
- **Keep APNS_PRIVATE_KEY secure** - it should never be committed to version control
- The P8 private key must include the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines
- All values are case-sensitive and must be entered exactly as provided by Apple
- Token-based authentication automatically refreshes every hour
- After setting these variables, you may need to redeploy the Lambda function for changes to take effect

**Token vs Certificate Comparison:**
| Aspect | Token-based (Your Setup) | Certificate-based (Old) |
|--------|--------------------------|-------------------------|
| Expiration | Never expires | Expires annually |
| Management | Single P8 key for all apps | Separate cert per app |
| Security | More secure | Less secure |
| Setup | Easier | More complex |
| Best for | Modern applications | Legacy applications |

### Gmail Pub/Sub Configuration
**Performed by**: You manually in Google Cloud Console
1. Go to [Gmail Pub/Sub Console](https://console.cloud.google.com/cloudpubsub/topicList)
2. Create or update your topic subscription
3. Set the endpoint to: `https://{your-function-url}/gmail-notification`
4. Set push authentication to: None (Lambda Function URLs handle HTTPS automatically)

### Test Your Setup
```bash
# Test device registration
curl -X POST https://{your-function-url}/device \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "deviceToken": "test-device-token"}'

# Test Gmail notification endpoint
curl -X POST https://{your-function-url}/gmail-notification \
  -H "Content-Type: application/json" \
  -d '{"message": {"data": "eyJlbWFpbEFkZHJlc3MiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaGlzdG9yeUlkIjoxMjM0NTY3OH0="}}'
```

## 7. Verification

**Timing**: Done AFTER deployment  
**Performed by**: You manually

Test the setup:
```bash
# Verify AWS access
aws sts get-caller-identity

# Check CloudFormation stacks after deployment
aws cloudformation describe-stacks --stack-name gmail-push-dev-infrastructure
aws cloudformation describe-stacks --stack-name gmail-push-dev-lambda

# Get Lambda Function URL
aws lambda get-function-url-config --function-name gmail-push-dev-lambda

# Test the endpoints
curl https://{your-function-url}/device
curl https://{your-function-url}/gmail-notification
```

The DynamoDB table and Lambda function with HTTPS URL will be created automatically by your GitHub Actions workflow.