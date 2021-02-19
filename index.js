const match = require('./match').default

const app = require('express')();
const logger = require('log4js').getLogger();
const cookieParser = require('cookie-parser');
const proxy = require('http-proxy').createProxyServer(null);
const jwt = require("jsonwebtoken");
const expressModifyResponse = require('express-modify-response');
const fetch = require('node-fetch');

logger.level = 'info';

let enableAuth;
let authRule;
let authSecret;
let authKey;
let basePath;
let router;
// 请求路由配置的url
let remoteRouterPath;
try {
    start();
    app.listen(8899, function () {
        logger.info('应用实例正在监听%s端口\n', 8899);
    });
} catch (error) {
    logger.error(error);
}

function testConfig() {
    router =
        {
            // "login": {
            //     "target": "http://baidu.com",
            //     "authIncludes": [],
            //     "authExcludes": []
            // },
            // "test": {
            //     "target": "http://127.0.0.1:9999/",
            //     "authIncludes": [],
            //     "authExcludes": []
            // }
        }
    authRule = {"includes": [], "excludes": []}
    enableAuth = "true"
    basePath = "service"
    authKey = "token"
    authSecret = "sylas2020"
    remoteRouterPath = 'http://admin.ashe.jinuo.fun/api/accessHole/definitions'
}

function applyRoute() {
    for (const module in router) {
        const from = `/${basePath}/${module}`
        let definition = router[module];
        if (definition.authInclude || definition.authExclude) {
            applyAuth(module, {
                includes: definition.authInclude,
                excludes: definition.authExclude
            });
        } else {
            applyAuth()
        }
        let to = definition.target;
        logger.info(`注册 请求地址[${from}] 到 目的地址[${to}]`);

        switch (module) {
            case "xxl-job":
                applyRedirectXxlJob(from);
                break
            case "nacos":
                applyRedirectNacos(from);
                break
            case "rabbitmq":
                applyRedirectRabbitMq(from);
                break
            case "sentinel":
                applyRedirectSentinel(from);
                break
        }
        applyProxy(from, to)
    }
}

function start() {
    if (process.env['REMOTE_ROUTER']) {
        router = JSON.parse(process.env['ROUTERS'])
        enableAuth = process.env['AUTH_ENABLE'] || "true";
        authRule = JSON.parse(process.env['AUTH_RULE'] || '{"includes": [], "excludes":[]}')
        authKey = process.env['AUTH_KEY'] || "token";
        authSecret = process.env['AUTH_SECRET'] || "sylas2020";
        remoteRouterPath = process.env['REMOTE_ROUTER'] || 'http://127.0.0.1:8080'
        basePath = process.env['BASE_PATH'] || "service"

    } else {
        testConfig()
    }

    if (remoteRouterPath) {
        setInterval(() => {
            fetch(remoteRouterPath).then(async res => {
                    if (res) {
                        router = await res.json();
                        applyRoute()
                    }
                }
            ).catch(e => {
                logger.error(e)
            })
        }, 10000);
    }
    applyPathFix()
    app.use(cookieParser());
    applyRoute();

}

function applyRedirectXxlJob(fromPath) {
    app.use(fromPath, expressModifyResponse(
        (req, res) => {
            if (res.getHeader('Content-Type') === undefined) return false
            if (res.getHeader('Content-Type').startsWith('text/html')) return true;
            if (res.getHeader('Content-Type').startsWith('text/css')) return true;
            if (res.getHeader('Content-Type').startsWith('application/javascript')) return true;
            return false;
        }, (req, res, body) => {
            return body.toString()
                .replace(/\/xxl-job-admin\/static/g, fromPath + "xxl-job-admin/static")
                .replace(/var base_url = '\/xxl-job-admin'/g, "var base_url = '" + fromPath + "xxl-job-admin'")
                .replace(/<a href="\/xxl-job-admin/g, "<a href=\"" + fromPath + "xxl-job-admin")
        }
    ))
}

function applyRedirectRabbitMq(fromPath) {
    app.use(fromPath, expressModifyResponse(
        (req, res) => {
            if (res.getHeader('Content-Type') === undefined) return false
            if (res.getHeader('Content-Type').startsWith('text/html')) return true;
            if (res.getHeader('Content-Type').startsWith('text/css')) return true;
            if (res.getHeader('Content-Type').startsWith('application/javascript')) return true;
            if (res.getHeader('Content-Type').startsWith('application/octet-stream')) return true;
            return false;
        }, (req, res, body) => {
            return body.toString()
        }
    ))
}

function applyRedirectNacos(fromPath) {
    app.use(fromPath, expressModifyResponse(
        (req, res) => {
            if (res.getHeader('Content-Type') === undefined) return false
            if (res.getHeader('Content-Type').startsWith('text/html')) return true;
            if (res.getHeader('Content-Type').startsWith('text/css')) return true;
            if (res.getHeader('Content-Type').startsWith('application/javascript')) return true;
            return false;
        }, (req, res, body) => {
            return body.toString()
                .replace(/\/nacos\/console-fe/g, fromPath + "nacos/console-fe")
        }
    ))
}


function applyRedirectSentinel(fromPath) {
    app.use(fromPath, expressModifyResponse(
        (req, res) => {
            if (res.getHeader('Content-Type') === undefined) return false
            if (res.getHeader('Content-Type').startsWith('text/html')) return true;
            if (res.getHeader('Content-Type').startsWith('text/css')) return true;
            if (res.getHeader('Content-Type').startsWith('application/javascript')) return true;
            return false;
        }, (req, res, body) => {
            return body.toString()
                .replace(/.\/lib/g, fromPath + "lib")
                .replace(/.\/dist/g, fromPath + "dist")
                .replace(/app\/views/g, fromPath + "app\/views")
                .replace(/app\/scripts/g, fromPath + "app\/scripts")
                .replace(/\(\{url:"\//g, "({url:\"" + fromPath)
                .replace(/\(\{url:"app/g, "({url:\"" + fromPath + "app")
                .replace(/..\/..\/assets\/img\/sentinel-logo.png/g, fromPath + "assets/img/sentinel-logo.png")
        }
    ))
}

function applyAuth(module, rules) {
    if (enableAuth) {
        app.use(function (req, res, next) {
            // 鉴权
            let requestIp = req.ip;
            let requestUrl = req.originalUrl;
            logger.debug(`IP [${requestIp}] 正在访问 ${requestUrl}`);
            if (rules && enableAuth !== "false" && match(rules, requestUrl)) {
                return doAuth(req, res, requestIp, requestUrl, next);
            } else {
                next();
            }
        });
    }
}

function applyProxy(fromPath, to) {
    app.use(fromPath, function (req, res, next) {
        proxy.web(req, res, {
            changeOrigin: true,
            target: to
        }, next);
    })
}

function doAuth(req, res, requestIp, requestUrl,next) {
    if (authSecret && authKey && req.cookies) {
        const token = req.cookies[authKey];
        if (token == null) {
            logger.error(`[No Permission] IP [${requestIp}] 正在访问 ${requestUrl}`);
            return res.sendStatus(401);
        }
        jwt.verify(token, authSecret, (err, user) => {
            if (err) {
                logger.error(`[Invalid Token] IP [${requestIp}] 正在访问 ${requestUrl}`);
                return res.sendStatus(403);
            }
            logger.debug(`用户 [${user}] IP [${requestIp}] 正在访问 ${requestUrl}`);
            req.headers['access-payload'] = user.payload
            next()
        });
    } else {
        logger.error(`[No Auth Info] IP [${requestIp}] 正在访问 ${requestUrl}`);
        return res.sendStatus(401);
    }
}

function applyPathFix() {
    // 一点点修补，主要为了解决 rabbitmq 在没有结尾 / 的时候转发错误的问题
    proxy.on('proxyReq', function (proxyReq, req, res, options) {
        if (req.originalUrl === req.baseUrl) {
            res.redirect(req.originalUrl + '/')
        }
    });
    proxy.on('proxyRes', function (proxyRes, req, res, options) {
        if (proxyRes.statusCode === 302) {
            let jumpTo = proxyRes.headers['location']
            if (jumpTo.startsWith('http')) {
                jumpTo = jumpTo.substr(jumpTo.substr(8).indexOf('/') + 8)
            }
            proxyRes.headers['location'] = req.baseUrl + jumpTo
        }
        res.statusCode = proxyRes.statusCode
        if (res.statusCode === 403) {
            res.redirect(`/${basePath}/login`)
        }
    });
}

