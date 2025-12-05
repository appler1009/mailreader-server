const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

// Initialize AWS clients
const dynamodb = new AWS.DynamoDB.DocumentClient();
const secretsManager = new AWS.SecretsManager();

// Environment variables (set these in Lambda configuration)
const {
  DYNAMODB_TABLE_NAME,
  APNS_TEAM_ID,
  APNS_KEY_ID,
  APNS_SECRET_NAME,
  APNS_BUNDLE_ID
} = process.env;

// Cache for APNS private key to avoid repeated Secrets Manager calls
let apnsPrivateKeyCache = null;

/**
 * Retrieve APNS private key from AWS Secrets Manager
 * @returns {Promise<string>} The private key content
 */
async function getAPNSPrivateKey() {
  if (apnsPrivateKeyCache) {
    return apnsPrivateKeyCache;
  }

  try {
    const response = await secretsManager.getSecretValue({ SecretId: APNS_SECRET_NAME }).promise();
    apnsPrivateKeyCache = response.SecretString || Buffer.from(response.SecretBinary, 'base64').toString('ascii');
    return apnsPrivateKeyCache;
  } catch (error) {
    console.error('Failed to retrieve APNS private key from Secrets Manager:', error);
    throw new Error('Unable to retrieve APNS private key');
  }
}

/**
 * APNs Token-based Authentication Setup
 * 
 * This application uses modern token-based authentication for APNs (Apple Push Notification service)
 * instead of certificates. This approach uses JWT tokens and has several advantages:
 * 
 * - No expiration (certificates expire annually, tokens don't)
 * - Easier management (single P8 key for all apps)
 * - More secure and modern approach
 * 
 * Required Environment Variables:
 * - APNS_TEAM_ID: Your Apple Developer Team ID (10 characters)
 * - APNS_KEY_ID: Your APNs Key ID (10 characters)
 * - APNS_SECRET_NAME: Name of AWS Secrets Manager secret containing the P8 private key
 * - APNS_BUNDLE_ID: Your app's bundle identifier
 */

// APNS Server endpoints
const APNS_PRODUCTION = 'api.push.apple.com';
const APNS_SANDBOX = 'api.sandbox.apple.com';

// Helper function to generate APNS JWT token
async function generateAPNSToken() {
  const header = {
    alg: 'ES256',
    kid: APNS_KEY_ID,
    typ: 'JWT'
  };

  const payload = {
    iss: APNS_TEAM_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    aud: 'apns'
  };

  const privateKey = await getAPNSPrivateKey();
  return jwt.sign(payload, privateKey, {
    algorithm: 'ES256',
    header: header
  });
}

// Helper function to send APNS notification
async function sendAPNSNotification(deviceToken, notification, isProduction = false) {
  const token = await generateAPNSToken();
  const host = isProduction ? APNS_PRODUCTION : APNS_SANDBOX;

  const payload = {
    aps: {
      alert: notification.alert,
      badge: notification.badge || 0,
      sound: notification.sound || 'default',
      category: notification.category || 'GMAIL_NOTIFICATION'
    },
    gmail: notification.gmailData || {}
  };

  const postData = JSON.stringify(payload);

  const options = {
    hostname: host,
    port: 443,
    path: `/3/device/${deviceToken}`,
    method: 'POST',
    headers: {
      'authorization': `bearer ${token}`,
      'apns-id': uuidv4(),
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-topic': APNS_BUNDLE_ID,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true, apnsId: res.headers['apns-id'] });
        } else {
          reject(new Error(`APNS request failed: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// DynamoDB operations
async function registerDevice(email, deviceToken) {
  const params = {
    TableName: DYNAMODB_TABLE_NAME,
    Item: {
      email: email,
      deviceToken: deviceToken,
      registeredAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    }
  };

  try {
    await dynamodb.put(params).promise();
    return { success: true, message: 'Device registered successfully' };
  } catch (error) {
    // Since email + deviceToken is the composite key, duplicates will be updated
    throw error;
  }
}

async function unregisterDevice(email, deviceToken) {
  const params = {
    TableName: DYNAMODB_TABLE_NAME,
    Key: {
      email: email,
      deviceToken: deviceToken
    }
  };

  try {
    await dynamodb.delete(params).promise();
    return { success: true, message: 'Device unregistered successfully' };
  } catch (error) {
    throw error;
  }
}

async function getUserDevices(email) {
  const params = {
    TableName: DYNAMODB_TABLE_NAME,
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: {
      ':email': email
    }
  };

  try {
    const result = await dynamodb.query(params).promise();
    return result.Items || [];
  } catch (error) {
    throw error;
  }
}

// Parse Gmail pub/sub message
function parseGmailMessage(message) {
  try {
    const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
    const data = JSON.parse(decodedData);
    const email = data.emailAddress || data.email;
    const historyId = data.historyId;
    
    // Extract basic notification info
    const notification = {
      alert: {
        title: 'New Gmail Message',
        body: 'You have a new email in your inbox'
      },
      gmailData: {
        email: email,
        historyId: historyId,
        timestamp: new Date().toISOString()
      },
      badge: 1,
      sound: 'default',
      category: 'GMAIL_NOTIFICATION'
    };

    return { email, notification };
  } catch (error) {
    throw new Error(`Failed to parse Gmail message: ${error.message}`);
  }
}

// Handle device registration/unregistration requests
async function handleDeviceRequest(event) {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;
  const body = event.body;

  try {
    const requestData = JSON.parse(body);
    const { email, deviceToken } = requestData;

    if (!email || !deviceToken) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({
          error: 'Email and deviceToken are required'
        })
      };
    }

    let result;
    if (method === 'POST' && path === '/device') {
      result = await registerDevice(email, deviceToken);
    } else if (method === 'DELETE' && path === '/device') {
      result = await unregisterDevice(email, deviceToken);
    } else {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Endpoint not found'
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Device request error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
}

// Handle Gmail pub/sub notifications via API Gateway

// Handle Gmail pub/sub notifications via API Gateway
async function handleGmailNotification(event) {
  try {
    // Parse the Pub/Sub message from API Gateway body
    let message;
    if (event.body) {
      message = JSON.parse(event.body);
    } else {
      throw new Error('No message body in Gmail notification event');
    }

    // Handle Pub/Sub push message format
    let pubsubMessage;
    if (message.message) {
      // Pub/Sub push format
      pubsubMessage = message.message;
    } else if (message.data) {
      // Direct Pub/Sub message format
      pubsubMessage = message;
    } else {
      throw new Error('Invalid Pub/Sub message format');
    }

    const { email, notification } = parseGmailMessage(pubsubMessage);

    // Get all devices for this email
    const devices = await getUserDevices(email);

    if (devices.length === 0) {
      console.log(`No devices found for email: ${email}`);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ success: true, message: 'No devices to notify' })
      };
    }

    // Determine if this is production environment
    const isProduction = process.env.ENVIRONMENT === 'prod';

    // Send notification to all devices
    const results = await Promise.allSettled(
      devices.map(device =>
        sendAPNSNotification(device.deviceToken, notification, isProduction)
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`Notifications sent: ${successful} successful, ${failed} failed for email: ${email}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: `Notifications sent to ${successful} devices`,
        failed: failed
      })
    };
  } catch (error) {
    console.error('Gmail notification error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Failed to process Gmail notification',
        message: error.message
      })
    };
  }
}

// Main Lambda handler
exports.handler = async (event) => {
  console.log('Lambda invoked with event:', JSON.stringify(event, null, 2));

  try {
    // Extract method and path for Function URL events
    const method = event.requestContext.http.method;
    const path = event.requestContext.http.path;

    // Check if this is device registration/unregistration
    if (method && path === '/device') {
      return await handleDeviceRequest(event);
    }

    // Check if this is a Gmail pub/sub notification
    if (method === 'POST' && path === '/gmail-notification') {
      return await handleGmailNotification(event);
    }

    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Invalid request format'
      })
    };
  } catch (error) {
    console.error('Lambda execution error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
