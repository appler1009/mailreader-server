To prepare AWS for your Lambda function and DynamoDB to work with GitHub Actions deployment, you'll need the following prerequisites and configurations. This is based on your project's infrastructure templates and deployment workflow.

## 1. AWS Account & Basic Setup

**Timing**: Done BEFORE deployment  
**Performed by**: You manually

- **AWS Account**: Active account with billing enabled
- **AWS Region**: Choose a region (e.g., us-west-2) and ensure all resources will be created there
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
| `APNS_TEAM_ID` | Your Apple Developer Team ID (10 characters) |
| `APNS_KEY_ID` | Your APNs Key ID |
| `APNS_BUNDLE_ID` | Your iOS app bundle identifier |

## 4. Lambda Function URL Configuration

**Timing**: Automated during deployment
**Status**: Lambda Function URL is created automatically via CloudFormation

The CloudFormation template now includes a separate `AWS::Lambda::Url` resource that creates a public HTTPS endpoint for your Lambda function with the following configuration:

- **Authentication**: None (public access)
- **CORS**: Enabled for all origins with GET, POST, DELETE, OPTIONS methods
- **Headers**: Content-Type allowed
- **Max Age**: 86400 seconds

After deployment, your Lambda function will have an HTTPS URL like:
`https://{your-function-id}.lambda-url.us-west-2.on.aws`

The Function URL is created automatically as part of the CloudFormation stack deployment.

## 5. GitHub Actions Deployment

**Timing**: Done DURING deployment
**Performed by**: GitHub Actions automatically

When you push to your main branch, GitHub Actions will automatically:
- Deploy DynamoDB table via CloudFormation
- Deploy Lambda function via CloudFormation
- Create Lambda Function URL with HTTPS endpoint
- Create all necessary IAM roles and permissions
- Set up log groups and monitoring

## 6. Post-Deployment Setup

**Timing**: Done AFTER deployment  
**Performed by**: You manually

Once the deployment completes, verify the setup:

### Verify Lambda Function URL
The Lambda Function URL is created automatically during deployment. You can verify it using:

```bash
# Verify your Lambda Function URL
aws lambda get-function-url-config --function-name gmail-push-dev-lambda
```

The URL will look like: `https://abcdef1234567890.lambda-url.us-west-2.on.aws`

### AWS Secrets Manager Setup
**Performed by**: You manually in AWS Console

Before configuring environment variables, you need to store your APNs private key securely in AWS Secrets Manager:

1. **Access Secrets Manager Console**
   - Go to [AWS Secrets Manager Console](https://console.aws.amazon.com/secretsmanager)
   - Click **"Store a new secret"**

2. **Create the Secret**
   - Choose **"Other type of secret"**
   - Key: Leave as "Secret key/value"
   - Value: Paste your complete P8 private key (including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines)
   - Click **"Next"**

3. **Configure Secret Details**
   - Secret name: `{environment}/mailreader/apns/private-key` (e.g., `dev/mailreader/apns/private-key`)
   - Description: "APNs private key for Gmail push notifications"
   - Click **"Next"**

4. **Configure Rotation** (Optional)
   - Skip automatic rotation for now
   - Click **"Next"**

5. **Review and Store**
   - Review the settings and click **"Store"**

**Note**: The CloudFormation template already includes the necessary IAM permissions for the Lambda function to access this secret.

### Lambda Environment Variables
**Performed by**: GitHub Actions automatically during deployment

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

**Automatic Configuration:**
Environment variables are set automatically during deployment using values from GitHub secrets:

- `APNS_TEAM_ID`: From `APNS_TEAM_ID` secret
- `APNS_KEY_ID`: From `APNS_KEY_ID` secret
- `APNS_BUNDLE_ID`: From `APNS_BUNDLE_ID` secret
- `APNS_SECRET_NAME`: Set automatically to `{environment}/mailreader/apns/private-key`

**Manual Verification (Optional):**
You can verify the environment variables were set correctly in the Lambda console:
1. Go to [AWS Lambda Console](https://console.aws.amazon.com/lambda)
2. Find your function: `gmail-push-{environment}-lambda`
3. Click **"Configuration"** → **"Environment variables"**
4. Verify all APNs variables are present with correct values

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
- **Store APNS private key securely in AWS Secrets Manager** - it should never be committed to version control or stored as environment variables
- The P8 private key must include the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines in the Secrets Manager secret
- Ensure your Lambda execution role has permissions to access the Secrets Manager secret
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

# For production environment:
aws cloudformation describe-stacks --stack-name gmail-push-prod-infrastructure
aws cloudformation describe-stacks --stack-name gmail-push-prod-lambda

# Verify Lambda Function URL
aws lambda get-function-url-config --function-name gmail-push-dev-lambda

# For production environment:
aws lambda get-function-url-config --function-name gmail-push-prod-lambda

# Test the endpoints
curl https://{your-function-url}/device
curl https://{your-function-url}/gmail-notification
```

The DynamoDB table, Lambda function, and Lambda Function URL will be created automatically by your GitHub Actions workflow.