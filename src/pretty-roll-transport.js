const prettyFactory = require('pino-pretty');
const roll = require('pino-roll');

module.exports = async function (opts) {
  const rollStream = await roll(opts);

  const prettyStream = prettyFactory({
    colorize: false,
    ignore: 'pid,hostname',
    translateTime: 'SYS:standard',
    destination: rollStream,
  });

  return prettyStream;
};
