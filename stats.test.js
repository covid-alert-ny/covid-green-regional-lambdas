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
