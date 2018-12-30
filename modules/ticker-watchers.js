const stocks = require('../stocks');
const allStocks = require('../json/stock-data/allStocks');
const HistoricalTickerWatcher = require('../socket-server/historical-ticker-watcher');
const { lookupTickers } = require('../app-actions/record-strat-perfs');
const getTrend = require('../utils/get-trend');
const { isTradeable } = require('../utils/filter-by-tradeable');
const { avgArray } = require('../utils/array-math');
const sendEmail = require('../utils/send-email');
const regCronIncAfterSixThirty = require('../utils/reg-cron-after-630');
const recordPicks = require('../app-actions/record-picks');

let tickerWatcher;
let bigJumps = [];
let relatedP;

const onEnd = () => {
    console.log();
    bigJumps = bigJumps
        .map(jump => ({
            ...jump,
            finalPrice: relatedP[jump.ticker].pop().lastTradePrice
        }))
        .map(jump => ({
            ...jump,
            trend: getTrend(jump.finalPrice, jump.jumpPrice)
        }))
        .sort((a, b) => b.trendFromMin - a.trendFromMin);
    
    console.log('HERE');
    console.log(JSON.stringify(bigJumps, null ,2))


    const avgTrend = avgArray(bigJumps.map(j => j.trend));
    console.log({ avgTrend });
    bigJumps.forEach(jump => console.log(jump));
};



module.exports = {
    name: 'ticker-watchers',
    init: async (Robinhood) => {

        regCronIncAfterSixThirty(Robinhood, {
            name: `clear ticker-watchers price cache`,
            run: [0],
            fn: () => tickerWatcher.clearPriceCache()
        });

        // setTimeout(async () => {
        //     console.log('recording based-on-jump-fourToEightOvernight-trending35257-gt500kvolume-first2-5');
        //     await recordPicks(Robinhood, 'based-on-jump-fourToEightOvernight-trending35257-gt500kvolume-first2', 5, ['BPMX']);
        // }, 10000);

        const handler = async relatedPrices => {
            // console.log({ relatedPrices, two });
            relatedP = relatedPrices;
            const newJumps = [];
            Object.keys(relatedPrices).forEach(key => {
                const allPrices = relatedPrices[key].map(obj => obj.lastTradePrice);
                const mostRecent = allPrices.pop();
                const min = Math.min(...allPrices);
                const trendFromMin = getTrend(mostRecent, min);
                const bigJump = trendFromMin < -10;
                // console.log({ min, trendFromMin })
                if (bigJump && allPrices.length) {
                    console.log('found big jump', key, mostRecent, allPrices.length);
                    newJumps.push({
                        ticker: key,
                        jumpPrice: mostRecent,
                        trendFromMin
                    });
                }
            });

            for (let jump of newJumps) {
                await sendEmail(`robinhood-playground: NEW JUMP DOWN ${jump.ticker}`, JSON.stringify(jump, null, 2));
                await recordPicks(Robinhood, 'ticker-watchers-under5', 5000, [jump.ticker]);
            }

            bigJumps = [ ...bigJumps, ...newJumps];

        };
        
        tickerWatcher = new HistoricalTickerWatcher({
            name: 'ticker-watchers',
            Robinhood,
            handler,
            timeout: 60000 * 5, // 5 min,
            runAgainstPastData: false,
            onEnd
        });

        const allUnder5 = await (async () => {
            const tickPrices = await lookupTickers(Robinhood, allStocks.filter(isTradeable).map(o => o.symbol));
            return Object.keys(tickPrices).filter(ticker => tickPrices[ticker] < 5 && tickPrices[ticker] > 1);
        })();
        console.log({ allUnder5 });
        tickerWatcher.addTickers(allUnder5);
        tickerWatcher.start();
    }
};