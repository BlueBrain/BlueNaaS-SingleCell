const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const { AureliaPlugin, ModuleDependenciesPlugin } = require('aurelia-webpack-plugin');
const { ProvidePlugin, DefinePlugin } = require('webpack')

const title = 'Blue Neuroscience as a Service Single Cell';
const outDir = path.resolve(__dirname, 'dist');
const srcDir = path.resolve(__dirname, 'src');
const nodeModulesDir = path.resolve(__dirname, 'node_modules');
const baseUrl = '/';
const version = process.env.VERSION;
const appKey = 'blue-naas';
const wsUrl = process.env.WS_URL;
const neuronVersion = process.env.NEURON_VERSION;

const cssRules = ['css-loader']

module.exports = (env, argv) => {
  let production = null;
  if (argv.mode === 'production') {
    production = true;
  } else {
    production = false;
  }
  return {
  resolve: {
    extensions: ['.js'],
    modules: [srcDir, 'node_modules'],
  },
  devtool: production ? 'source-map' : 'inline-source-map',
  devServer: {
    hot: true,
    allowedHosts: new URL(wsUrl).hostname,
  },
  entry: {
    app: ['aurelia-bootstrapper'],
    vendor: ['jquery', 'bootstrap'],
  },
  resolveLoader: {
    alias: {
      text: 'raw-loader'
    }
  },
  output: {
    path: outDir,
    publicPath: baseUrl,
    filename: production ? '[name].[chunkhash].bundle.js' : '[name].[fullhash].bundle.js',
    chunkFilename: production ? '[name].[chunkhash].chunk.js' : '[name].[fullhash].chunk.js',
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        issuer: { not: [ /\.html$/i ]},
        use: [
          production ? MiniCssExtractPlugin.loader : 'style-loader',
          ...cssRules
        ]
      },
      {
        test: /\.css$/i,
        issuer: /\.html$/i,
        use: cssRules,
      },
      { test: /\.html$/i, loader: 'html-loader' },
      { test: /\.js$/i,
        use: {
          loader: 'babel-loader',
          options: { presets: ['@babel/preset-env'] },
        },
        exclude: nodeModulesDir,
      },
      { test: /\.(ttf|eot|svg|otf)(\?v=[0-9]\.[0-9]\.[0-9])?$/i, loader: 'file-loader' },
    ]
  },
  plugins: [
    new AureliaPlugin(),
    new ModuleDependenciesPlugin({
      'aurelia-ui-framework': [ './ui-glyphs.html' ]
    }),
    new HtmlWebpackPlugin({
      template: 'index.ejs',
      minify: production ? {
        removeComments: true,
        collapseWhitespace: true
      } : undefined,
      metadata: {
        title, server: !production, baseUrl
      },
    }),
    new MiniCssExtractPlugin({
      filename: production ? '[name].[fullhash].css' : '[name].css',
      chunkFilename: production ? '[id].[fullhash].css' : '[id].css',
    }),
    new DefinePlugin({
      PRODUCTION:     JSON.stringify(production),
      TITLE:          JSON.stringify(title),
      APP_KEY:        JSON.stringify(appKey),
      WS_URL:         JSON.stringify(wsUrl),
      VERSION:        JSON.stringify(version),
      NEURON_VERSION: JSON.stringify(neuronVersion),
    }),
    new CopyWebpackPlugin({
      patterns: [{ from: 'static/favicon.ico', to: 'favicon.ico' }]
    }),
  ],
}}
