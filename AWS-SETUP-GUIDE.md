To prepare AWS for your Lambda function, ALB (Application Load Balancer), and DynamoDB to work with GitHub Actions deployment, you'll need the following prerequisites and configurations. This is based on your project's infrastructure templates and deployment workflow.

## 1. AWS Account & Basic Setup
- **AWS Account**: Active account with billing enabled
- **AWS Region**: Choose a region (e.g., us-east-1) and ensure all resources will be created there
- **AWS CLI**: Install and configure locally with `aws configure` for testing

## 2. IAM User for GitHub Actions
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
                "logs:*",
                "elasticloadbalancing:*"
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
- `elasticloadbalancing:*` (for ALB permission management)

## 3. GitHub Repository Secrets
Add these secrets in your GitHub repo (Settings → Secrets and variables → Actions):

| Secret Name | Value |
|-------------|--------|
| `AWS_ACCESS_KEY_ID` | Access key from the IAM user |
| `AWS_SECRET_ACCESS_KEY` | Secret key from the IAM user |
| `AWS_REGION` | Your chosen AWS region |

## 4. VPC & Networking (for ALB)
Ensure you have:
- **VPC**: Default VPC or a custom VPC
- **Subnets**: At least 2 public subnets in different availability zones
- **Security Groups**: 
  - ALB security group allowing HTTP (80) and HTTPS (443) inbound
  - Lambda security group (if needed for VPC access)

## 5. SSL Certificate (Optional but Recommended)
- Request an SSL certificate via AWS Certificate Manager for HTTPS support on ALB

## Post-Deployment Setup (After GitHub Actions Run)
Once the deployment completes, manually configure:

### ALB Creation
```bash
# Create ALB
aws elbv2 create-load-balancer \
  --name gmail-push-alb \
  --subnets subnet-12345 subnet-67890 \
  --security-groups sg-12345678

# Create target group for Lambda
aws elbv2 create-target-group \
  --name gmail-push-targets \
  --protocol HTTP \
  --port 80 \
  --vpc-id vpc-12345678 \
  --target-type lambda

# Register Lambda with target group
aws elbv2 register-targets \
  --target-group-arn target-group-arn \
  --targets Id=lambda-arn

# Create listener with rules
aws elbv2 create-listener \
  --load-balancer-arn alb-arn \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=target-group-arn

# Add path-based routing rules
aws elbv2 create-rule \
  --listener-arn listener-arn \
  --priority 100 \
  --conditions Field=path-pattern,Values=/device \
  --actions Type=forward,TargetGroupArn=target-group-arn

aws elbv2 create-rule \
  --listener-arn listener-arn \
  --priority 200 \
  --conditions Field=path-pattern,Values=/gmail-notification \
  --actions Type=forward,TargetGroupArn=target-group-arn
```

### Lambda Environment Variables
Set these in the Lambda console after deployment:
- `APNS_TEAM_ID`
- `APNS_KEY_ID` 
- `APNS_PRIVATE_KEY`
- `APNS_BUNDLE_ID`

## Verification
Test the setup:
```bash
# Verify AWS access
aws sts get-caller-identity

# Check CloudFormation stacks after deployment
aws cloudformation describe-stacks --stack-name gmail-push-dev-infrastructure
aws cloudformation describe-stacks --stack-name gmail-push-dev-lambda
```

The DynamoDB table and Lambda function will be created automatically by your GitHub Actions workflow. The ALB requires manual setup as it's not included in the CloudFormation templates.