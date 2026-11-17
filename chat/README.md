# 作品集问答部署

首页在 GitHub Pages 上运行。FastAPI 服务独立部署，通过 HTTPS 接收问题并流式返回带来源的答复。基础资料取自网站当前的公开简历和三个代表项目。

## 启动服务

在仓库根目录运行以下命令。编辑 `chat/.env`，填写模型接口根地址、模型名和所需的密钥。模型接口需支持兼容 Chat Completions 的流式请求。

```sh
cp chat/.env.example chat/.env
docker build -f chat/Dockerfile -t jacksonwu-portfolio-chat .
docker run -d --name jacksonwu-portfolio-chat --restart unless-stopped \
  --env-file chat/.env -p 127.0.0.1:8000:8000 jacksonwu-portfolio-chat
curl --fail http://127.0.0.1:8000/health
```

给 `/api/chat` 配置 HTTPS 反向代理，关闭响应缓冲并保留流式响应。若通过可信反向代理转发客户端 IP，由代理覆盖客户端传入的 `X-Forwarded-For`，并用 `FORWARDED_ALLOW_IPS` 指定应用实际连接的代理地址。进程内限流适用于单进程部署。

验证 HTTPS 聊天接口后，将 `dist/index.html` 中的 `data-chat-endpoint` 填为 `https://你的域名/api/chat` 并推送网站代码。浏览器来源由 `PORTFOLIO_ALLOWED_ORIGINS` 配置。

## 接入审核后的笔记

把允许公开引用的 Markdown 或纯文本副本放入服务器上的专用目录，再添加 `manifest.json`。每项填写文件相对路径、标题和可公开访问的 HTTPS 出处。清单可列出最多 20 份资料，每份最长 2,000 字符。

```json
[
  {
    "title": "公开笔记标题",
    "url": "https://example.com/notes/public-note",
    "file": "public-note.md"
  }
]
```

把专用目录以只读方式挂载到容器内，例如使用 `--mount type=bind,src=/srv/portfolio/approved,dst=/approved,readonly`，并将 `PORTFOLIO_CHAT_NOTE_DIR` 设为 `/approved`。更新清单或笔记后重启服务。公开简历或项目正文更新后，重新构建服务镜像即可同步。
