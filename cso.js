const Client = require('ssh2-sftp-client')
const SQL = require('@nearform/sql')
const openpgp = require('openpgp')
const { getCsoConfig, getDatabase, runIfDev } = require('./utils')

async function countCheckIns(client, date) {
  const query = SQL`
    SELECT COUNT(*) AS "count" FROM check_ins
    WHERE created_at = ${date}::DATE`

  const { rows } = await client.query(query)
  const [{ count }] = rows

  return count
}

async function getCheckIns(client, date, limit, offset) {
  const query = SQL`
    SELECT created_at, sex, age_range, locality, ok, payload
    FROM check_ins
    WHERE created_at = ${date}::DATE
    LIMIT ${limit} OFFSET ${offset}`

  const results = [['"age_range"', '"sex"', '"locality"', '"feeling_ok"']]

  for (let i = 1; i <= 28; i++) {
    results[0].push(
      `"symptom_fever_${i}"`,
      `"symptom_cough_${i}"`,
      `"symptom_breath_${i}"`,
      `"symptom_flu_${i}"`,
      `"covid_status_${i}"`,
      `"date_${i}"`
    )
  }

  const { rows } = await client.query(query)

  for (const { age_range: ageRange, sex, locality, ok, payload } of rows) {
    const result = [`"${ageRange}"`, `"${sex}"`, `"${locality}"`, `"${ok}"`]

    for (let i = 0; i < 28; i++) {
      if (payload.data[i]) {
        const { fever, cough, breath, flu, status, date } = payload.data[i]

        result.push(
          /(true|1|y)/i.test(fever),
          /(true|1|y)/i.test(cough),
          /(true|1|y)/i.test(breath),
          /(true|1|y)/i.test(flu),
          `"${status}"`,
          `"${date}"`
        )
      } else {
        result.push('', '', '', '', '', '', '', '')
      }
    }

    results.push(result)
  }

  return results
}

async function clearCheckIns(client) {
  const query = SQL`
    DELETE FROM check_ins
    WHERE created_at <= CURRENT_DATE - INTERVAL '7 days'`

  await client.query(query)
}

exports.handler = async function(event) {
  const {
    publicKey,
    host,
    port,
    username,
    password,
    checkInPath
  } = await getCsoConfig()

  const client = await getDatabase()
  const count = await countCheckIns(client, event.date || 'yesterday')
  const limit = 50000
  const files = Math.ceil(count / limit)

  console.log(`creating ${files} files for ${count} records`)

  for (let offset = 0; offset < files; offset++) {
    const checkIns = await getCheckIns(
      client,
      event.date || 'yesterday',
      limit,
      offset
    )
    const keyResult = await openpgp.key.readArmored(publicKey)

    const { data: encryptedCheckIns } = await openpgp.encrypt({
      message: openpgp.message.fromText(checkIns.join('\n')),
      publicKeys: keyResult.keys
    })

    const date = event.date ? new Date(event.date) : new Date()

    if (!event.date) {
      date.setDate(date.getDate() - 1)
    }

    const formatted = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const sftp = new Client()

    await sftp.connect({
      host,
      port,
      username,
      password,
      algorithms: {
        serverHostKey: ['ssh-rsa', 'ssh-dss']
      }
    })

    await sftp.put(
      Buffer.from(encryptedCheckIns, 'utf8'),
      `${checkInPath}/checkins-${formatted}-${offset + 1}.csv.gpg`
    )

    console.log(`file ${offset + 1} uploaded`)
  }

  await clearCheckIns(client)

  return true
}

runIfDev(exports.handler)
