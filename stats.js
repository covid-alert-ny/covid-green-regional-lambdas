const axios = require('axios')
const AWS = require('aws-sdk')
const {
  getAssetsBucket,
  getNYSDataUrl,
  getParameter,
  getSocrataKey,
  runIfDev
} = require('./utils')
const oneDayInMilliseconds = 1000 * 60 * 60 * 24
const defaultMaxAgeInDays = 30 // 30 days.
const movingAvgDays = 7 // 7 days.


/**
 * Given an iterable object with each object containing `test_date` filters
 * out records with a date past the `maxAge` cutoff.
 * @param {*} iterable 
 */
export const filterDates = (iterable, maxAge) => {
  return iterable
    .map(record => {
      if (
        Date.parse(record.test_date) + (maxAge + 1) * oneDayInMilliseconds <
        new Date().getTime() - 1000 * 60 * 60 * 24
      ) {
        return false
      }
      return record
    })
    .filter(item => !!item)
}

/**
 * Filters out the dates given an iterable object where keys are dates.
 * @param {*} dateIterable 
 * @param {*} maxAge 
 */
export const filterDatesByDateKey = (dateIterable, maxAge) => {
  for (const date in dateIterable) {
    if (
      Date.parse(date) + (maxAge + 1) * oneDayInMilliseconds <
      new Date().getTime() - 1000 * 60 * 60 * 24
    ) {
      delete dateIterable[date]
    }
  }
}

/**
 * Filters out the dates from the resulting objects after testing data has been
 * gotten.
 * @param {*} dateIterable 
 * @param {*} maxAge 
 */
export const filterTestingDataByDate = ({
  data,
  aggregateByDate,
  byDate,
  byCounty
}) => {
  let maxAge
  try {
    maxAge = await getParameter('stats_max_age')
  } catch (err) {
    maxAge = defaultMaxAgeInDays
  }
  data = filterDates(data, maxAge)
  filterDatesByDateKey(aggregateByDate, maxAge)
  filterDatesByDateKey(byDate, maxAge)
  for (const county in byCounty) {
    byCounty[county] = filterDates(byCounty[county], maxAge)
  }
}

/**
 * Given an iterable object with the values per index `new_positives` and
 * `total_number_of_tests`, sums a moving average as close to `movingAvgDays`
 * as possible.
 */
export const getMovingAverage = (iterable) => {
  iterable.sort((a, b) => {
    return Date.parse(a.test_date) > Date.parse(b.test_date) ? 1 : -1
  })
  iterable.forEach((value, idx) => {
    const mvgAvgDays = Math.min(idx + 1, movingAvgDays) // 7 days OR idx + 1
    let newPositivesSum = 0
    let totalTestsSum = 0
    for (let i = 0; i < mvgAvgDays; i++) {
      const curIdx = idx - i
      newPositivesSum += values[curIdx].new_positives
      totalTestsSum += values[curIdx].total_number_of_tests
    }
    values[idx].average_number_of_tests = parseInt(
      totalTestsSum / mvgAvgDays
    )
    values[idx].average_new_positives = parseInt(
      newPositivesSum / mvgAvgDays
    )
  })
}

/**
 * Gets the state-wide testing data as found on the NY DoH website.
 * "New York State Statewide COVID-19 Testing"
 * @url https://health.data.ny.gov/Health/New-York-State-Statewide-COVID-19-Testing/xdss-u53e
 * @throws Error if the response from the API is not 200.
 */
export const getStateWideTestingData = async (
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
    data = data.concat(
      requestData.map(record => {
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
    return getStateWideTestingData(limit, data.length, data)
  }
}

/**
 * Gets testing data for the state of NY.  Returns records sorted by date and
 * by county.  Also returns aggregate data by date (state-wide) and by county.
 */
export const getTestingData = async () => {
  let data = await getStateWideTestingData()
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
  // Calculate the moving averages for the aggregate dates.
  const aggregateByDayAsArray = dates.map((date) => aggregateByDate[date])
  getMovingAverage(aggregateByDayAsArray)

  for (const county in byCounty) {
    getMovingAverage(byCounty[county])
    // Now, copy this information into the rows that are sorted by date.
    byCounty[county].forEach((record, idx) => {
      const byDateIdx = byDate[record.test_date].findIndex(
        ({ county: c }) => c === county
      )
      byDate[record.test_date][byDateIdx].average_number_of_tests =
        record.average_number_of_tests
      byDate[record.test_date][byDateIdx].average_new_positives =
        record.average_new_positives
    })
    aggregateByCounty[county] = Object.assign(
      {},
      byCounty[county][byCounty[county].length - 1]
    )
    aggregateByCounty[county].last_test_date =
      aggregateByCounty[county].test_date
    delete aggregateByCounty[county].average_number_of_tests
    delete aggregateByCounty[county].average_new_positives
    delete aggregateByCounty[county].county
    delete aggregateByCounty[county].test_date
    delete aggregateByCounty[county].new_positives
    delete aggregateByCounty[county].total_number_of_tests
    delete aggregateByCounty[county].date
  }

  // Filters out data that is outside the bounds of the specified maxAge.
  filterTestingDataByDate({ data, aggregateByDate, bydate, byCounty })

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
export const sumTestingData = (records, aggregateCumulatives = false) => {
  if (!Array.isArray(records) || records.length === 0) {
    return records
  }

  const aggregateRecord = records.reduce(
    (acc, record) => {
      record = Object.assign({}, record)
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

exports.handler = async function () {
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

  if (process.env.NODE_ENV === 'test') {
    fs.mkdirSync(__dirname + '/data')
    fs.writeFileSync(
      __dirname + '/data/stats-by-county.json',
      JSON.stringify(
        {
          aggregate: aggregateByCounty,
          counties: byCounty
        },
        null,
        2
      )
    )
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

  if (process.env.NODE_ENV === 'test') {
    fs.mkdirSync(__dirname + '/data')
    fs.writeFileSync(
      __dirname + '/data/stats-by-date.json',
      JSON.stringify(
        {
          aggregate: aggregateByDate,
          dates: byDate
        },
        null,
        2
      )
    )
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
