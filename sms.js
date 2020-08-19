const twilio = require('twilio')
const { getDatabase, getSmsConfig, insertMetric, runIfDev } = require('./utils')

function parseTemplate(template, values) {
  return template.replace(/\${([^}]*)}/g, (result, key) => values[key])
}

exports.handler = async function(event) {
  const {
    accountSid,
    authToken,
    from,
    messagingServiceSid,
    queueUrl,
    smsTemplate
  } = await getSmsConfig()
  const client = twilio(accountSid, authToken)
  const db = await getDatabase()

  for (const record of event.Records) {
    const { code, mobile, onsetDate, testDate } = JSON.parse(record.body)
    const message = { to: mobile, body: parseTemplate(smsTemplate, { code }) }

    if (messagingServiceSid) {
      message.messagingServiceSid = messagingServiceSid
    } else if (from) {
      message.from = from
    }

    try {
      await client.messages.create(message)

      await insertMetric(db, 'SMS_SENT', 'lambda', '')
    } catch (error) {
      const delay = 30

      console.error(error)
      console.log(`retrying request in ${delay} seconds`)

      const message = {
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ code, mobile, onsetDate, testDate }),
        DelaySeconds: delay
      }

      // eslint-disable-next-line no-undef
      await sqs.sendMessage(message).promise()
    }
  }

  return true
}

runIfDev(exports.handler)
