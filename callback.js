const AWS = require('aws-sdk')
const { getAWSPostCallbackConfig, getDatabase, insertMetric, runIfDev } = require('./utils')

exports.handler = async function(event){
  const awsConnect = new AWS.Connect();
  const db = await getDatabase()
  const sqs = new AWS.SQS({ region: process.env.AWS_REGION })
  const { callbackQueueUrl, awsConnectInstanceId, awsConnectContactFlowId, awsConnectQueueId, awsConnectApiEntryPhoneNumber } = await getAWSPostCallbackConfig()

  for(const record of event.Records) {

    const {mobile, closeContactDate, failedAttempts, id, payload} = JSON.parse(record.body)

    let params = {
      InstanceId: awsConnectInstanceId,
      ContactFlowId: awsConnectContactFlowId,
      QueueId: awsConnectQueueId,
      DestinationPhoneNumber: awsConnectApiEntryPhoneNumber,
      Attributes: {"callbacknumber": mobile}
    }

    // TODO: Can I mark the callback as async ??
    awsConnect.startOutboundVoiceContact(params, async function (error, data) {
      if (error) {
        const MAX_FAILED_ATTEMPTS = 672
        const RETRY_DELAY_SECS = 600

        console.error(`Failed posting callback to AWS Connect API (awsConnectInstanceId=${awsConnectInstanceId}, awsConnectContactFlowId=${awsConnectContactFlowId}, awsConnectQueueId=${awsConnectContactFlowId}, awsConnectApiEntryPhoneNumber=${awsConnectApiEntryPhoneNumber}) - ${error}`)

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
      } else {
        console.debug(`Callback posted to AWS Connect API (awsConnectInstanceId=${awsConnectInstanceId}, awsConnectContactFlowId=${awsConnectContactFlowId}, awsConnectQueueId=${awsConnectContactFlowId}, awsConnectApiEntryPhoneNumber=${awsConnectApiEntryPhoneNumber})`)
        await insertMetric(db, 'CALLBACK_SENT', '', '')
      }
    })
  }

  return true
}

runIfDev(exports.handler)
