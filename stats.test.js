jest.mock('./utils')
jest.mock('aws-sdk')
const utils = require('./utils')
const aws = require('aws-sdk')
const fs = require('fs')
const stats = require('./stats.js');

describe('stats', () => {
    const nysStateData = JSON.parse(fs.readFileSync('__mocks__/raw.json'))
    beforeEach(() => {
        utils.getAssetsBucket.mockReturnValue(Promise.resolve('foobar'))
        utils.getParameter.mockImplementation(() => {
            throw (new Error('foo'))
        })
        stats.getStateWideTestingData = jest.fn()
        stats.getStateWideTestingData.mockReturnValue(Promise.resolve(nysStateData))
        aws.S3.mockReturnValue({
            putObject: () => ({
                promise: () => Promise.resolve
            })
        })
    })
    afterEach(() => {
        jest.resetAllMocks()
    })
    it('should correctly generate data by county', async () => {
        const byCounty = stats.getTestingDataByCounty(nysStateData)
        expect(byCounty).toHaveProperty('Albany')
        expect(byCounty['Albany'][0]).toEqual(expect.objectContaining({
            test_date: expect.any(String),
            new_positives: expect.any(Number),
            cumulative_number_of_positives: expect.any(Number),
            total_number_of_tests: expect.any(Number),
            cumulative_number_of_tests: expect.any(Number),
            average_number_of_tests: expect.any(Number),
            average_new_positives: expect.any(Number)
        }))
        expect(new Date(Date.parse(byCounty['Albany'][0].test_date)) instanceof Date).toEqual(true)
        expect(byCounty['Albany'].length > 1)
        const nextIdxCumulative = byCounty['Albany'][0].cumulative_number_of_tests +
            byCounty['Albany'][1].total_number_of_tests
        expect(byCounty['Albany'][1].cumulative_number_of_tests === nextIdxCumulative)
            .toBe(true)
    })
    it('should correctly generate data by date', async () => {
        const byCounty = stats.getTestingDataByCounty(nysStateData)
        const byDate = stats.getTestingDataByDate(nysStateData, byCounty)
        const testDate = Object.keys(byDate)[0]
        expect(new Date(Date.parse(testDate)) instanceof Date).toEqual(true)
        expect(Array.isArray(byDate[testDate])).toEqual(true)
        expect(byDate[testDate][0]).toEqual(expect.objectContaining({
            county: expect.any(String),
            new_positives: expect.any(Number),
            cumulative_number_of_positives: expect.any(Number),
            total_number_of_tests: expect.any(Number),
            cumulative_number_of_tests: expect.any(Number),
            average_number_of_tests: expect.any(Number),
            average_new_positives: expect.any(Number)
        }))
    })
    it('should correctly generate moving averages', async () => {
        const byCounty = stats.getTestingDataByCounty(nysStateData)
        let sum = 0
        for (let i = byCounty['Albany'].length - 1;
            i > byCounty['Albany'].length - stats.movingAvgDays - 1;
            i--) {
            sum += byCounty['Albany'][i].total_number_of_tests
        }
        const avg = parseInt(sum / stats.movingAvgDays)
        expect(byCounty['Albany'][byCounty['Albany'].length - 1].average_number_of_tests).toEqual(avg)
    })
    it('should generate moving averages in the correct places', async () => {
        const byCounty = stats.getTestingDataByCounty(nysStateData)
        const byDate = stats.getTestingDataByDate(nysStateData, byCounty)
        const aggregateByDate = stats.getAggregateByDate(byDate)
        expect(byCounty['Albany'][0]).toHaveProperty('average_new_positives')
        expect(byDate[Object.keys(byDate)[0]][0]).toHaveProperty('average_new_positives')
        expect(aggregateByDate[Object.keys(aggregateByDate)[0]]).toHaveProperty('average_new_positives')
    })
    it('should only return the specified number of days', async () => {
        const { aggregateByDate: test1 } = await stats.getTestingData()
        expect(Object.keys(test1).length).toEqual(30)
        stats.defaultMaxAgeInDays = 10
        const { aggregateByDate: test2 } = await stats.getTestingData()
        expect(Object.keys(test2).length).toEqual(10)
    })
    it('generates stats', async () => {
        await stats.handler();
    })
})
