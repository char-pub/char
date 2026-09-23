# R2 桶配置

四个桶：`charpub-public`、`charpub-private`、`charpub-uploads`、`charpub-evidence`。这里的 JSON 是各桶的 CORS 规则：

```sh
wrangler r2 bucket cors set charpub-uploads --file infra/r2/cors-uploads.json
wrangler r2 bucket cors set charpub-public  --file infra/r2/cors-public.json
wrangler r2 bucket cors set charpub-private --file infra/r2/cors-read.json
wrangler r2 bucket lifecycle add charpub-uploads expire-uploads --expire-days 1 --abort-multipart-days 1 --force
wrangler r2 bucket domain add charpub-public --domain assets.char.pub --zone-id <char.pub zone id> --min-tls 1.2
```

- uploads：浏览器用 API 签发的预签名 URL 直接 `PUT` 原件，只允许 web 的来源，请求头只允许上传时需要的几个。
- public：允许任何来源的 `GET` / `HEAD`。桶里只有公开、按内容寻址的对象，本来就能匿名下载，请求也不带凭据，所以 `*` 不泄露任何东西。不能只允许 www：公开下载由 API 302 重定向到 `assets` 域名，浏览器跟随跨站重定向时把 Origin 改为 `null`，只允许 www 的规则会拦下它。也不能改为允许 `null`，它可以被任何沙箱页面伪造。
- private：只允许 www 的 `GET`（经 API 签发的短期 URL 读取私有内容）。
- evidence：不设 CORS，也不绑定任何域名，只有服务端能访问。
