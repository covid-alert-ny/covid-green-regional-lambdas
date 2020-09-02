const utilsFile = Object.assign({}, require('./utils'))
jest.mock('./utils', () => () => (Object.assign({}, utilsFile, {
    getAssetsBucket: 'foobar'
})))
const aws = Object.assign({}, reuqire('aws-sdk'))
jest.mock('aws-sdk', () => () => (Object.assign({}, aws, {
    S3: function () {
        return {
            putObject: () => ({
                promise: Promise.resolve
            })
        }
    }
})))
const {
    filterDates,
    filterDatesByDateKey,
    filterTestingDataByDate,
    getMovingAverage,
    getStateWideTestingData,
    getTestingData,
    sumTestingData,
    handler
} = require(__dirname + '/stats.js');

describe('stats', () => {
    it('generates test stats', async () => {
        await handler();
    })
})
