const path = require('path')
const webpack = require('webpack')

module.exports = {
    // target: "web",
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    context: path.join(__dirname, "static/js/"),
    entry: {
        main: "./main"
    },
    output: {
        filename: "[name].js",
        sourceMapFilename: "map/[file].map",
        path: path.join(__dirname, "build/js/"),
    },
    devtool: "#source-map",
    externals: {
        "window": "window",
        "document": "document",
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                loader: "babel-loader",
                exclude: /(node_modules)/,
            }
        ]
    },
    plugins: [
        new webpack.optimize.AggressiveMergingPlugin(),
    ]
}
