const axios = require('axios')
const AWS = require('aws-sdk')
const {
  getAssetsBucket,
  getNYSDataUrl,
  getParameter,
  getSocrataKey,
  runIfDev
} = require('./utils')
const defaultMaxAge = 1000 * 60 * 60 * 24 * 7 // 7 days.

/**
 * Gets the state-wide testing data as found on the NY DoH website.
 * "New York State Statewide COVID-19 Testing"
 * @url https://health.data.ny.gov/Health/New-York-State-Statewide-COVID-19-Testing/xdss-u53e
 * @throws Error if the response from the API is not 200.
 */
const getStateWideTestingData = async (
  maxAge,
  limit = 10000,
  offset = 0,
  data = []
) => {
  const apiKey = await getSocrataKey()
  const nysDataUrl = await getNYSDataUrl()
  const result = await axios.get(nysDataUrl, {
    headers: {
      'X-App-Token': apiKey
    },
    params: {
      $limit: limit,
      $offset: offset
    }
  })

  const { data: requestData } = result
  if (requestData.length === 0 && data.length === 0) {
    return false
  } else if (requestData.length === 0) {
    return data
  } else {
    let reachedStatsMaxAge = false
    data = data
      .concat(
        requestData.map(record => {
          if (
            Date.parse(record.test_date) + maxAge <
            new Date().getTime() - 1000 * 60 * 60 * 24
          ) {
            reachedStatsMaxAge = true
            return false
          }
          record.new_positives = parseInt(record.new_positives)
          record.cumulative_number_of_positives = parseInt(
            record.cumulative_number_of_positives
          )
          record.total_number_of_tests = parseInt(record.total_number_of_tests)
          record.cumulative_number_of_tests = parseInt(
            record.cumulative_number_of_tests
          )
          return record
        })
      )
      .filter(item => !!item)
    if (reachedStatsMaxAge) {
      return data
    }
    return getStateWideTestingData(maxAge, limit, data.length, data)
  }
}

/**
 * Gets testing data for the state of NY.  Returns records sorted by date and
 * by county.  Also returns aggregate data by date (state-wide) and by county.
 */
const getTestingData = async () => {
  let maxAge
  try {
    maxAge = await getParameter('stats_max_age')
  } catch (err) {
    maxAge = defaultMaxAge
  }
  const data = await getStateWideTestingData(maxAge)
  const byDate = {}
  const byCounty = {}
  const aggregateByCounty = {}
  const aggregateByDate = {}
  data.forEach(record => {
    if (!byDate[record.test_date]) {
      byDate[record.test_date] = []
    }
    byDate[record.test_date].push(
      (record => {
        delete record.test_date
        return record
      })({ ...record })
    )
    if (!byCounty[record.county]) {
      byCounty[record.county] = []
    }
    byCounty[record.county].push(
      (record => {
        delete record.county
        return record
      })({ ...record })
    )
  })
  for (const date in byDate) {
    aggregateByDate[date] = sumTestingData(byDate[date], true)
    delete aggregateByDate[date].county
    delete aggregateByDate[date].test_date
  }
  for (const county in byCounty) {
    aggregateByCounty[county] = Object.assign(
      {},
      byCounty[county][byCounty[county].length - 1]
    )
    aggregateByCounty[county].last_test_date =
      aggregateByCounty[county].test_date
    delete aggregateByCounty[county].county
    delete aggregateByCounty[county].test_date
    delete aggregateByCounty[county].new_positives
    delete aggregateByCounty[county].total_number_of_tests
    delete aggregateByCounty[county].date
  }
  return {
    aggregateByCounty,
    aggregateByDate,
    byDate,
    byCounty,
    data
  }
}

/**
 * Sums the testing data and reduces it a single object.
 */
const sumTestingData = (records, aggregateCumulatives = false) => {
  if (!Array.isArray(records) || records.length === 0) {
    return records
  }

  const aggregateRecord = records.reduce(
    (acc, record) => {
      acc.new_positives += record.new_positives
      acc.total_number_of_tests += record.total_number_of_tests
      if (aggregateCumulatives) {
        acc.cumulative_number_of_positives +=
          record.cumulative_number_of_positives
        acc.cumulative_number_of_tests += record.cumulative_number_of_tests
      }
      return acc
    },
    {
      new_positives: 0,
      total_number_of_tests: 0,
      ...(aggregateCumulatives
        ? {
            cumulative_number_of_positives: 0,
            cumulative_number_of_tests: 0
          }
        : {})
    }
  )
  return {
    ...records[records.length - 1],
    ...aggregateRecord
  }
}

exports.handler = async function() {
  const s3 = new AWS.S3({ region: process.env.AWS_REGION })
  const bucket = await getAssetsBucket()
  const {
    aggregateByCounty,
    aggregateByDate,
    byDate,
    byCounty
  } = await getTestingData()

  const statsObject = {
    ACL: 'private',
    Bucket: bucket,
    ContentType: 'application/json'
  }

  const byCountyStatsObject = {
    ...statsObject,
    Body: Buffer.from(
      JSON.stringify(
        {
          aggregate: aggregateByCounty,
          counties: byCounty
        },
        null,
        2
      )
    ),
    Key: 'stats-by-county.json'
  }

  const byDateStatsObject = {
    ...statsObject,
    Body: Buffer.from(
      JSON.stringify(
        {
          aggregate: aggregateByDate,
          dates: byDate
        },
        null,
        2
      )
    ),
    Key: 'stats-by-date.json'
  }

  try {
    await s3.putObject(byCountyStatsObject).promise()
    await s3.putObject(byDateStatsObject).promise()
    await s3
      .putObject({
        ...statsObject,
        Body: Buffer.from(
          JSON.stringify(
            {
              byDate: {
                aggregate: aggregateByDate,
                dates: byDate
              },
              byCounty: {
                aggregate: aggregateByCounty,
                counties: byCounty
              }
            },
            null,
            2
          )
        ),
        Key: 'stats.json'
      })
      .promise()
  } catch (e) {
    console.log('Error occured.', e)
  }

  return {
    success: true
  }
}

runIfDev(exports.handler)
