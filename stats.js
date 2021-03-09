const axios = require('axios')
const AWS = require('aws-sdk')
if (process.env.NODE_ENV === 'test') {
  var fs = require('fs')
  var path = require('path')
}
const {
  getAssetsBucket,
  getNYSDataUrl,
  getParameter,
  getSocrataKey,
  runIfDev
} = require('./utils')
const oneDayInMilliseconds = 1000 * 60 * 60 * 24
exports.defaultMaxAgeInDays = 30 // 30 days.
exports.movingAvgDays = 7 // 7 days.

/**
 * Given an iterable object with each object containing `test_date` filters
 * out records with a date past the `maxAge` cutoff.
 * @param {*} iterable
 */
exports.filterDates = (iterable, maxAge) => {
  // This alleviates testing purposes when using mock data.
  let mostRecentDate = 0
  iterable.forEach(record => {
    if (Date.parse(record.test_date) > mostRecentDate) {
      mostRecentDate = Date.parse(record.test_date)
    }
  })
  return iterable
    .map(record => {
      if (
        Date.parse(record.test_date) + maxAge * oneDayInMilliseconds <
        mostRecentDate + 1000 * 60 * 60 * 24
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
exports.filterDatesByDateKey = (dateIterable, maxAge) => {
  // This alleviates testing purposes when using mock data.
  let mostRecentDate = 0
  for (const date in dateIterable) {
    if (Date.parse(date) > mostRecentDate) {
      mostRecentDate = Date.parse(date)
    }
  }
  for (const date in dateIterable) {
    if (
      Date.parse(date) + maxAge * oneDayInMilliseconds <
      mostRecentDate + 1000 * 60 * 60 * 24
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
exports.filterTestingDataByDate = async ({
  data,
  aggregateByDate,
  byDate,
  byCounty
}) => {
  let maxAge
  try {
    maxAge = parseInt(await getParameter('stats_max_age'))
  } catch (err) {
    console.log(
      `could not load "stats_max_age", using default value "${exports.defaultMaxAgeInDays}"`
    )
    maxAge = exports.defaultMaxAgeInDays
  }
  data = exports.filterDates(data, maxAge)
  exports.filterDatesByDateKey(aggregateByDate, maxAge)
  exports.filterDatesByDateKey(byDate, maxAge)
  for (const county in byCounty) {
    byCounty[county] = exports.filterDates(byCounty[county], maxAge)
  }
}

/**
 * Gets the records aggregated by county.
 */
exports.getAggregateByCounty = byCounty => {
  const aggregateByCounty = {}
  for (const county in byCounty) {
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

  return aggregateByCounty
}

/**
 * Aggregates data across all counties by date.  For each day, calculates a
 * moving average.
 */
exports.getAggregateByDate = byDate => {
  const aggregateByDate = {}
  for (const date in byDate) {
    aggregateByDate[date] = exports.sumTestingData(byDate[date], true)
  }
  // Calculate the moving averages for the aggregate dates.
  const aggregateByDayAsArray = Object.keys(aggregateByDate).map(
    date => aggregateByDate[date]
  )
  exports.getMovingAverage(aggregateByDayAsArray)

  // Remove unwanted values after using test_date in moving average calc sorter
  for (const stat in aggregateByDate) {
    delete stat.county
    delete stat.test_date
  }
  return aggregateByDate
}

/**
 * Given an iterable object with the values per index `new_positives` and
 * `total_number_of_tests`, sums a moving average as close to `movingAvgDays`
 * as possible.
 */
exports.getMovingAverage = iterable => {
  iterable.sort((a, b) => {
    return Date.parse(a.test_date) > Date.parse(b.test_date) ? 1 : -1
  })
  iterable.forEach((value, idx) => {
    const mvgAvgDays = Math.min(idx + 1, exports.movingAvgDays) // 7 days OR idx + 1
    let newPositivesSum = 0
    let totalTestsSum = 0
    for (let i = 0; i < mvgAvgDays; i++) {
      const curIdx = idx - i
      newPositivesSum += iterable[curIdx].new_positives
      totalTestsSum += iterable[curIdx].total_number_of_tests
    }
    iterable[idx].average_number_of_tests = Number(
      (totalTestsSum / mvgAvgDays).toFixed(2)
    )
    iterable[idx].average_new_positives = Number(
      (newPositivesSum / mvgAvgDays).toFixed(2)
    )
  })
}

/**
 * Gets the state-wide testing data as found on the NY DoH website.
 * "New York State Statewide COVID-19 Testing"
 * @url https://health.data.ny.gov/Health/New-York-State-Statewide-COVID-19-Testing/xdss-u53e
 * @throws Error if the response from the API is not 200.
 */
exports.getStateWideTestingData = async (
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
    return exports.getStateWideTestingData(limit, data.length, data)
  }
}

/**
 * @returns Data from state but sorted by county.
 */
exports.getTestingDataByCounty = data => {
  const byCounty = {}
  data.forEach(record => {
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

  // Calculate the moving average.
  Object.keys(byCounty).forEach(county =>
    exports.getMovingAverage(byCounty[county])
  )

  return byCounty
}

/**
 * @returns Data from state but sorted by county.
 */
exports.getTestingDataByDate = (data, byCounty) => {
  const byDate = {}
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
  })

  // Assign moving average values to byDate records.
  for (const county in byCounty) {
    byCounty[county].forEach((record, idx) => {
      const byDateIdx = byDate[record.test_date].findIndex(
        ({ county: c }) => c === county
      )
      byDate[record.test_date][byDateIdx].average_number_of_tests =
        record.average_number_of_tests
      byDate[record.test_date][byDateIdx].average_new_positives =
        record.average_new_positives
    })
  }

  return byDate
}

/**
 * Gets testing data for the state of NY.  Returns records sorted by date and
 * by county.  Also returns aggregate data by date (state-wide) and by county.
 */
exports.getTestingData = async () => {
  const data = await exports.getStateWideTestingData()
  const byCounty = exports.getTestingDataByCounty(data)
  const byDate = exports.getTestingDataByDate(data, byCounty)
  const aggregateByCounty = exports.getAggregateByCounty(byCounty)
  const aggregateByDate = exports.getAggregateByDate(byDate)

  // Filters out data that is outside the bounds of the specified maxAge.
  await exports.filterTestingDataByDate({
    data,
    aggregateByDate,
    byDate,
    byCounty
  })

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
exports.sumTestingData = (records, aggregateCumulatives = false) => {
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

exports.handler = async function() {
  const s3 = new AWS.S3({ region: process.env.AWS_REGION })
  const bucket = await getAssetsBucket()
  const {
    aggregateByCounty,
    aggregateByDate,
    byDate,
    byCounty
  } = await exports.getTestingData()

  const statsObject = {
    ACL: 'private',
    Bucket: bucket,
    ContentType: 'application/json'
  }

  console.log(process.env.NODE_ENV)
  if (process.env.NODE_ENV === 'test') {
    try {
      fs.mkdirSync(path.join(__dirname, '/data'))
    } catch (e) {}
    fs.writeFileSync(
      path.join(__dirname, '/data/stats-by-county.json'),
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
    try {
      fs.mkdirSync(path.join(__dirname, '/data'))
    } catch (e) {}
    fs.writeFileSync(
      path.join(__dirname, '/data/stats-by-date.json'),
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
