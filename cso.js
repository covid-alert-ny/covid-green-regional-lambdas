const SQL = require('@nearform/sql')
const { Storage } = require('@google-cloud/storage')
const { getCsoConfig, getDatabase, runIfDev } = require('./utils')

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function countCheckIns(db, date) {
  const query = SQL`
    SELECT COUNT(*) AS "count" FROM check_ins
    WHERE created_at = ${date}::DATE`

  const { rows } = await db.query(query)
  const [{ count }] = rows

  return count
}

async function getCheckIns(db, date, limit, offset) {
  const query = SQL`
    SELECT ok, payload, demographics
    FROM check_ins
    WHERE created_at = ${date}::DATE
    LIMIT ${limit} OFFSET ${offset}`

  const results = [['"ok"', '"gender"', '"sexual_orientation"', '"race"', '"ethnicity"', '"age_range"', '"county"']]

  for (let i = 1; i <= 28; i++) {
    results[0].push(
      `"symptom_fever_${i}"`,
      `"symptom_cough_${i}"`,
      `"symptom_breath_${i}"`,
      `"symptom_fatigue_${i}"`,
      `"symptom_throat_${i}"`,
      `"symptom_congestion_${i}"`,
      `"symptom_aches_${i}"`,
      `"symptom_headache_${i}"`,
      `"symptom_nausea_${i}"`,
      `"symptom_diarrhea_${i}"`,
      `"symptom_taste_${i}"`,
      `"date_${i}"`
    )
  }

  const { rows } = await db.query(query)

  for (const { ok, payload, demographics } of rows) {
    const { gender, sexualOrientation, race, ethnicity, ageRange, county } = demographics

    const result = [
      `"${ok}"`,
      `"${gender}"`,
      `"${sexualOrientation}"`,
      `"${race}"`,
      `"${ethnicity}"`,
      `"${ageRange}"`,
      `"${county}"`
    ]

    for (let i = 0; i < 28; i++) {
      if (payload.data[i]) {
        const symptoms = payload.data[i]

        result.push(
          /(true|1|y)/i.test(symptoms.fever),
          /(true|1|y)/i.test(symptoms.cough),
          /(true|1|y)/i.test(symptoms.breath),
          /(true|1|y)/i.test(symptoms.fatigue),
          /(true|1|y)/i.test(symptoms.throat),
          /(true|1|y)/i.test(symptoms.congestion),
          /(true|1|y)/i.test(symptoms.aches),
          /(true|1|y)/i.test(symptoms.headache),
          /(true|1|y)/i.test(symptoms.nausea),
          /(true|1|y)/i.test(symptoms.diarrhea),
          /(true|1|y)/i.test(symptoms.taste),
          `"${symptoms.date}"`
        )
      } else {
        result.push('', '', '', '', '', '', '', '', '', '', '', '')
      }
    }

    results.push(result)
  }

  return results
}

async function clearCheckIns(db) {
  const query = SQL`
    DELETE FROM check_ins
    WHERE created_at <= CURRENT_DATE - INTERVAL '7 days'`

  await db.query(query)
}

async function uploadCheckIns(db, storage, date) {
  const count = await countCheckIns(db, date)
  const limit = 50000
  const files = Math.ceil(count / limit)

  console.log(`creating ${files} files for ${count} records`)

  for (let offset = 0; offset < files; offset++) {
    const checkIns = await getCheckIns(db, date, limit, offset)

    await storage
      .file(`${process.env.CONFIG_VAR_PREFIX}check-ins-${formatDate(date)}-${offset + 1}.csv`)
      .save(Buffer.from(checkIns.join('\n'), 'utf8'))

    console.log(`file ${offset + 1} uploaded`)
  }

  await clearCheckIns(db)
}

async function uploadMetrics(db, storage, date) {
  const query = SQL`
    SELECT event, os, version, value
    FROM metrics
    WHERE date = ${date}::DATE`

  const { rows } = await db.query(query)
  const data = [[`"event"`, `"os"`, `"version"`, `"value"`]]

  for (const { event, os, version, value } of rows) {
    data.push([
      `"${event}"`,
      `"${os}"`,
      `"${version}"`,
      value
    ])
  }

  await storage
    .file(`${process.env.CONFIG_VAR_PREFIX}metrics-${formatDate(date)}.csv`)
    .save(Buffer.from(data.join('\n'), 'utf8'))

  console.log(`metrics uploaded`)
}

exports.handler = async function (event) {
  const { bucket, ...credentials } = await getCsoConfig()
  const db = await getDatabase()
  const storage = new Storage({ credentials }).bucket(bucket)
  const date = event.date ? new Date(event.date) : new Date()

  if (!event.date) {
    date.setDate(date.getDate() - 1)
  }

  await uploadCheckIns(db, storage, date)
  await uploadMetrics(db, storage, date)

  return true
}

runIfDev(exports.handler)
