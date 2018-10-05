const StylableWebpackPlugin = require("../../../../src");
const HtmlWebpackPlugin = require("html-webpack-plugin");
require('@ts-tools/node');

module.exports = {
  mode: "development",
  context: __dirname,
  devtool: "source-map",
  plugins: [new StylableWebpackPlugin(), new HtmlWebpackPlugin()]
};