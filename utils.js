const AWS = require('aws-sdk')
const SQL = require('@nearform/sql')
const pg = require('pg')

const isProduction = /^\s*production\s*$/i.test(process.env.NODE_ENV)
const ssm = new AWS.SSM({ region: process.env.AWS_REGION })
const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION })

async function getParameter(id) {
  console.log('Fetching SSM', JSON.stringify(process.env, null, 2), { Name: `${process.env.CONFIG_VAR_PREFIX}${id}` });
  const response = await ssm
    .getParameter({ Name: `${process.env.CONFIG_VAR_PREFIX}${id}` })
    .promise()

  return response.Parameter.Value
}

async function getSecret(id) {
  console.log('Fetching SSM Secret', JSON.stringify(process.env, null, 2), { SecretId: `${process.env.CONFIG_VAR_PREFIX}${id}` });
  const response = await secretsManager
    .getSecretValue({ SecretId: `${process.env.CONFIG_VAR_PREFIX}${id}` })
    .promise()

  return JSON.parse(response.SecretString)
}

async function getAssetsBucket() {
  if (isProduction) {
    return await getParameter('s3_assets_bucket')
  } else {
    return process.env.ASSETS_BUCKET
  }
}

async function getCallbackConfig() {
  if (isProduction) {
    return {
      ...await getSecret('cct'),
      queueUrl: await getParameter('callback_url')
    }
  } else {
    return {
      url: process.env.CCT_URL,
      accessGuid: process.env.CCT_ACCESS_GUID,
      apiVersion: process.env.CCT_API_VERSION,
      sp: process.env.CCT_SP,
      sv: process.env.CCT_SV,
      sig: process.env.CCT_SIG,
      queueUrl: process.env.CALLBACK_QUEUE_URL
    }
  }
}

async function getCsoConfig() {
  if (isProduction) {
    return await getSecret('cso')
  } else {
    return {
      publicKey: process.env.CSO_PUBLIC_KEY,
      host: process.env.CSO_SFTP_HOST,
      port: process.env.CSO_SFTP_PORT,
      username: process.env.CSO_SFTP_USER,
      password: process.env.CSO_SFTP_PASSWORD,
      checkInPath: process.env.CSO_CHECK_IN_PATH
    }
  }
}

async function getDatabase() {
  require('pg-range').install(pg)

  let client

  if (isProduction) {
    const [{ username: user, password }, host, port, ssl, database] = await Promise.all([
      getSecret('rds-read-write'),
      getParameter('db_host'),
      getParameter('db_port'),
      getParameter('db_ssl'),
      getParameter('db_database')
    ])

    client = new pg.Client({
      host,
      database,
      user,
      password,
      port: Number(port),
      ssl: ssl === 'true'
    })
  } else {
    const { user, password, host, port, ssl, database } = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      ssl:  /true/i.test(process.env.DB_SSL),
      database: process.env.DB_DATABASE
    }

    client = new pg.Client({
      host,
      database,
      user,
      password,
      port: Number(port),
      ssl: ssl === 'true'
    })
  }

  await client.connect()

  return client
}

async function getSmsConfig() {
  if (isProduction) {
    const [
      { twilio_account, twilio_from, twilio_sid, twilio_token },
      queueUrl,
      smsTemplate
    ] = await Promise.all([
      getSecret('sms'),
      getParameter('sms_url'),
      getParameter('sms_template')
    ])

    return {
      accountSid: twilio_account,
      authToken: twilio_token,
      from: twilio_from,
      messagingServiceSid: twilio_sid,
      queueUrl,
      smsTemplate
    }
  } else {
    return {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_FROM,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      queueUrl: process.env.CALLBACK_QUEUE_URL,
      smsTemplate: process.env.SMS_TEMPLATE
    }
  }
}


async function getNYSDataUrl() {
  if (isProduction) {
    try {
      const url = await getParameter('stats_nys_data_url');
      return url
    } catch(err) {
      console.log('getParameter error occurred:', err);
      return false;
    }
  } else {
    return process.env.NYS_STATS
  }
}

async function getSocrataKey() {
  if (isProduction) {
    const key = await getSecret('stats_socrata_key');

    return key
  } else {
    return process.env.SOCRATA_KEY
  }
}


async function insertMetric(client, event, os, version) {
  const query = SQL`
    INSERT INTO metrics (date, event, os, version, value)
    VALUES (CURRENT_DATE, ${event}, ${os}, ${version}, 1)
    ON CONFLICT ON CONSTRAINT metrics_pkey
    DO UPDATE SET value = metrics.value + 1`

  await client.query(query)
}

function runIfDev(fn) {
  if (!isProduction) {
    fn(JSON.parse(process.argv[2] || '{}'))
      .then(result => {
        console.log(result)
        process.exit(0)
      })
      .catch(error => {
        console.log(error)
        process.exit(1)
      })
  }
}

module.exports = {
  getAssetsBucket,
  getCallbackConfig,
  getCsoConfig,
  getDatabase,
  getSmsConfig,
  getNYSDataUrl,
  getSocrataKey,
  insertMetric,
  runIfDev
}
