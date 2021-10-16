'use strict';

const {PuppeteerExtraPlugin} = require('puppeteer-extra-plugin');

const utils = require('../_utils');
const withUtils = require('../_utils/withUtils');

const {generateMimeTypeArray} = require('./mimeTypes');
const {generatePluginArray} = require('./plugins');
const {generateMagicArray} = require('./magicArray');
const {generateFunctionMocks} = require('./functionMocks');

const orgData = require('./data.json');
const withWorkerUtils = require('../_utils/withWorkerUtils');

/**
 * In headless mode `navigator.mimeTypes` and `navigator.plugins` are empty.
 * This plugin emulates both of these with functional mocks to match regular headful Chrome.
 *
 * Note: mimeTypes and plugins cross-reference each other, so it makes sense to do them at the same time.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/NavigatorPlugins/mimeTypes
 * @see https://developer.mozilla.org/en-US/docs/Web/API/MimeTypeArray
 * @see https://developer.mozilla.org/en-US/docs/Web/API/NavigatorPlugins/plugins
 * @see https://developer.mozilla.org/en-US/docs/Web/API/PluginArray
 */
class Plugin extends PuppeteerExtraPlugin {

    constructor(opts = {data: orgData}) {
        super(opts);
    }

    get name() {
        return 'evasions/navigator.plugins';
    }

    async onPageCreated(page) {
        await withUtils(page).evaluateOnNewDocument(
            this.mainFunction,
            {
                // We pass some functions to evaluate to structure the code more nicely
                fns: utils.stringifyFns({
                    generateMimeTypeArray,
                    generatePluginArray,
                    generateMagicArray,
                    generateFunctionMocks,
                }),
                data: this.opts.data,
            },
        );
    }

    mainFunction = (utils, {fns, data}) => {
        fns = utils.materializeFns(fns);

        const _Object = utils.cache.Prototype.Object;

        // That means we're running headful
        // const hasPlugins = 'plugins' in navigator && navigator.plugins.length
        // if (hasPlugins) {
        //   return // nothing to do here
        // }

        const mimeTypes = fns.generateMimeTypeArray(utils, fns)(data.mimeTypes);
        const plugins = fns.generatePluginArray(utils, fns)(data.plugins);

        const enabledPluginSets = new Set();

        // Plugin and MimeType cross-reference each other, let's do that now
        // Note: We're looping through `data.plugins` here, not the generated `plugins`
        for (const pluginData of data.plugins) {
            pluginData.__mimeTypes.forEach((type, index) => {
                plugins[pluginData.name][index] = mimeTypes[type];

                _Object.defineProperty(plugins[pluginData.name], type, {
                    value: mimeTypes[type],
                    writable: false,
                    enumerable: false, // Not enumerable
                    configurable: true,
                });

                if (!enabledPluginSets.has(mimeTypes[type])) {
                    _Object.defineProperty(mimeTypes[type], 'enabledPlugin', {
                        value:
                            type === 'application/x-pnacl'
                                ? mimeTypes['application/x-nacl'].enabledPlugin // these reference the same plugin, so we need to re-use the Proxy in order to avoid leaks
                                // : utils.newProxyInstance(plugins[pluginData.name], {}), // Prevent circular references
                                : plugins[pluginData.name], // Prevent circular references
                        writable: false,
                        enumerable: false, // Important: `JSON.stringify(navigator.plugins)`
                        configurable: true,
                    });

                    enabledPluginSets.add(mimeTypes[type]);
                }
            });
        }

        utils.replaceGetterWithProxy(Navigator.prototype, 'plugins', utils.makeHandler().getterValue(plugins));
        utils.replaceGetterWithProxy(Navigator.prototype, 'mimeTypes', utils.makeHandler().getterValue(mimeTypes));

        // All done
    };

}

module.exports = function (pluginConfig) {
    return new Plugin(pluginConfig);
};