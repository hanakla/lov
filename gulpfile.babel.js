const gulp = require("gulp");
const $ = require("gulp-load-plugins")();
const webpack = require("webpack");
const path = require("path");

export function stylus() {
    return gulp.src("static/style/**/*.styl")
        .pipe($.plumber())
        .pipe($.stylus({
            compress: true,
            use : [require("nib")()]
        }))
        .pipe(gulp.dest("build/style/"));
}

export function copyImages() {
    return gulp.src("static/images/**/*")
        .pipe(gulp.dest("build/images/"));
}

export function copyFonts() {
    return gulp.src("static/fonts/**/*")
        .pipe(gulp.dest("build/fonts"));
}

export function buildWebpack(done) {
    webpack({
        // target: "web",
        entry: {
            main: "main"
        },
        output: {
            filename: "[name].js",
            sourceMapFilename: "map/[file].map",
            path: path.join(__dirname, "build/js/"),
        },
        devtool: "#source-map",
        resolve: {
            root: [path.join(__dirname, "static/js/")],
            modulesDirectories: ["bower_components", "node_modules"]
        },
        externals: {
            "window": "window",
            "document": "document",
        },
        module: {
            loaders: [
                {
                    test: /\.js$/,
                    loader: "babel-loader",
                    exclude: /(node_modules|bower_components)/,
                    query: {
                        presets: ["es2015"],
                        plugins: [
                            "transform-runtime"
                        ]
                    }
                }
            ]
        },
        plugins: [
            new webpack.ResolverPlugin(new webpack.ResolverPlugin.DirectoryDescriptionFilePlugin("bower.json", ["main"])),
            new webpack.ResolverPlugin(new webpack.ResolverPlugin.DirectoryDescriptionFilePlugin("component.json", ["main"])),
            new webpack.optimize.AggressiveMergingPlugin,
            new webpack.optimize.DedupePlugin,
            new webpack.optimize.UglifyJsPlugin,
        ]
    },  function(err, stats) {
        if (err) {
            console.log(err);
        }

        done(err);
    });
}

export function watch() {
    gulp.watch("static/style/**/*.styl", stylus);
    gulp.watch("static/fonts/**/*", copyFonts);
    gulp.watch("static/images/**/*", copyImages);
    gulp.watch("static/js/**/*.js", buildWebpack);
}

const build = gulp.parallel(stylus, copyImages, copyFonts, buildWebpack);
const buildWatch = gulp.series(build, watch);

export {build, buildWatch};
export default buildWatch;
