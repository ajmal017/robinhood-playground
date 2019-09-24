const fs = require('mz/fs');
const { mapObject } = require('underscore');
const { avgArray } = require('../../utils/array-math');

module.exports = async (daysBack = 5, filterStr = '') => {
  daysBack = Number(daysBack);
  let files = await fs.readdir('./json/pm-perfs');

  let sortedFiles = files
      .map(f => f.split('.')[0])
      .sort((a, b) => new Date(a) - new Date(b));

  
  const filesOfInterest = sortedFiles.slice(0 - daysBack);

  strlog({ filesOfInterest })

  const byPm = {};
  for (let file of filesOfInterest) {
    const json = require(`../../json/pm-perfs/${file}`);
    json.forEach(({ pmName, avgTrend, percUp }) => {
      byPm[pmName] = {
        ...byPm[pmName],
        [file]: {
          avgTrend,
          percUp: percUp / 100
        }
      };
    });
  }

  strlog({ byPm });

  const getMin = dateObj => Math.min(...Object.values(dateObj).map(({ avgTrend }) => avgTrend));

  const fire = Object.keys(byPm)
    .filter(pm => pm.includes(filterStr))
    .map(pm => ({
      pm,
      dateObj: byPm[pm],
    }))
    .filter(({ dateObj }) => {
      return Object.keys(dateObj).length > 2
    })
    .map(pmObj => ({
      ...pmObj,
      min: getMin(pmObj.dateObj),
      avgTrend: avgArray(Object.values(pmObj.dateObj).map(({ avgTrend }) => avgTrend).filter(Boolean))
    }))
    .map(pmObj => ({
      ...pmObj,
      metric: pmObj.avgTrend + pmObj.min * 4
    }))
    .sort((a, b) => {
      return b.metric - a.metric;
    });

  strlog({fire});

  const analyzed = mapObject(
    byPm,
    dateObj => ['avgTrend', 'percUp'].reduce((acc, key) => {

      const trends = Object.values(dateObj);
      const val = avgArray(
        trends.map(t => t[key])
      );

      return {
        ...acc,
        [key]: val
      };

    }, {})
  )

  strlog({ analyzed });

  return analyzed;

}