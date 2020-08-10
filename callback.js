const AWS = require('aws-sdk')
const fetch = require('node-fetch')
const querystring = require('querystring')
const { getCallbackConfig, getDatabase, insertMetric, runIfDev } = require('./utils')

exports.handler = async function (event) {
  const sqs = new AWS.SQS({ region: process.env.AWS_REGION })
  const { accessGuid, apiVersion, sig, sp, sv, queueUrl, url } = await getCallbackConfig()
  const db = await getDatabase()

  let success = true

  for (const record of event.Records) {
    const { closeContactDate, failedAttempts, id, mobile, payload } = JSON.parse(record.body)

    try {
      const query = querystring.stringify({
        'api-version': apiVersion,
        'sp': sp,
        'sv': sv,
        'sig': sig
      })

      const body = JSON.stringify({
        'PhoneMobile': mobile,
        'DateLastContact': new Date(closeContactDate + 43200000).toISOString().substr(0, 10),
        'Payload': payload
      })

      const response = await fetch(`${url}/${accessGuid}?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      })

      if (response.ok) {
        await insertMetric(db, 'CALLBACK_SENT', '', '')

        console.log(`callback completed with ${response.status} response`)
      } else {
        throw new Error(`Response code was ${response.status}`)
      }
    } catch (error) {
      console.log(error)

      if (failedAttempts < 672) {
        const delay = 900

        console.log(`retrying request in ${delay} seconds`)

        const message = {
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            closeContactDate,
            failedAttempts: failedAttempts + 1,
            id,
            mobile,
            payload
          }),
          DelaySeconds: delay
        }

        await sqs.sendMessage(message).promise()

        await insertMetric(db, 'CALLBACK_RETRY', '', '')

        success = false
      } else {
        console.log('exceeded maximum retry attempts')
        await insertMetric(db, 'CALLBACK_FAIL', '', '')

        success = false
      }
    }
  }

  return true
}

runIfDev(exports.handler)
