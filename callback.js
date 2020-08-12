const AWS = require('aws-sdk')
const fetch = require('node-fetch')
const { base64Encode, getAWSPostCallbackConfig, getDatabase, insertMetric, runIfDev } = require('./utils')

async function authenticate(){
  const { awsPostCallbackAuthnUrl, awsPostCallbackAuthnClientId, awsPostCallbackAuthnClientSecret } = await getAWSPostCallbackConfig()

  console.log(`Authenticating with ${awsPostCallbackAuthnUrl}`)

  const authnHeader = base64Encode(`${awsPostCallbackAuthnClientId}:${awsPostCallbackAuthnClientSecret}`)
  const jwt = fetch(awsPostCallbackAuthnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${authnHeader}`
    },
  })
    .then(res => {
      if(!res.ok){ // happens if 300 - 500 error
        throw new Error(`Failed to authenticate with ${awsPostCallbackAuthnUrl} - ${res.status}: ${res.statusText}`)
      }
    })
    .then(res => res.json().access_token)

  return jwt
}

exports.handler = async function(event){
  const db = await getDatabase()
  const sqs = new AWS.SQS({ region: process.env.AWS_REGION })
  const { callbackQueueUrl, awsPostCallbackUrl, awsPostCallbackAPIKey } = await getAWSPostCallbackConfig()
  const jwt = authenticate() // throws exception if unable to authenticate

  for(const record of event.Records){

    const { mobile, closeContactDate, failedAttempts, id, payload } = JSON.parse(record.body)

    try{
      const awsPostCallbackBody = JSON.stringify({
        'number': mobile,
      })

      const response = await fetch(awsPostCallbackUrl, {
        method: 'POST',
        headers: {
          'Authorization': jwt,
          'x-api-key': awsPostCallbackAPIKey,
        },
        awsPostCallbackBody
      })

      if(response.ok){
        console.debug(`Callback posted to ${awsPostCallbackUrl}`)
        await insertMetric(db, 'CALLBACK_SENT', '', '')
      } else {
        throw new Error(`Failed posting callback to ${awsPostCallbackUrl} - ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      const MAX_FAILED_ATTEMPTS = 672
      const RETRY_DELAY_SECS = 600

      console.error(error)

      if (failedAttempts < MAX_FAILED_ATTEMPTS) {
        console.error(`Have seen ${failedAttempts + 1} failures for this callback request (userId: ${id}) - retrying after ${RETRY_DELAY_SECS}s`)

        const repostCallbackEventBody = {
          QueueUrl: callbackQueueUrl,
          MessageBody: JSON.stringify({
            closeContactDate,
            failedAttempts: failedAttempts + 1,
            id,
            mobile,
            payload
          }),
          DelaySeconds: RETRY_DELAY_SECS
        }

        await sqs.sendMessage(repostCallbackEventBody).promise()

      } else {
        console.error(`Have seen ${failedAttempts + 1} failures for this callback request (userId: ${id}) - not retrying`)
        await insertMetric(db, 'CALLBACK_FAIL', '', '')
      }
    }
  }

  return true
}

runIfDev(exports.handler)
