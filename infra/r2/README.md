# R2 桶配置

四个桶：`charpub-public`、`charpub-private`、`charpub-uploads`、`charpub-evidence`。这里的 JSON 是各桶的 CORS 规则：

```sh
wrangler r2 bucket cors set charpub-uploads --file infra/r2/cors-uploads.json
wrangler r2 bucket cors set charpub-public  --file infra/r2/cors-read.json
wrangler r2 bucket cors set charpub-private --file infra/r2/cors-read.json
wrangler r2 bucket lifecycle add charpub-uploads expire-uploads --expire-days 1 --abort-multipart-days 1 --force
wrangler r2 bucket domain add charpub-public --domain assets.char.pub --zone-id <char.pub zone id> --min-tls 1.2
```

- uploads：浏览器用 API 签发的预签名 URL 直接 `PUT` 原件，只允许 web 的来源，请求头只允许上传时需要的几个。
- public、private：浏览器读取 Context IR 等内容（`GET` / `HEAD`，不带凭据）。
- evidence：不设 CORS，也不绑定任何域名，只有服务端能访问。
