const AWS = require('aws-sdk')
const {
  getAWSPostCallbackConfig,
  getDatabase,
  insertMetric,
  runIfDev
} = require('./utils')

const getCrossAccountCredentials = async () => {
  const {
    awsConnectCrossAccountDestinationAccountId,
    awsConnectCrossAccountRoleSessionName,
    awsConnectCrossAccountExternalId,
    awsConnectCrossAccountRegion
  } = await getAWSPostCallbackConfig()

  return new Promise((resolve, reject) => {
    const sts = new AWS.STS()
    const params = {
      RoleArn: awsConnectCrossAccountDestinationAccountId,
      RoleSessionName: awsConnectCrossAccountRoleSessionName,
      ExternalId: awsConnectCrossAccountExternalId
    }

    sts.assumeRole(params, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve({
          accessKeyId: data.Credentials.AccessKeyId,
          secretAccessKey: data.Credentials.SecretAccessKey,
          sessionToken: data.Credentials.SessionToken,
          region: awsConnectCrossAccountRegion
        })
      }
    })
  })
}

exports.handler = async function(event) {
  const db = await getDatabase()
  const sqs = new AWS.SQS({ region: process.env.AWS_REGION })
  const {
    callbackQueueUrl,
    awsConnectInstanceId,
    awsConnectContactFlowId,
    awsConnectQueueId,
    awsConnectApiEntryPhoneNumber
  } = await getAWSPostCallbackConfig()

  // Get the cross-account credentials to call into NYS DoH's call center API
  const crossAccountAccessParams = await getCrossAccountCredentials()
  const awsConnect = new AWS.Connect(crossAccountAccessParams)

  for (const record of event.Records) {
    const { mobile, closeContactDate, failedAttempts, payload } = JSON.parse(
      record.body
    )

    const params = {
      InstanceId: awsConnectInstanceId,
      ContactFlowId: awsConnectContactFlowId,
      QueueId: awsConnectQueueId,
      DestinationPhoneNumber: awsConnectApiEntryPhoneNumber,
      Attributes: { callbacknumber: mobile }
    }

    await awsConnect
      .startOutboundVoiceContact(params)
      .promise()
      .then(async result => {
        // We succeeded in call to startOutboundVoiceContact so the callback request is in the callback queue
        console.debug(
          `Callback posted to AWS Connect API (awsConnectInstanceId=${awsConnectInstanceId}, awsConnectContactFlowId=${awsConnectContactFlowId}, awsConnectQueueId=${awsConnectContactFlowId}, awsConnectApiEntryPhoneNumber=${awsConnectApiEntryPhoneNumber})`
        )
        await insertMetric(db, 'CALLBACK_SENT', '', '')
      })
      .catch(async error => {
        // We failed in call to startOutboundVoiceContact so see if we can add this call back to the queue to try again
        const MAX_FAILED_ATTEMPTS = 672
        const RETRY_DELAY_SECS = 600

        console.error(
          `Failed posting callback to AWS Connect API (awsConnectInstanceId=${awsConnectInstanceId}, awsConnectContactFlowId=${awsConnectContactFlowId}, awsConnectQueueId=${awsConnectContactFlowId}, awsConnectApiEntryPhoneNumber=${awsConnectApiEntryPhoneNumber}) - ${error}`
        )

        if (failedAttempts < MAX_FAILED_ATTEMPTS) {
          console.error(
            `Have seen ${failedAttempts +
              1} failures for this callback request - retrying after ${RETRY_DELAY_SECS}s`
          )

          const repostCallbackEventBody = {
            QueueUrl: callbackQueueUrl,
            MessageBody: JSON.stringify({
              closeContactDate,
              failedAttempts: failedAttempts + 1,
              mobile,
              payload
            }),
            DelaySeconds: RETRY_DELAY_SECS
          }

          await sqs.sendMessage(repostCallbackEventBody).promise()
        } else {
          console.error(
            `Have seen ${failedAttempts +
              1} failures for this callback request - not retrying`
          )
          await insertMetric(db, 'CALLBACK_FAIL', '', '')
        }
      })
  }

  return true
}

runIfDev(exports.handler)
