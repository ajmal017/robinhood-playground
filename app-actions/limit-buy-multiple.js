const simpleBuy = require('./simple-buy');

const alpacaMarketBuy = require('../alpaca/market-buy');
const alpacaLimitBuy = require('../alpaca/limit-buy');
const alpacaAttemptBuy = require('../alpaca/attempt-buy');

const mapLimit = require('promise-map-limit');
const sendEmail = require('../utils/send-email');
const lookup = require('../utils/lookup');
const Holds = require('../models/Holds');
const { alpaca } = require('../alpaca');
const getBalance = require('../alpaca/get-balance');



const sprayBuy = async ({
    ticker,
    quantity,
    pickPrice
}) => {

    const individualQuantity = Math.round(quantity / 3) || 1;

    const buyStyles = {
        limit3: alpacaLimitBuy({
            ticker,
            quantity: individualQuantity,
            limitPrice: pickPrice * 1.03,
            timeoutSeconds: 60 * 2,
            fallbackToMarket: false
        }),
        limit1: alpacaLimitBuy({
            ticker,
            quantity: individualQuantity,
            limitPrice: pickPrice * 1.013,
            timeoutSeconds: 60 * 5,
            fallbackToMarket: false
        }),
        attempt: alpacaAttemptBuy({
            ticker,
            quantity: individualQuantity,
            pickPrice,
            fallbackToMarket: false
        }),
        limit98: alpacaLimitBuy({
            ticker,
            quantity: individualQuantity,
            limitPrice: pickPrice * .98,
            timeoutSeconds: 60 * 16,
            fallbackToMarket: false
        }),
    };
    
    const buyPromises = Object.entries(buyStyles).map(
        async ([name, promise]) => {
            strlog({
                name,
                promise
            })
            const response = await promise;
            const order = response && response.alpacaOrder ? response.alpacaOrder : response;
            return {
                name,
                fillPrice: (order || {}).filled_avg_price
            };
        }
    );


    const roundUp = await Promise.all(
        buyPromises
    );

    await sendEmail(`roundup for ${ticker} buy`, JSON.stringify(roundUp, null, 2))

};



module.exports = async ({
    totalAmtToSpend,
    strategy,
    maxNumStocksToPurchase, 
    min, 
    withPrices,
} = {}) => {

    let stocksToBuy = withPrices.map(obj => obj.ticker);
    // you cant attempt to purchase more stocks than you passed in
    // console.log(maxNumStocksToPurchase, 'numstockstopurchase', stocksToBuy.length);
    maxNumStocksToPurchase = maxNumStocksToPurchase ? Math.min(stocksToBuy.length, maxNumStocksToPurchase) : stocksToBuy.length;

    let numPurchased = 0;

    // randomize the order
    stocksToBuy = stocksToBuy.sort(() => Math.random() > Math.random());
    // let amtToSpendLeft = totalAmtToSpend;
    let failedStocks = [];


    const perStock = strategy.includes('average-down-recommendation')
        ? totalAmtToSpend / 2.7
        : totalAmtToSpend;

    await mapLimit(stocksToBuy, 3, async ticker => {       // 3 buys at a time

            
        // dont buy stocks if more than 40 percent of current balance!
        let currentValue, percOfBalance = 0;
        try {
            currentValue = (await alpaca.getPosition(ticker)).market_value;
            const balance = await getBalance();
            percOfBalance = currentValue / balance * 100;
        } catch (e) {}
        if (percOfBalance > 40) {
            return console.log(`NOT PURCHASING ${ticker} because ${percOfBalance}% of balance`);
        }
        console.log({ percOfBalance, ticker })

        // for now same amt each stock
        //amtToSpendLeft / (maxNumStocksToPurchase - numPurchased);
        console.log(perStock, 'purchasng ', ticker);
        try {
            const pickPrice = (withPrices.find(obj => obj.ticker === ticker) || {}).price;
            const totalQuantity = Math.round(perStock / pickPrice) || 1;

            const waitAmts = [0, 5, 10, 20, 30, 40];
            const perSpray = Math.round(totalQuantity / waitAmts.length) || 1;
            console.log('before sprays', { totalQuantity, perSpray });
            await Promise.all(
                waitAmts.map(
                    async waitAmt => {
                        console.log(`waiting ${waitAmt} seconds and then spraying ${perSpray} quantity`);
                        await new Promise(resolve => setTimeout(resolve, waitAmt * 1000));
                        await sprayBuy({
                            ticker,
                            quantity: perSpray,
                            pickPrice
                        });
                    }
                )
            );
            

            numPurchased++;
        } catch (e) {
            // failed
            failedStocks.push(ticker);
            console.log('failed purchase for ', ticker, e);
        }
    });

    // console.log('finished purchasing', stocksToBuy.length, 'stocks');
    // console.log('attempted amount', totalAmtToSpend);
    // // console.log('amount leftover', amtToSpendLeft);
    // if (failedStocks.length) {
    //     await sendEmail(`failed to purchase`, JSON.stringify(failedStocks));
    // }
};
